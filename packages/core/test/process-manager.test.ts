import { describe, expect, it } from "bun:test";
import {
  decodeText,
  encodeBytes,
  encodeText,
  type LaunchSpec,
  type ProcessInfo,
} from "@actiondock/sdk";
import {
  ACCESS_DENIED,
  CONTROL_BUSY,
  CONTROL_EXPIRED,
  CONTROL_REVOKED,
  INPUT_CLOSED,
  INPUT_OUTCOME_UNKNOWN,
  NOT_FOUND,
  PROCESS_CANCELLED,
  PROCESS_LOST,
  PROCESS_QUARANTINED,
  PROCESS_TIMEOUT,
  QUEUE_FULL,
  QUOTA_EXCEEDED,
  REQUEST_CONFLICT,
  UNSUPPORTED_CAPABILITY,
  OUTPUT_UNAVAILABLE,
  ProcessError,
} from "../src/errors";
import { ContextProcessAPI } from "../src/process/context-process";
import { MemoryProcessDriver } from "../src/process/driver";
import { MemoryProcessMetadataStore } from "../src/process/metadata-store";
import {
  ProcessManager,
  type ProcessOwner,
} from "../src/process/process-manager";
import { createActionContext } from "../src/runtime/context";

describe("受管进程管理器 ProcessManager", () => {
  const ownerA: ProcessOwner = {
    tenantId: "tenant-a",
    principalId: "user-1",
    packageInstanceId: "pkg-1",
    generationId: "gen-1",
  };

  const ownerB: ProcessOwner = {
    tenantId: "tenant-b",
    principalId: "user-2",
    packageInstanceId: "pkg-2",
    generationId: "gen-2",
  };

  const defaultSpec: LaunchSpec = {
    executable: "echo",
    args: ["hello"],
    io: { mode: "pipe" },
  };

  const createManager = (quotas?: any) => {
    const driver = new MemoryProcessDriver();
    const metadataStore = new MemoryProcessMetadataStore();
    const manager = new ProcessManager({
      hostEpoch: "epoch-test-1",
      driver,
      metadataStore,
      quotas,
    });
    return { driver, metadataStore, manager };
  };

  describe("受管进程基础生命周期与启动", () => {
    it("成功启动受管进程并初始化元数据与游标", async () => {
      const { manager, driver } = createManager();

      const startResult = await manager.start(ownerA, {
        requestId: "req-start-1",
        spec: defaultSpec,
      });

      expect(startResult.process.id).toBeDefined();
      expect(startResult.process.state).toBe("running");
      expect(startResult.process.control).toBe("free");
      expect(startResult.initialCursor.startsWith("cur_")).toBe(true);

      const inspectResult = await manager.inspect(ownerA, startResult.process.id);
      expect(inspectResult.id).toBe(startResult.process.id);
      expect(inspectResult.state).toBe("running");
      expect(inspectResult.control).toBe("free");

      expect(driver.handles.has(startResult.process.id)).toBe(true);
    });

    it("spec.io 为 pty 且 driver 不支持时抛出 UNSUPPORTED_CAPABILITY", async () => {
      const { manager, driver } = createManager();
      driver.setCapabilities({ pty: false });

      await expect(
        manager.start(ownerA, {
          requestId: "req-pty-1",
          spec: {
            executable: "bash",
            args: [],
            io: { mode: "pty", cols: 80, rows: 24, term: "xterm" },
          },
        })
      ).rejects.toThrow(ProcessError);

      try {
        await manager.start(ownerA, {
          requestId: "req-pty-1",
          spec: {
            executable: "bash",
            args: [],
            io: { mode: "pty", cols: 80, rows: 24, term: "xterm" },
          },
        });
      } catch (err: any) {
        expect(err.code).toBe(UNSUPPORTED_CAPABILITY);
      }
    });

    it("启动请求幂等去重：相同 requestId 与相同负载返回已有结果", async () => {
      const { manager } = createManager();

      const first = await manager.start(ownerA, {
        requestId: "req-dup-1",
        spec: defaultSpec,
      });

      const second = await manager.start(ownerA, {
        requestId: "req-dup-1",
        spec: defaultSpec,
      });

      expect(second.process.id).toBe(first.process.id);
      expect(second.initialCursor).toBe(first.initialCursor);
    });

    it("启动请求冲突校验：相同 requestId 与不同负载抛出 REQUEST_CONFLICT", async () => {
      const { manager } = createManager();

      await manager.start(ownerA, {
        requestId: "req-conflict-1",
        spec: defaultSpec,
      });

      await expect(
        manager.start(ownerA, {
          requestId: "req-conflict-1",
          spec: {
            executable: "echo",
            args: ["different"],
            io: { mode: "pipe" },
          },
        })
      ).rejects.toThrow(ProcessError);

      try {
        await manager.start(ownerA, {
          requestId: "req-conflict-1",
          spec: {
            executable: "echo",
            args: ["different"],
            io: { mode: "pipe" },
          },
        });
      } catch (err: any) {
        expect(err.code).toBe(REQUEST_CONFLICT);
      }
    });

    it("宿主生命周期初始化原子性收敛旧宿主遗留非终态进程为 lost", async () => {
      const metadataStore = new MemoryProcessMetadataStore();
      await metadataStore.saveProcess({
        processId: "proc-old-1",
        tenantId: ownerA.tenantId,
        principalId: ownerA.principalId,
        packageInstanceId: ownerA.packageInstanceId,
        generationId: ownerA.generationId,
        hostEpoch: "epoch-old",
        state: "running",
        control: "held",
        controlState: "held",
      });

      const manager = new ProcessManager({
        hostEpoch: "epoch-new",
        driver: new MemoryProcessDriver(),
        metadataStore,
      });

      const converged = await manager.initialize();
      expect(converged).toBe(1);

      const oldProc = await metadataStore.getProcess("proc-old-1");
      expect(oldProc?.state).toBe("lost");
      expect(oldProc?.control).toBe("closed");
      expect(oldProc?.endReason).toBe("host-lost");
    });
  });

  describe("归属所有者鉴权安全校验", () => {
    it("全部基于所有者进行严格鉴权校验，不匹配抛出 ACCESS_DENIED", async () => {
      const { manager } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-auth-1",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      // inspect 跨租户
      await expect(manager.inspect(ownerB, processId)).rejects.toThrow(ProcessError);

      // acquire 跨租户
      await expect(
        manager.acquire(ownerB, processId, {
          requestId: "req-acq-b",
          waitMs: 1000,
          ttlMs: 5000,
        })
      ).rejects.toThrow(ProcessError);

      // 正确获取令牌用于后续测试
      const grant = await manager.acquire(ownerA, processId, {
        requestId: "req-acq-a",
        waitMs: 1000,
        ttlMs: 5000,
      });

      // renew 跨租户
      await expect(manager.renew(ownerB, processId, grant.token, 5000)).rejects.toThrow(ProcessError);

      // release 跨租户
      await expect(manager.release(ownerB, processId, grant.token)).rejects.toThrow(ProcessError);

      // write 跨租户
      await expect(
        manager.write(ownerB, processId, {
          token: grant.token,
          requestId: "req-write-b",
          data: encodeText("hello"),
        })
      ).rejects.toThrow(ProcessError);

      // control 跨租户
      await expect(
        manager.control(ownerB, processId, {
          token: grant.token,
          requestId: "req-ctrl-b",
          action: { type: "input-eof" },
        })
      ).rejects.toThrow(ProcessError);

      // read 跨租户
      await expect(
        manager.read(ownerB, processId, {
          cursor: startRes.initialCursor,
          maxBytes: 1024,
          waitMs: 0,
          onGap: "error",
        })
      ).rejects.toThrow(ProcessError);

      // stop 跨租户
      await expect(
        manager.stop(ownerB, processId, {
          requestId: "req-stop-b",
          graceMs: 1000,
        })
      ).rejects.toThrow(ProcessError);

      // 缺失所有者字段抛出 ACCESS_DENIED
      await expect(
        manager.inspect({} as any, processId)
      ).rejects.toThrow(ProcessError);
    });

    it("list 仅列出当前所有者归属下的受管进程", async () => {
      const { manager } = createManager();

      await manager.start(ownerA, {
        requestId: "req-list-a1",
        spec: defaultSpec,
      });
      await manager.start(ownerA, {
        requestId: "req-list-a2",
        spec: defaultSpec,
      });
      await manager.start(ownerB, {
        requestId: "req-list-b1",
        spec: defaultSpec,
      });

      const listA = await manager.list(ownerA, {});
      expect(listA.processes.length).toBe(2);

      const listB = await manager.list(ownerB, {});
      expect(listB.processes.length).toBe(1);
    });
  });

  describe("独占控制权状态机推进 (free -> held -> quarantined -> closed)", () => {
    it("正常状态机流转：free 状态下 acquire 获取 grant，状态变为 held，release 后回到 free", async () => {
      const { manager } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-sm-1",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      // 初始为 free
      const info0 = await manager.inspect(ownerA, processId);
      expect(info0.control).toBe("free");

      // acquire 成功转入 held
      const grant = await manager.acquire(ownerA, processId, {
        requestId: "req-sm-acq",
        waitMs: 1000,
        ttlMs: 10000,
      });
      expect(grant.token).toBeDefined();

      const info1 = await manager.inspect(ownerA, processId);
      expect(info1.control).toBe("held");

      // renew 延长 TTL
      const renewed = await manager.renew(ownerA, processId, grant.token, 20000);
      expect(renewed.token).toBe(grant.token);
      expect(new Date(renewed.expiresAt).getTime()).toBeGreaterThan(new Date(grant.expiresAt).getTime());

      // release 释放回 free
      await manager.release(ownerA, processId, grant.token);
      const info2 = await manager.inspect(ownerA, processId);
      expect(info2.control).toBe("free");
    });

    it("队列中有待 dispatch 的操作时 release 抛出 CONTROL_BUSY 拒绝释放", async () => {
      const { manager, driver } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-busy-1",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      const grant = await manager.acquire(ownerA, processId, {
        requestId: "req-busy-acq",
        waitMs: 1000,
        ttlMs: 10000,
      });

      // 模拟底层写入挂起
      let resolveWrite: (() => void) | undefined;
      const handle = driver.handles.get(processId)!;
      handle.write = () => new Promise<void>((resolve) => {
        resolveWrite = resolve;
      });

      // 提交写入操作进入队列并开始 dispatch
      await manager.write(ownerA, processId, {
        token: grant.token,
        requestId: "req-pending-write",
        data: encodeText("pending"),
      });

      // 提交第二个写入操作保持在队列中
      await manager.write(ownerA, processId, {
        token: grant.token,
        requestId: "req-pending-write-2",
        data: encodeText("pending 2"),
      });

      // 尝试在队列有待处理项时 release
      await expect(
        manager.release(ownerA, processId, grant.token)
      ).rejects.toThrow(ProcessError);

      try {
        await manager.release(ownerA, processId, grant.token);
      } catch (err: any) {
        expect(err.code).toBe(CONTROL_BUSY);
      }

      // 恢复底层写入
      if (resolveWrite) resolveWrite();
    });

    it("控制权 TTL 到期未释放自动转入 quarantined 并撤销 grant", async () => {
      const { manager } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-ttl-1",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      const grant = await manager.acquire(ownerA, processId, {
        requestId: "req-ttl-acq",
        waitMs: 1000,
        ttlMs: 50, // 50ms 存活
      });

      // 等待 TTL 到期
      await new Promise((resolve) => setTimeout(resolve, 80));

      const info = await manager.inspect(ownerA, processId);
      expect(info.control).toBe("quarantined");

      // 处于 quarantined 状态下 acquire 拒绝
      await expect(
        manager.acquire(ownerA, processId, {
          requestId: "req-ttl-acq2",
          waitMs: 100,
          ttlMs: 1000,
        })
      ).rejects.toThrow(ProcessError);

      try {
        await manager.acquire(ownerA, processId, {
          requestId: "req-ttl-acq2",
          waitMs: 100,
          ttlMs: 1000,
        });
      } catch (err: any) {
        expect(err.code).toBe(PROCESS_QUARANTINED);
      }
    });

    it("多个调用方按 FIFO 顺序排队等待控制权", async () => {
      const { manager } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-fifo-1",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      const grant1 = await manager.acquire(ownerA, processId, {
        requestId: "req-fifo-acq1",
        waitMs: 1000,
        ttlMs: 10000,
      });

      let waiter1Acquired = false;
      const p1 = manager.acquire(ownerA, processId, {
        requestId: "req-fifo-acq2",
        waitMs: 5000,
        ttlMs: 10000,
      }).then((g) => {
        waiter1Acquired = true;
        return g;
      });

      let waiter2Acquired = false;
      const p2 = manager.acquire(ownerA, processId, {
        requestId: "req-fifo-acq3",
        waitMs: 5000,
        ttlMs: 10000,
      }).then((g) => {
        waiter2Acquired = true;
        return g;
      });

      // 等待 p1 和 p2 异步注册进入排队队列
      await new Promise((resolve) => setTimeout(resolve, 10));

      // 释放第一个持有者
      await manager.release(ownerA, processId, grant1.token);

      const grant2 = await p1;
      expect(waiter1Acquired).toBe(true);
      expect(waiter2Acquired).toBe(false);

      // 释放第二个持有者，唤醒第三个
      await manager.release(ownerA, processId, grant2.token);
      const grant3 = await p2;
      expect(waiter2Acquired).toBe(true);
      expect(grant3.token).toBeDefined();

      await manager.release(ownerA, processId, grant3.token);
    });

    it("排队等待超时抛出 CONTROL_BUSY", async () => {
      const { manager } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-timeout-1",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      await manager.acquire(ownerA, processId, {
        requestId: "req-hold-forever",
        waitMs: 1000,
        ttlMs: 10000,
      });

      await expect(
        manager.acquire(ownerA, processId, {
          requestId: "req-wait-short",
          waitMs: 30,
          ttlMs: 5000,
        })
      ).rejects.toThrow(ProcessError);

      try {
        await manager.acquire(ownerA, processId, {
          requestId: "req-wait-short",
          waitMs: 30,
          ttlMs: 5000,
        });
      } catch (err: any) {
        expect(err.code).toBe(CONTROL_BUSY);
      }
    });

    it("排队等待支持 AbortSignal 取消", async () => {
      const { manager } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-abort-1",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      await manager.acquire(ownerA, processId, {
        requestId: "req-hold",
        waitMs: 1000,
        ttlMs: 10000,
      });

      const controller = new AbortController();
      const p = manager.acquire(
        ownerA,
        processId,
        {
          requestId: "req-abort-wait",
          waitMs: 5000,
          ttlMs: 5000,
        },
        { signal: controller.signal }
      );

      setTimeout(() => controller.abort(), 20);

      await expect(p).rejects.toThrow();
    });
  });

  describe("输入队列、操作调度与去重流转", () => {
    it("写入操作正常调度完成并刷新 idleTimeout", async () => {
      const { manager, driver } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-write-flow-1",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      const grant = await manager.acquire(ownerA, processId, {
        requestId: "req-write-flow-acq",
        waitMs: 1000,
        ttlMs: 10000,
      });

      const receipt = await manager.write(ownerA, processId, {
        token: grant.token,
        requestId: "req-write-data-1",
        data: encodeText("hello world"),
      });

      expect(receipt.requestId).toBe("req-write-data-1");
      expect(receipt.state).toBe("queued");

      // 等待调度执行完成
      await new Promise((resolve) => setTimeout(resolve, 20));

      const op = await manager.operation(ownerA, processId, "req-write-data-1");
      expect(op.state).toBe("completed");
      expect(op.acceptedBytes).toBe(11);

      const handle = driver.handles.get(processId)!;
      expect(handle.writtenChunks.length).toBe(1);
      expect(new TextDecoder().decode(handle.writtenChunks[0])).toBe("hello world");
    });

    it("写入操作去重与冲突检测", async () => {
      const { manager } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-write-dup-1",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      const grant = await manager.acquire(ownerA, processId, {
        requestId: "req-write-dup-acq",
        waitMs: 1000,
        ttlMs: 10000,
      });

      const receipt1 = await manager.write(ownerA, processId, {
        token: grant.token,
        requestId: "req-same-write",
        data: encodeText("data 1"),
      });

      // 相同 requestId 相同负载幂等返回
      const receipt2 = await manager.write(ownerA, processId, {
        token: grant.token,
        requestId: "req-same-write",
        data: encodeText("data 1"),
      });
      expect(receipt2.requestId).toBe(receipt1.requestId);

      // 相同 requestId 不同负载抛出 REQUEST_CONFLICT
      await expect(
        manager.write(ownerA, processId, {
          token: grant.token,
          requestId: "req-same-write",
          data: encodeText("different data"),
        })
      ).rejects.toThrow(ProcessError);

      try {
        await manager.write(ownerA, processId, {
          token: grant.token,
          requestId: "req-same-write",
          data: encodeText("different data"),
        });
      } catch (err: any) {
        expect(err.code).toBe(REQUEST_CONFLICT);
      }
    });

    it("控制指令正常调度执行 (input-eof, interrupt-foreground, resize)", async () => {
      const { manager, driver } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-ctrl-flow-1",
        spec: {
          executable: "bash",
          args: [],
          io: { mode: "pty", cols: 80, rows: 24, term: "xterm" },
        },
      });
      const processId = startRes.process.id;

      const grant = await manager.acquire(ownerA, processId, {
        requestId: "req-ctrl-flow-acq",
        waitMs: 1000,
        ttlMs: 10000,
      });

      // 发送 resize
      const rcResize = await manager.control(ownerA, processId, {
        token: grant.token,
        requestId: "req-action-resize",
        action: { type: "resize", cols: 120, rows: 40 },
      });
      expect(rcResize.state).toBe("queued");

      // 发送 interrupt-foreground
      const rcInterrupt = await manager.control(ownerA, processId, {
        token: grant.token,
        requestId: "req-action-interrupt",
        action: { type: "interrupt-foreground" },
      });
      expect(rcInterrupt.state).toBe("queued");

      // 发送 input-eof
      const rcEof = await manager.control(ownerA, processId, {
        token: grant.token,
        requestId: "req-action-eof",
        action: { type: "input-eof" },
      });
      expect(rcEof.state).toBe("queued");

      await new Promise((resolve) => setTimeout(resolve, 30));

      const handle = driver.handles.get(processId)!;
      expect(handle.currentSize).toEqual({ cols: 120, rows: 40 });
      expect(handle.interrupted).toBe(true);
      expect(handle.eofSent).toBe(true);

      // 输入已关闭后继续写入抛出 INPUT_CLOSED
      await expect(
        manager.write(ownerA, processId, {
          token: grant.token,
          requestId: "req-write-after-eof",
          data: encodeText("blocked"),
        })
      ).rejects.toThrow(ProcessError);

      try {
        await manager.write(ownerA, processId, {
          token: grant.token,
          requestId: "req-write-after-eof",
          data: encodeText("blocked"),
        });
      } catch (err: any) {
        expect(err.code).toBe(INPUT_CLOSED);
      }
    });

    it("写入出现不确定失败时收据状态标记为 unknown 且进程自动转入 quarantined", async () => {
      const { manager, driver } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-fail-write-1",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      const grant = await manager.acquire(ownerA, processId, {
        requestId: "req-fail-acq",
        waitMs: 1000,
        ttlMs: 10000,
      });

      // 模拟底层写入抛错
      const handle = driver.handles.get(processId)!;
      handle.writeFailureError = new Error("Broken pipe uncertain failure");

      await manager.write(ownerA, processId, {
        token: grant.token,
        requestId: "req-fail-op",
        data: encodeText("bad data"),
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      const op = await manager.operation(ownerA, processId, "req-fail-op");
      expect(op.state).toBe("unknown");
      expect(op.errorCode).toBe(INPUT_OUTCOME_UNKNOWN);

      const info = await manager.inspect(ownerA, processId);
      expect(info.control).toBe("quarantined");
    });
  });

  describe("宿主与作用域资源配额限制", () => {
    it("作用域活跃进程上限超额抛出 QUOTA_EXCEEDED (上限 8)", async () => {
      const { manager } = createManager({ maxActiveProcessesPerScope: 2 });

      await manager.start(ownerA, { requestId: "req-q-1", spec: defaultSpec });
      await manager.start(ownerA, { requestId: "req-q-2", spec: defaultSpec });

      // 第三次超出配额 2
      await expect(
        manager.start(ownerA, { requestId: "req-q-3", spec: defaultSpec })
      ).rejects.toThrow(ProcessError);

      try {
        await manager.start(ownerA, { requestId: "req-q-3", spec: defaultSpec });
      } catch (err: any) {
        expect(err.code).toBe(QUOTA_EXCEEDED);
      }
    });

    it("待写入队列容量超限抛出 QUEUE_FULL", async () => {
      const { manager, driver } = createManager({ maxPendingQueueBytesPerProcess: 100 });

      const startRes = await manager.start(ownerA, { requestId: "req-qf-1", spec: defaultSpec });
      const processId = startRes.process.id;

      const grant = await manager.acquire(ownerA, processId, {
        requestId: "req-qf-acq",
        waitMs: 1000,
        ttlMs: 10000,
      });

      // 挂起底层写入
      const handle = driver.handles.get(processId)!;
      handle.write = () => new Promise<void>(() => {});

      // 写入 80 字节
      await manager.write(ownerA, processId, {
        token: grant.token,
        requestId: "req-qf-write-1",
        data: encodeBytes(new Uint8Array(80)),
      });

      // 再次写入 50 字节（累计 130 字节超限 100）
      await expect(
        manager.write(ownerA, processId, {
          token: grant.token,
          requestId: "req-qf-write-2",
          data: encodeBytes(new Uint8Array(50)),
        })
      ).rejects.toThrow(ProcessError);

      try {
        await manager.write(ownerA, processId, {
          token: grant.token,
          requestId: "req-qf-write-2",
          data: encodeBytes(new Uint8Array(50)),
        });
      } catch (err: any) {
        expect(err.code).toBe(QUEUE_FULL);
      }
    });
  });

  describe("生命周期、定时器与紧急终止 stop", () => {
    it("stop 独立鉴权紧急终止通道撤销 grant 并取消待 dispatch 输入，置为 closed", async () => {
      const { manager, driver } = createManager();

      const startRes = await manager.start(ownerA, { requestId: "req-stop-1", spec: defaultSpec });
      const processId = startRes.process.id;

      const grant = await manager.acquire(ownerA, processId, {
        requestId: "req-stop-acq",
        waitMs: 1000,
        ttlMs: 10000,
      });

      // 挂起写入
      const handle = driver.handles.get(processId)!;
      handle.write = () => new Promise<void>(() => {});

      await manager.write(ownerA, processId, {
        token: grant.token,
        requestId: "req-stop-pending",
        data: encodeText("hello"),
      });

      // 调用 stop 终止进程
      const stoppedInfo = await manager.stop(ownerA, processId, {
        requestId: "req-emergency-stop",
        graceMs: 500,
      });

      expect(stoppedInfo.state).toBe("exited");
      expect(stoppedInfo.control).toBe("closed");
      expect(stoppedInfo.endReason).toBe("requested");

      // 待处理操作标记为 failed 与 PROCESS_CANCELLED
      const op = await manager.operation(ownerA, processId, "req-stop-pending");
      expect(op.state).toBe("failed");
      expect(op.errorCode).toBe(PROCESS_CANCELLED);
    });

    it("idleTimeout 超时自动终止进程并标记 endReason 为 idle", async () => {
      const { manager } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-idle-1",
        spec: defaultSpec,
        limits: { idleMs: 50 },
      });
      const processId = startRes.process.id;

      await new Promise((resolve) => setTimeout(resolve, 100));

      const info = await manager.inspect(ownerA, processId);
      expect(info.state).toBe("exited");
      expect(info.endReason).toBe("idle");
    });
  });

  describe("一次性任务运行 run()", () => {
    it("成功执行并收集管道输出", async () => {
      const { manager, driver } = createManager();

      driver.spawnHook = async (processId, spec, callbacks) => {
        setTimeout(() => {
          callbacks.onOutput("stdout", new TextEncoder().encode("line 1\n"));
          callbacks.onOutput("stderr", new TextEncoder().encode("err 1\n"));
          callbacks.onExit({ code: 0, signal: null });
        }, 10);
      };

      const result = await manager.run(ownerA, {
        spec: defaultSpec,
        timeoutMs: 1000,
        maxOutputBytes: 1024,
      });

      expect(result.exit.code).toBe(0);
      expect(result.chunks.length).toBe(2);
      expect(decodeText(result.chunks[0].data)).toBe("line 1\n");
      expect(decodeText(result.chunks[1].data)).toBe("err 1\n");
      expect(result.truncated).toBe(false);
    });

    it("非 pipe 模式拒绝执行并抛出 UNSUPPORTED_CAPABILITY", async () => {
      const { manager } = createManager();

      await expect(
        manager.run(ownerA, {
          spec: {
            executable: "echo",
            args: [],
            io: { mode: "pty", cols: 80, rows: 24, term: "xterm" },
          },
          timeoutMs: 1000,
          maxOutputBytes: 1024,
        })
      ).rejects.toThrow(ProcessError);

      try {
        await manager.run(ownerA, {
          spec: {
            executable: "echo",
            args: [],
            io: { mode: "pty", cols: 80, rows: 24, term: "xterm" },
          },
          timeoutMs: 1000,
          maxOutputBytes: 1024,
        });
      } catch (err: any) {
        expect(err.code).toBe(UNSUPPORTED_CAPABILITY);
      }
    });

    it("超出 maxOutputBytes 时截断输出并标记 truncated", async () => {
      const { manager, driver } = createManager();

      driver.spawnHook = async (processId, spec, callbacks) => {
        setTimeout(() => {
          callbacks.onOutput("stdout", new TextEncoder().encode("0123456789"));
          callbacks.onExit({ code: 0, signal: null });
        }, 10);
      };

      const result = await manager.run(ownerA, {
        spec: defaultSpec,
        timeoutMs: 1000,
        maxOutputBytes: 5,
      });

      expect(result.truncated).toBe(true);
      expect(decodeText(result.chunks[0].data)).toBe("01234");
    });

    it("执行超时自动清理进程并抛出 PROCESS_TIMEOUT", async () => {
      const { manager, driver } = createManager();

      driver.spawnHook = async (processId, spec, callbacks) => {
        // 不触发 onExit 模拟超时
      };

      await expect(
        manager.run(ownerA, {
          spec: defaultSpec,
          timeoutMs: 50,
          maxOutputBytes: 1024,
        })
      ).rejects.toThrow(ProcessError);

      try {
        await manager.run(ownerA, {
          spec: defaultSpec,
          timeoutMs: 50,
          maxOutputBytes: 1024,
        });
      } catch (err: any) {
        expect(err.code).toBe(PROCESS_TIMEOUT);
      }
    });
  });

  describe("ContextProcessAPI 上下文适配与生命周期拦截", () => {
    it("Run 结束或异常退出时若未显式 release 自动撤销 grant 并将目标进程置入 quarantined", async () => {
      const { manager } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-ctx-1",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      const contextApi = new ContextProcessAPI(manager, ownerA, "run-100");

      const grant = await contextApi.acquire(processId, {
        requestId: "req-ctx-acq",
        waitMs: 1000,
        ttlMs: 10000,
      });
      expect(grant.token).toBeDefined();

      const infoBefore = await manager.inspect(ownerA, processId);
      expect(infoBefore.control).toBe("held");

      // 模拟 Run 退出拦截（dispose）
      await contextApi.dispose();

      // 进程应自动转为 quarantined
      const infoAfter = await manager.inspect(ownerA, processId);
      expect(infoAfter.control).toBe("quarantined");
    });

    it("Run 正常显式 release 后调用 dispose 不会误隔离进程", async () => {
      const { manager } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-ctx-2",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      const contextApi = new ContextProcessAPI(manager, ownerA, "run-200");

      const grant = await contextApi.acquire(processId, {
        requestId: "req-ctx-acq2",
        waitMs: 1000,
        ttlMs: 10000,
      });

      // 显式 release
      await contextApi.release(processId, grant.token);

      const infoReleased = await manager.inspect(ownerA, processId);
      expect(infoReleased.control).toBe("free");

      // 随后 Run 终结清理
      await contextApi.dispose();

      // 控制权应仍然保持 free，不受影响
      const infoFinal = await manager.inspect(ownerA, processId);
      expect(infoFinal.control).toBe("free");
    });

    it("通过 AbortSignal 中止时自动触发 dispose 隔离进程", async () => {
      const { manager } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-ctx-abort",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      const controller = new AbortController();
      const contextApi = new ContextProcessAPI(
        manager,
        ownerA,
        "run-abort-1",
        controller.signal
      );

      await contextApi.acquire(processId, {
        requestId: "req-ctx-acq-abort",
        waitMs: 1000,
        ttlMs: 10000,
      });

      expect((await manager.inspect(ownerA, processId)).control).toBe("held");

      // 触发 Run 中止信号
      controller.abort();

      // 稍等微任务流转
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect((await manager.inspect(ownerA, processId)).control).toBe("quarantined");
    });
  });

  describe("缺陷修复回归：竞态、幂等原子性与资源回收", () => {
    it("stop 与 dispatch 交错：挂起写入返回后不改写已失败的收据且字节计数不为负", async () => {
      const { manager, driver } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-race-start",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      const grant = await manager.acquire(ownerA, processId, {
        requestId: "req-race-acq",
        waitMs: 1000,
        ttlMs: 10000,
      });

      // 挂起底层写入，构造 dispatch 挂起窗口
      let resolveWrite: (() => void) | undefined;
      const handle = driver.handles.get(processId)!;
      handle.write = () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        });

      await manager.write(ownerA, processId, {
        token: grant.token,
        requestId: "req-race-write",
        data: encodeText("payload"),
      });

      // 等待 dispatch 进入挂起写入
      await new Promise((resolve) => setTimeout(resolve, 20));

      // stop 接管队列：递增取消纪元并标记失败
      await manager.stop(ownerA, processId, {
        requestId: "req-race-stop",
        graceMs: 50,
      });

      // 释放挂起写入：dispatch 完成段应放弃过期结算
      if (resolveWrite) {
        resolveWrite();
      }
      await new Promise((resolve) => setTimeout(resolve, 30));

      // 收据保持 stop 标记的 failed 状态，未被 dispatch 改写为 completed
      const op = await manager.operation(ownerA, processId, "req-race-write");
      expect(op.state).toBe("failed");
      expect(op.errorCode).toBe(PROCESS_CANCELLED);

      // 待写入字节计数不为负（未被二次扣减）
      const proc = (manager as any).processes.get(processId);
      expect(proc ? proc.pendingInputBytes : 0).toBeGreaterThanOrEqual(0);
    });

    it("terminate 失败时保留 stopping 状态且不伪造退出结构", async () => {
      const { manager, driver } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-terr-start",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      // 注入 terminate 故障
      const handle = driver.handles.get(processId)!;
      handle.terminate = async () => {
        throw new Error("terminate EPERM");
      };

      const stopped = await manager.stop(ownerA, processId, {
        requestId: "req-terr-stop",
        graceMs: 50,
      });

      // 终止失败：保留 stopping，不伪造 exit
      expect(stopped.state).toBe("stopping");
      expect(stopped.exit).toBeUndefined();

      // 真实退出事件到达后正常收敛为 exited
      handle.emitExit(9, null);
      const info = await manager.inspect(ownerA, processId);
      expect(info.state).toBe("exited");
      expect(info.exit?.code).toBe(9);
    });

    it("并发同 requestId 的 start 仅派生一个进程（幂等预占原子性）", async () => {
      const { manager, driver } = createManager();

      const p1 = manager.start(ownerA, {
        requestId: "req-atomic-start",
        spec: defaultSpec,
      });
      const p2 = manager.start(ownerA, {
        requestId: "req-atomic-start",
        spec: defaultSpec,
      });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r2.process.id).toBe(r1.process.id);
      expect(driver.handles.size).toBe(1);
    });

    it("并发同 requestId 的 write 仅入队一次且不重复扣减字节", async () => {
      const { manager, driver } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-atomic-w-start",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      const grant = await manager.acquire(ownerA, processId, {
        requestId: "req-atomic-w-acq",
        waitMs: 1000,
        ttlMs: 10000,
      });

      const payload = encodeText("single enqueue");
      const [w1, w2] = await Promise.all([
        manager.write(ownerA, processId, {
          token: grant.token,
          requestId: "req-atomic-write",
          data: payload,
        }),
        manager.write(ownerA, processId, {
          token: grant.token,
          requestId: "req-atomic-write",
          data: payload,
        }),
      ]);

      expect(w1.requestId).toBe(w2.requestId);

      await new Promise((resolve) => setTimeout(resolve, 20));

      const handle = driver.handles.get(processId)!;
      expect(handle.writtenChunks.length).toBe(1);
    });

    it("终态且输出关闭后的进程被驱逐出内存表且释放驱动句柄", async () => {
      const driver = new MemoryProcessDriver();
      const disposedIds: string[] = [];
      (driver as any).dispose = (handle: any) => {
        disposedIds.push(handle.id);
      };
      const manager = new ProcessManager({
        hostEpoch: "epoch-evict",
        driver,
        metadataStore: new MemoryProcessMetadataStore(),
        drainDeadlineMs: 20,
      });

      const startRes = await manager.start(ownerA, {
        requestId: "req-evict-start",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      const handle = driver.handles.get(processId)!;
      handle.emitExit(0, null);
      handle.emitOutputClosed("natural");

      await new Promise((resolve) => setTimeout(resolve, 40));

      // 记录已从内存表移除且驱动句柄已释放
      expect((manager as any).processes.has(processId)).toBe(false);
      expect(disposedIds).toContain(processId);

      // 驱逐后仍可查询状态与游标读取
      const info = await manager.inspect(ownerA, processId);
      expect(info.state).toBe("exited");
      expect(info.outputClosed).toBe(true);
    });

    it("shutdown 停止全部活跃进程并清理定时器", async () => {
      const { manager } = createManager();

      const s1 = await manager.start(ownerA, { requestId: "req-sd-1", spec: defaultSpec });
      const s2 = await manager.start(ownerA, { requestId: "req-sd-2", spec: defaultSpec });

      await manager.shutdown();

      const i1 = await manager.inspect(ownerA, s1.process.id);
      const i2 = await manager.inspect(ownerA, s2.process.id);
      expect(i1.state).toBe("exited");
      expect(i2.state).toBe("exited");

      // 关闭后拒绝新请求
      await expect(
        manager.start(ownerA, { requestId: "req-sd-3", spec: defaultSpec })
      ).rejects.toThrow(ProcessError);

      // 重复 shutdown 幂等
      await manager.shutdown();
    });

    it("旧纪元非终态记录在首次访问时自动收敛 lost 且拒绝控制权申请", async () => {
      const metadataStore = new MemoryProcessMetadataStore();
      await metadataStore.saveProcess({
        processId: "proc-stale-1",
        tenantId: ownerA.tenantId,
        principalId: ownerA.principalId,
        packageInstanceId: ownerA.packageInstanceId,
        generationId: ownerA.generationId,
        hostEpoch: "epoch-ancient",
        state: "running",
        control: "held",
        controlState: "held",
      });

      const manager = new ProcessManager({
        hostEpoch: "epoch-fresh",
        driver: new MemoryProcessDriver(),
        metadataStore,
      });

      // 首次入口隐式触发崩溃恢复（无需显式 initialize），旧纪元记录收敛 lost
      const info = await manager.inspect(ownerA, "proc-stale-1");
      expect(info.state).toBe("lost");
      expect(info.endReason).toBe("host-lost");

      const record = await metadataStore.getProcess("proc-stale-1");
      expect(record?.state).toBe("lost");
      expect(record?.endReason).toBe("host-lost");

      // 已丢失进程拒绝申请控制权
      await expect(
        manager.acquire(ownerA, "proc-stale-1", {
          requestId: "req-stale-acq",
          waitMs: 100,
          ttlMs: 1000,
        })
      ).rejects.toThrow(ProcessError);
    });

    it("stop 后落盘 endReason 保留内存值（idle/lifetime）而非硬编码 requested", async () => {
      const { manager } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-endreason-start",
        spec: defaultSpec,
        limits: { idleMs: 50 },
      });
      const processId = startRes.process.id;

      await new Promise((resolve) => setTimeout(resolve, 100));

      const info = await manager.inspect(ownerA, processId);
      expect(info.state).toBe("exited");
      expect(info.endReason).toBe("idle");

      const { metadataStore } = { metadataStore: (manager as any).metadataStore };
      const record = await metadataStore.getProcess(processId);
      expect(record?.endReason).toBe("idle");
    });

    it("ttlMs 或 waitMs 非正整数时抛出参数错误", async () => {
      const { manager } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-ttl-validation",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      await expect(
        manager.acquire(ownerA, processId, {
          requestId: "req-ttl-bad-1",
          waitMs: 1000,
          ttlMs: 0,
        })
      ).rejects.toThrow(ProcessError);

      await expect(
        manager.renew(ownerA, processId, "any-token", -5)
      ).rejects.toThrow(ProcessError);
    });

    it("run 在派生前信号已中止时不派生进程直接抛出取消错误", async () => {
      const { driver, manager } = createManager();

      const controller = new AbortController();
      controller.abort();

      await expect(
        manager.run(
          ownerA,
          {
            spec: defaultSpec,
            timeoutMs: 1000,
            maxOutputBytes: 1024,
          },
          { signal: controller.signal }
        )
      ).rejects.toThrow(ProcessError);

      // 未派生任何进程
      expect(driver.handles.size).toBe(0);
    });

    it("quarantine 与 dispatch 交错：挂起写入返回后不改写已失败的收据", async () => {
      const { manager, driver } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-qrace-start",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      const grant = await manager.acquire(ownerA, processId, {
        requestId: "req-qrace-acq",
        waitMs: 1000,
        ttlMs: 10000,
      });

      let resolveWrite: (() => void) | undefined;
      const handle = driver.handles.get(processId)!;
      handle.write = () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        });

      await manager.write(ownerA, processId, {
        token: grant.token,
        requestId: "req-qrace-write",
        data: encodeText("payload"),
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      // quarantine 接管队列：递增取消纪元并标记失败
      await manager.quarantineProcess(ownerA, processId, grant.token, "race test");

      if (resolveWrite) {
        resolveWrite();
      }
      await new Promise((resolve) => setTimeout(resolve, 30));

      const op = await manager.operation(ownerA, processId, "req-qrace-write");
      expect(op.state).toBe("failed");
      expect(op.errorCode).toBe(CONTROL_REVOKED);
    });

    it("控制指令失败时收据携带结构化错误码与错误消息而非人类文本错误码", async () => {
      const { manager, driver } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-ctrl-err-start",
        spec: {
          executable: "bash",
          args: [],
          io: { mode: "pty", cols: 80, rows: 24, term: "xterm" },
        },
      });
      const processId = startRes.process.id;

      const grant = await manager.acquire(ownerA, processId, {
        requestId: "req-ctrl-err-acq",
        waitMs: 1000,
        ttlMs: 10000,
      });

      const handle = driver.handles.get(processId)!;
      handle.interruptForeground = async () => {
        throw new Error("foreground job table corrupted");
      };

      await manager.control(ownerA, processId, {
        token: grant.token,
        requestId: "req-ctrl-err-op",
        action: { type: "interrupt-foreground" },
      });

      await new Promise((resolve) => setTimeout(resolve, 30));

      const op = await manager.operation(ownerA, processId, "req-ctrl-err-op");
      expect(op.state).toBe("failed");
      expect(op.errorCode).toBe("CONTROL_FAILED");
      expect(op.errorMessage).toContain("foreground job table corrupted");
    });

    it("ContextProcessAPI 暴露 manager、owner 与 runScoped 协同属性", async () => {
      const { manager } = createManager();

      const scopedApi = manager.forOwner(ownerA, "run-scoped-1");
      expect(scopedApi.manager).toBe(manager);
      expect(scopedApi.owner).toBe(ownerA);
      expect(scopedApi.runScoped).toBe(true);

      const unscopedApi = manager.forOwner(ownerA);
      expect(unscopedApi.runScoped).toBe(false);
    });

    it("input-eof 成功后独立落盘 inputClosed，重新加载后拒绝继续写入", async () => {
      const { manager, metadataStore } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-eof-persist-start",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      const grant = await manager.acquire(ownerA, processId, {
        requestId: "req-eof-persist-acq",
        waitMs: 1000,
        ttlMs: 10000,
      });

      await manager.control(ownerA, processId, {
        token: grant.token,
        requestId: "req-eof-persist-op",
        action: { type: "input-eof" },
      });

      await new Promise((resolve) => setTimeout(resolve, 30));

      // 落盘字段与输出关闭字段相互独立
      const record = await metadataStore.getProcess(processId);
      expect(record?.inputClosed).toBe(true);
      expect(record?.outputClosed).toBe(false);

      // 模拟宿主重启：清空内存表后重新加载，inputClosed 语义保留
      (manager as any).processes.clear();
      await expect(
        manager.write(ownerA, processId, {
          token: grant.token,
          requestId: "req-eof-persist-write",
          data: encodeText("blocked"),
        })
      ).rejects.toThrow(ProcessError);
    });
  });

  describe("审查缺陷回归测试套件 (Review Regressions)", () => {
    it("[Issue 1] 两个不同所有者并发使用相同 requestId 调用 start 时，分别独立创建进程且不冲突", async () => {
      const { manager } = createManager();

      const [resA, resB] = await Promise.all([
        manager.start(ownerA, {
          requestId: "same-req-id",
          spec: defaultSpec,
        }),
        manager.start(ownerB, {
          requestId: "same-req-id",
          spec: defaultSpec,
        }),
      ]);

      expect(resA.process.id).toBeDefined();
      expect(resB.process.id).toBeDefined();
      expect(resA.process.id).not.toBe(resB.process.id);
    });

    it("[Issue 1] 相同所有者并发使用相同 requestId 但不同负载时，立即抛出 REQUEST_CONFLICT", async () => {
      const { manager } = createManager();

      const start1 = manager.start(ownerA, {
        requestId: "conflict-req-id",
        spec: { executable: "echo", args: ["one"], io: { mode: "pipe" } },
      });
      const start2 = manager.start(ownerA, {
        requestId: "conflict-req-id",
        spec: { executable: "echo", args: ["two"], io: { mode: "pipe" } },
      });

      const results = await Promise.allSettled([start1, start2]);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      expect(rejected).toBeDefined();
      expect(((rejected!.reason as ProcessError) || {}).code).toBe(REQUEST_CONFLICT);
    });

    it("[Issue 2] Runner 构造 Action 上下文时正确继承包实例所有者，实现跨包进程隔离", () => {
      const { manager } = createManager();
      const platformProcess = manager.forOwner({
        tenantId: "default",
        principalId: "default",
        packageInstanceId: "default",
        generationId: "default",
      });

      const mockStorage = {
        getConfig: () => undefined,
        getState: () => undefined,
      } as any;

      const ctxA = createActionContext({
        storage: mockStorage,
        process: platformProcess,
        owner: ownerA,
      });

      const ctxB = createActionContext({
        storage: mockStorage,
        process: platformProcess,
        owner: ownerB,
      });

      expect((ctxA.process as any).owner.packageInstanceId).toBe("pkg-1");
      expect((ctxB.process as any).owner.packageInstanceId).toBe("pkg-2");
      expect((ctxA.process as any).owner.tenantId).toBe("tenant-a");
      expect((ctxB.process as any).owner.tenantId).toBe("tenant-b");
    });

    it("[Issue 3] stop() 保持 stopping 状态且不提前关闭输出，真实输出关闭后才标记 outputClosed", async () => {
      const driver = new MemoryProcessDriver();
      const manager = new ProcessManager({
        hostEpoch: "epoch-1",
        driver,
      });

      const startRes = await manager.start(ownerA, {
        requestId: "req-stop-flush",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;
      const handle = (manager as any).processes.get(processId).handle;

      // 覆盖 terminate 行为：模拟只发送终止信号，驱动不立即通知退出与流关闭
      handle.terminate = async () => {};

      const stopInfo = await manager.stop(ownerA, processId, {
        requestId: "req-stop-call",
        graceMs: 100,
      });

      // stop 完成时状态为 stopping，输出未关闭
      expect(stopInfo.state).toBe("stopping");
      expect(stopInfo.control).toBe("closed");
      expect(stopInfo.outputClosed).toBe(false);

      // 允许底层驱动在 stop 后继续刷入尾部输出
      handle.emitOutput("stdout", "trailing-output");

      // 驱动后续触发真实退出与流关闭
      handle.emitExit(0, null);
      handle.emitOutputClosed("natural");

      const finalInfo = await manager.inspect(ownerA, processId);
      expect(finalInfo.state).toBe("exited");
      expect(finalInfo.outputClosed).toBe(true);

      const readRes = await manager.read(ownerA, processId, {
        cursor: startRes.initialCursor,
        maxBytes: 65536,
        waitMs: 0,
        onGap: "error",
      });
      expect(decodeText(readRes.chunks)).toContain("trailing-output");
    });

    it("[Issue 5] 并发写入严格受输入队列配额限制，无法在落盘窗口穿透配额", async () => {
      const { manager } = createManager({
        maxPendingQueueBytesPerProcess: 100, // 仅允许 100 字节
      });

      const startRes = await manager.start(ownerA, {
        requestId: "req-write-quota",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      const grant = await manager.acquire(ownerA, processId, {
        requestId: "req-write-grant",
        waitMs: 1000,
        ttlMs: 10000,
      });

      // 3 个并发写入，每个 40 字节，前两个 80 字节成功，第三个 120 字节超限应抛出 QUEUE_FULL
      const writes = await Promise.allSettled([
        manager.write(ownerA, processId, {
          token: grant.token,
          requestId: "write-1",
          data: encodeBytes(new Uint8Array(40)),
        }),
        manager.write(ownerA, processId, {
          token: grant.token,
          requestId: "write-2",
          data: encodeBytes(new Uint8Array(40)),
        }),
        manager.write(ownerA, processId, {
          token: grant.token,
          requestId: "write-3",
          data: encodeBytes(new Uint8Array(40)),
        }),
      ]);

      const fulfilled = writes.filter((w) => w.status === "fulfilled");
      const rejected = writes.filter((w) => w.status === "rejected");
      expect(fulfilled.length).toBe(2);
      expect(rejected.length).toBe(1);
      expect(((rejected[0] as PromiseRejectedResult).reason as ProcessError).code).toBe(QUEUE_FULL);
    });

    it("[Issue 6] 终态保留输出日志纳入宿主配额，超额时按 LRU 淘汰旧日志", async () => {
      const { manager } = createManager({
        maxOutputBufferBytesPerProcess: 2048,
        maxOutputBufferBytesPerHost: 2048, // 宿主上限 2048 字节
      });

      // 启动并退出进程 1，产生 1500 字节保留日志
      const p1 = await manager.start(ownerA, {
        requestId: "req-p1",
        spec: defaultSpec,
        limits: { outputBufferBytes: 2048 },
      });
      const handle1 = (manager as any).processes.get(p1.process.id).handle;
      handle1.emitOutput("stdout", new Uint8Array(1500));
      handle1.emitExit(0, null);
      handle1.emitOutputClosed("natural");

      // 启动第 2 个进程，请求 1024 字节：1500 + 1024 > 2048，触发 LRU 淘汰 p1 的保留日志
      const p2 = await manager.start(ownerA, {
        requestId: "req-p2",
        spec: defaultSpec,
        limits: { outputBufferBytes: 1024 },
      });
      expect(p2.process.id).toBeDefined();

      // p1 终态日志已被淘汰，当 onGap="error" 时抛出 OUTPUT_UNAVAILABLE 错误
      let readErr: any;
      try {
        await manager.read(ownerA, p1.process.id, {
          cursor: p1.initialCursor,
          maxBytes: 65536,
          waitMs: 0,
          onGap: "error",
        });
      } catch (err) {
        readErr = err;
      }
      expect(readErr).toBeInstanceOf(ProcessError);
      expect(readErr?.code).toBe(OUTPUT_UNAVAILABLE);

      // 当 onGap="skip" 时，返回明确的淘汰断层信息
      const skipped = await manager.read(ownerA, p1.process.id, {
        cursor: p1.initialCursor,
        maxBytes: 65536,
        waitMs: 0,
        onGap: "skip",
      });
      expect(skipped.chunks.length).toBe(0);
      expect(skipped.truncated).toBe(true);
      expect(skipped.gap).toBeDefined();
      expect(skipped.eof).toBe(true);
    });

    it("[Issue 7] 底层驱动在 spawn 解决前已触发退出时，启动完成不会覆盖已收到的退出状态", async () => {
      const driver = new MemoryProcessDriver();
      driver.spawnHook = (_processId, _spec, callbacks) => {
        callbacks?.onExit?.({ code: 42, signal: null });
        callbacks?.onOutputClosed?.("natural");
      };

      const manager = new ProcessManager({
        hostEpoch: "epoch-1",
        driver,
      });

      const res = await manager.start(ownerA, {
        requestId: "req-early-exit",
        spec: defaultSpec,
      });

      // 启动结果中状态必须保留为 exited，不能被覆写为 running
      expect(res.process.state).toBe("exited");
      expect(res.process.exit?.code).toBe(42);

      const inspectRes = await manager.inspect(ownerA, res.process.id);
      expect(inspectRes.state).toBe("exited");
      expect(inspectRes.exit?.code).toBe(42);
    });
  });
});
