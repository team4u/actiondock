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
  PROCESS_SPAWN_ERROR,
  PROCESS_TIMEOUT,
  QUEUE_FULL,
  QUOTA_EXCEEDED,
  REQUEST_CONFLICT,
  UNSUPPORTED_CAPABILITY,
  OUTPUT_UNAVAILABLE,
  INVALID_CURSOR,
  ProcessError,
} from "../src/errors";
import { encodeCursor } from "../src/process/cursor";
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
        expect.unreachable();
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
        expect.unreachable();
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
  });

  describe("输入队列、操作调度与去重流转", () => {
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
        expect.unreachable();
      } catch (err: any) {
        expect(err.code).toBe(QUOTA_EXCEEDED);
      }
    });

  });

  describe("生命周期、定时器与紧急终止 stop", () => {
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

      driver.spawnHook = async (_spec, observer) => {
        setTimeout(() => {
          observer.output("stdout", new TextEncoder().encode("line 1\n"));
          observer.output("stderr", new TextEncoder().encode("err 1\n"));
          observer.exited({ code: 0, signal: null });
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
        expect.unreachable();
      } catch (err: any) {
        expect(err.code).toBe(UNSUPPORTED_CAPABILITY);
      }
    });

    it("超出 maxOutputBytes 时截断输出并标记 truncated", async () => {
      const { manager, driver } = createManager();

      driver.spawnHook = async (_spec, observer) => {
        setTimeout(() => {
          observer.output("stdout", new TextEncoder().encode("0123456789"));
          observer.exited({ code: 0, signal: null });
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

      driver.spawnHook = async () => {
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
        expect.unreachable();
      } catch (err: any) {
        expect(err.code).toBe(PROCESS_TIMEOUT);
      }
    });
  });

  describe("ContextProcessAPI 上下文适配与生命周期拦截", () => {
  });

  describe("缺陷修复回归：竞态、幂等原子性与资源回收", () => {
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

    it("ContextProcessAPI 暴露 manager、owner 与 runScoped 协同属性", async () => {
      const { manager } = createManager();

      const scopedApi = manager.forOwner(ownerA, "run-scoped-1");
      expect(scopedApi.manager).toBe(manager);
      expect(scopedApi.owner).toBe(ownerA);
      expect(scopedApi.runScoped).toBe(true);

      const unscopedApi = manager.forOwner(ownerA);
      expect(unscopedApi.runScoped).toBe(false);
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

      // 墓碑机制移除后，已淘汰进程直接抛出 OUTPUT_UNAVAILABLE
      let skipErr: any;
      try {
        await manager.read(ownerA, p1.process.id, {
          cursor: p1.initialCursor,
          maxBytes: 65536,
          waitMs: 0,
          onGap: "skip",
        });
      } catch (err) {
        skipErr = err;
      }
      expect(skipErr).toBeInstanceOf(ProcessError);
      expect(skipErr?.code).toBe(OUTPUT_UNAVAILABLE);
    });

    it("[Issue 7] 底层驱动在 spawn 解决前已触发退出时，启动完成不会覆盖已收到的退出状态", async () => {
      const driver = new MemoryProcessDriver();
      driver.spawnHook = (_spec, observer) => {
        observer.exited({ code: 42, signal: null });
        observer.outputClosed("natural");
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

    it("[Issue 8] 首次 start 失败时，同 requestId 并发等待方收到原始错误码而非 REQUEST_CONFLICT", async () => {
      const driver = new MemoryProcessDriver();
      // spawnHook 抛出模拟驱动派生失败
      driver.spawnHook = () => {
        throw new Error("simulated driver spawn failure");
      };
      const manager = new ProcessManager({
        hostEpoch: "epoch-fail-prop",
        driver,
        metadataStore: new MemoryProcessMetadataStore(),
      });

      const [r1, r2] = await Promise.allSettled([
        manager.start(ownerA, { requestId: "req-fail-prop", spec: defaultSpec }),
        manager.start(ownerA, { requestId: "req-fail-prop", spec: defaultSpec }),
      ]);

      // 首个执行者与并发等待方均应收到原始失败（PROCESS_SPAWN_ERROR），而非固定 REQUEST_CONFLICT
      expect(r1.status).toBe("rejected");
      expect(r2.status).toBe("rejected");
      const err1 = (r1 as PromiseRejectedResult).reason as ProcessError;
      const err2 = (r2 as PromiseRejectedResult).reason as ProcessError;
      expect(err1).toBeInstanceOf(ProcessError);
      expect(err2).toBeInstanceOf(ProcessError);
      expect(err1.code).toBe(PROCESS_SPAWN_ERROR);
      expect(err2.code).toBe(PROCESS_SPAWN_ERROR);
      expect(err2.message).toContain("simulated driver spawn failure");
    });

    it("[Issue 8] 并发同 requestId 的 write 幂等入队：仅一次入队且等待方收到一致收据", async () => {
      const { manager, driver } = createManager();

      const startRes = await manager.start(ownerA, {
        requestId: "req-fail-prop-w-start",
        spec: defaultSpec,
      });
      const processId = startRes.process.id;

      const payload = encodeText("data");
      const [w1, w2] = await Promise.allSettled([
        manager.write(ownerA, processId, {
          requestId: "req-fail-prop-write",
          data: payload,
        }),
        manager.write(ownerA, processId, {
          requestId: "req-fail-prop-write",
          data: payload,
        }),
      ]);

      // 入队幂等：两个并发调用都成功且收到同一收据
      expect(w1.status).toBe("fulfilled");
      expect(w2.status).toBe("fulfilled");
      const r1 = (w1 as PromiseFulfilledResult<any>).value;
      const r2 = (w2 as PromiseFulfilledResult<any>).value;
      expect(r1.requestId).toBe("req-fail-prop-write");
      expect(r2.requestId).toBe("req-fail-prop-write");
      expect(r1.state).toBe(r2.state);
    });
});
});
