import { describe, expect, it } from "bun:test";
import {
  createIncrementalTextDecoder,
  decodeBytes,
  decodeText,
  encodeBytes,
  encodeText,
  type LaunchSpec,
} from "@actiondock/sdk";
import {
  CONTROL_BUSY,
  CONTROL_REVOKED,
  INPUT_CLOSED,
  INPUT_OUTCOME_UNKNOWN,
  OUTPUT_GAP,
  PROCESS_CANCELLED,
  PROCESS_QUARANTINED,
  QUEUE_FULL,
  QUOTA_EXCEEDED,
  REQUEST_CONFLICT,
  ProcessError,
} from "../src/errors";
import { ContextProcessAPI } from "../src/process/context-process";
import { MemoryProcessDriver, MemoryProcessDriverHandle } from "../src/process/driver";
import { MemoryProcessMetadataStore } from "../src/process/metadata-store";
import {
  ProcessManager,
  type ProcessManagerOptions,
  type ProcessOwner,
} from "../src/process/process-manager";

describe("Managed Process 第 18 节全量验收测试套件", () => {
  const ownerA: ProcessOwner = {
    tenantId: "tenant-acceptance",
    principalId: "user-acceptance",
    packageInstanceId: "pkg-acceptance",
    generationId: "gen-1",
  };

  const defaultSpec: LaunchSpec = {
    executable: "echo",
    args: ["acceptance"],
    io: { mode: "pipe" },
  };

  const createManager = (
    options?: Partial<Omit<ProcessManagerOptions, "driver">> & { driver?: MemoryProcessDriver }
  ) => {
    const driver: MemoryProcessDriver = options?.driver ?? new MemoryProcessDriver();
    const metadataStore = options?.metadataStore ?? new MemoryProcessMetadataStore();
    const manager = new ProcessManager({
      hostEpoch: "epoch-acceptance-1",
      driver,
      metadataStore,
      drainDeadlineMs: 40,
      ...options,
    });
    return { driver, metadataStore, manager };
  };

  it("两个 Run 同时申请独占控制：只有一个 grant 有效，另一方排队或超时", async () => {
    const { manager } = createManager();

    const startRes = await manager.start(ownerA, {
      requestId: "req-acq-race-start",
      spec: defaultSpec,
    });
    const processId = startRes.process.id;

    // Run 1 获取控制权
    const grant1 = await manager.acquire(
      ownerA,
      processId,
      {
        requestId: "req-run-1-acq",
        waitMs: 1000,
        ttlMs: 10000,
      },
      undefined,
      "run-1"
    );
    expect(grant1.token).toBeDefined();

    // Run 2 短暂等待控制权，超时失败
    await expect(
      manager.acquire(
        ownerA,
        processId,
        {
          requestId: "req-run-2-short-wait",
          waitMs: 30,
          ttlMs: 5000,
        },
        undefined,
        "run-2"
      )
    ).rejects.toThrow(ProcessError);

    try {
      await manager.acquire(
        ownerA,
        processId,
        {
          requestId: "req-run-2-short-wait",
          waitMs: 30,
          ttlMs: 5000,
        },
        undefined,
        "run-2"
      );
    } catch (err: any) {
      expect(err.code).toBe(CONTROL_BUSY);
    }

    // Run 3 具有足够等待时间排队
    let waiterRun3Acquired = false;
    const run3Promise = manager
      .acquire(
        ownerA,
        processId,
        {
          requestId: "req-run-3-queue",
          waitMs: 5000,
          ttlMs: 10000,
        },
        undefined,
        "run-3"
      )
      .then((g) => {
        waiterRun3Acquired = true;
        return g;
      });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(waiterRun3Acquired).toBe(false);

    // Run 1 释放控制权后，Run 3 成功获取
    await manager.release(ownerA, processId, grant1.token);
    const grant3 = await run3Promise;

    expect(waiterRun3Acquired).toBe(true);
    expect(grant3.token).toBeDefined();
    expect(grant3.token).not.toBe(grant1.token);

    await manager.release(ownerA, processId, grant3.token);
  });

  it("A 输入后 lease 到期，B 请求控制：资源隔离，B 无法写入仍在运行的 A 程序", async () => {
    const { manager, driver } = createManager();

    const startRes = await manager.start(ownerA, {
      requestId: "req-lease-expiry-start",
      spec: defaultSpec,
    });
    const processId = startRes.process.id;

    // Run A 获取短期 lease
    const grantA = await manager.acquire(
      ownerA,
      processId,
      {
        requestId: "req-acq-a",
        waitMs: 1000,
        ttlMs: 40,
      },
      undefined,
      "run-a"
    );

    // A 正常写入数据
    await manager.write(ownerA, processId, {
      token: grantA.token,
      requestId: "req-write-from-a",
      data: encodeText("message from A"),
    });

    // 等待 lease 到期，未续租未释放
    await new Promise((resolve) => setTimeout(resolve, 80));

    // 状态机自动转入 quarantined
    const infoQuarantined = await manager.inspect(ownerA, processId);
    expect(infoQuarantined.control).toBe("quarantined");

    // Run B 尝试申请控制权，被拒绝并抛出 PROCESS_QUARANTINED
    await expect(
      manager.acquire(
        ownerA,
        processId,
        {
          requestId: "req-acq-b",
          waitMs: 100,
          ttlMs: 5000,
        },
        undefined,
        "run-b"
      )
    ).rejects.toThrow(ProcessError);

    try {
      await manager.acquire(
        ownerA,
        processId,
        {
          requestId: "req-acq-b",
          waitMs: 100,
          ttlMs: 5000,
        },
        undefined,
        "run-b"
      );
    } catch (err: any) {
      expect(err.code).toBe(PROCESS_QUARANTINED);
    }

    // Run B 尝试盲写，同样被拒绝
    await expect(
      manager.write(ownerA, processId, {
        token: grantA.token,
        requestId: "req-write-from-b",
        data: encodeText("malicious input from B"),
      })
    ).rejects.toThrow(ProcessError);

    try {
      await manager.write(ownerA, processId, {
        token: grantA.token,
        requestId: "req-write-from-b",
        data: encodeText("malicious input from B"),
      });
    } catch (err: any) {
      expect(err.code).toBe(PROCESS_QUARANTINED);
    }

    // 校验驱动中仅存在 A 的输入，B 未能穿透写入
    const handle = driver.handles.get(processId)!;
    expect(handle.writtenChunks.length).toBe(1);
    expect(new TextDecoder().decode(handle.writtenChunks[0])).toBe("message from A");
  });

  it("旧 token 的输入已排队但未 dispatch：失效后被拒绝，不进入 driver", async () => {
    const { manager, driver } = createManager();

    const startRes = await manager.start(ownerA, {
      requestId: "req-queued-dispatch-start",
      spec: defaultSpec,
    });
    const processId = startRes.process.id;

    const grant = await manager.acquire(ownerA, processId, {
      requestId: "req-dispatch-acq",
      waitMs: 1000,
      ttlMs: 10000,
    });

    // 挂起底层驱动写入
    let resolveFirstWrite: (() => void) | undefined;
    const handle = driver.handles.get(processId)!;
    handle.write = () =>
      new Promise<void>((resolve) => {
        resolveFirstWrite = resolve;
      });

    // 提交第 1 条写入操作进入 dispatching
    await manager.write(ownerA, processId, {
      token: grant.token,
      requestId: "req-write-op-1",
      data: encodeText("first payload"),
    });

    // 提交第 2 条写入操作滞留于队列中
    await manager.write(ownerA, processId, {
      token: grant.token,
      requestId: "req-write-op-2",
      data: encodeText("second payload"),
    });

    // 此时主动隔离目标进程（撤销 control 与 grant）
    await manager.quarantineProcess(ownerA, processId, grant.token, "Manual quarantine before dispatch");

    // 恢复第 1 条底层写入完成
    if (resolveFirstWrite) {
      resolveFirstWrite();
    }

    // 等待微任务调度第二条操作
    await new Promise((resolve) => setTimeout(resolve, 30));

    // 第 2 条操作应被拒绝且未写入底层驱动
    const op2 = await manager.operation(ownerA, processId, "req-write-op-2");
    expect(op2.state).toBe("failed");
    expect(op2.errorCode).toBe(CONTROL_REVOKED);
    expect(handle.writtenChunks.length).toBe(0);
  });

  it("write 响应丢失后同 requestId 重试：仅一次入队，可查询原 receipt", async () => {
    const { manager, driver } = createManager();

    const startRes = await manager.start(ownerA, {
      requestId: "req-write-retry-start",
      spec: defaultSpec,
    });
    const processId = startRes.process.id;

    const grant = await manager.acquire(ownerA, processId, {
      requestId: "req-retry-acq",
      waitMs: 1000,
      ttlMs: 10000,
    });

    const payload = encodeText("retry payload test");

    // 第一次发送写入
    const receipt1 = await manager.write(ownerA, processId, {
      token: grant.token,
      requestId: "req-write-idempotent",
      data: payload,
    });
    expect(receipt1.requestId).toBe("req-write-idempotent");

    // 模拟网络掉线或响应丢失，使用完全相同的 requestId 与负载重试
    const receipt2 = await manager.write(ownerA, processId, {
      token: grant.token,
      requestId: "req-write-idempotent",
      data: payload,
    });
    expect(receipt2.requestId).toBe(receipt1.requestId);

    // 等待后台调度执行
    await new Promise((resolve) => setTimeout(resolve, 20));

    const finalOp = await manager.operation(ownerA, processId, "req-write-idempotent");
    expect(finalOp.state).toBe("completed");
    expect(finalOp.acceptedBytes).toBe(decodeBytes(payload).byteLength);

    // 底层驱动仅入队并执行了一次写入
    const handle = driver.handles.get(processId)!;
    expect(handle.writtenChunks.length).toBe(1);
  });

  it("同 ID 不同负载：REQUEST_CONFLICT，无新增输入", async () => {
    const { manager, driver } = createManager();

    const startRes = await manager.start(ownerA, {
      requestId: "req-conflict-start",
      spec: defaultSpec,
    });
    const processId = startRes.process.id;

    const grant = await manager.acquire(ownerA, processId, {
      requestId: "req-conflict-acq",
      waitMs: 1000,
      ttlMs: 10000,
    });

    // 首次写入
    await manager.write(ownerA, processId, {
      token: grant.token,
      requestId: "req-same-id-diff-payload",
      data: encodeText("original content"),
    });

    // 相同 requestId 不同负载
    await expect(
      manager.write(ownerA, processId, {
        token: grant.token,
        requestId: "req-same-id-diff-payload",
        data: encodeText("altered content"),
      })
    ).rejects.toThrow(ProcessError);

    try {
      await manager.write(ownerA, processId, {
        token: grant.token,
        requestId: "req-same-id-diff-payload",
        data: encodeText("altered content"),
      });
    } catch (err: any) {
      expect(err.code).toBe(REQUEST_CONFLICT);
    }

    await new Promise((resolve) => setTimeout(resolve, 20));

    const handle = driver.handles.get(processId)!;
    expect(handle.writtenChunks.length).toBe(1);
    expect(new TextDecoder().decode(handle.writtenChunks[0])).toBe("original content");
  });

  it("driver 部分写入后失败：unknown、隔离；不自动重放", async () => {
    const { manager, driver } = createManager();

    const startRes = await manager.start(ownerA, {
      requestId: "req-driver-fail-start",
      spec: defaultSpec,
    });
    const processId = startRes.process.id;

    const grant = await manager.acquire(ownerA, processId, {
      requestId: "req-driver-fail-acq",
      waitMs: 1000,
      ttlMs: 10000,
    });

    // 注入驱动写入故障
    const handle = driver.handles.get(processId)!;
    handle.writeFailureError = new Error("EPIPE: Partial socket write failure");

    await manager.write(ownerA, processId, {
      token: grant.token,
      requestId: "req-op-uncertain-failure",
      data: encodeText("doomed data"),
    });

    // 等待调度执行失败捕获
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 回执标记为 unknown 且错误码为 INPUT_OUTCOME_UNKNOWN
    const op = await manager.operation(ownerA, processId, "req-op-uncertain-failure");
    expect(op.state).toBe("unknown");
    expect(op.errorCode).toBe(INPUT_OUTCOME_UNKNOWN);

    // 进程控制状态被置入 quarantined 隔离状态
    const info = await manager.inspect(ownerA, processId);
    expect(info.control).toBe("quarantined");

    // 不自动重放：后续写入被直接拒绝
    await expect(
      manager.write(ownerA, processId, {
        token: grant.token,
        requestId: "req-op-after-quarantine",
        data: encodeText("attempt retry"),
      })
    ).rejects.toThrow(ProcessError);
  });

  it("start 创建成功但响应丢失：同 requestId 返回同一资源", async () => {
    const { manager, driver } = createManager();

    const result1 = await manager.start(ownerA, {
      requestId: "req-start-lost-response",
      spec: defaultSpec,
    });

    // 模拟调用端未收到响应重新发起相同请求
    const result2 = await manager.start(ownerA, {
      requestId: "req-start-lost-response",
      spec: defaultSpec,
    });

    expect(result2.process.id).toBe(result1.process.id);
    expect(result2.initialCursor).toBe(result1.initialCursor);
    expect(driver.handles.size).toBe(1);
  });

  it("start 取消与 spawn 成功交错：不泄漏未交付进程，取消胜出时执行 stop", async () => {
    const { manager, driver } = createManager();

    let createdHandle: MemoryProcessDriverHandle | undefined;
    driver.spawnHook = async (processId: string, spec: LaunchSpec, callbacks: any) => {
      // 模拟驱动派生异步耗时
      await new Promise((resolve) => setTimeout(resolve, 40));
      createdHandle = new MemoryProcessDriverHandle(processId, spec, callbacks);
      return createdHandle;
    };

    const controller = new AbortController();
    const startPromise = manager.start(
      ownerA,
      {
        requestId: "req-start-cancel-race",
        spec: defaultSpec,
      },
      { signal: controller.signal }
    );

    // 在 spawn 挂起期间触发取消
    setTimeout(() => {
      controller.abort();
    }, 15);

    await expect(startPromise).rejects.toThrow(ProcessError);

    try {
      await startPromise;
    } catch (err: any) {
      expect(err.code).toBe(PROCESS_CANCELLED);
    }

    // 等待异步 spawn 完成后的取消清理工作流转
    await new Promise((resolve) => setTimeout(resolve, 60));

    // 驱动句柄已被执行终止，未发生进程泄漏
    expect(createdHandle).toBeDefined();
    expect(createdHandle!.terminated).toBe(true);

    const listRes = await manager.list(ownerA, {});
    const proc = listRes.processes.find((p) => p.id === createdHandle!.processId);
    expect(proc).toBeDefined();
    expect(proc!.state).toBe("exited");
    expect(proc!.endReason).toBe("requested");
    expect(proc!.control).toBe("closed");
  });

  it("大于 maxBytes 的单个输出 chunk：多次分页拼接得到完整原始字节", async () => {
    const { manager, driver } = createManager();

    const startRes = await manager.start(ownerA, {
      requestId: "req-large-chunk-start",
      spec: defaultSpec,
    });
    const processId = startRes.process.id;

    // 生成单块 100 字节的原始数据
    const originalBytes = new Uint8Array(100);
    for (let i = 0; i < 100; i++) {
      originalBytes[i] = i;
    }

    const handle = driver.handles.get(processId)!;
    handle.emitOutput("stdout", originalBytes);

    // 第一次读取 30 字节
    const read1 = await manager.read(ownerA, processId, {
      cursor: startRes.initialCursor,
      maxBytes: 30,
      waitMs: 0,
      onGap: "error",
    });
    const bytes1 = decodeBytes(read1.chunks[0].data);
    expect(read1.chunks.length).toBe(1);
    expect(bytes1.byteLength).toBe(30);
    expect(bytes1[0]).toBe(0);
    expect(bytes1[29]).toBe(29);

    // 第二次读取 40 字节
    const read2 = await manager.read(ownerA, processId, {
      cursor: read1.nextCursor,
      maxBytes: 40,
      waitMs: 0,
      onGap: "error",
    });
    const bytes2 = decodeBytes(read2.chunks[0].data);
    expect(read2.chunks.length).toBe(1);
    expect(bytes2.byteLength).toBe(40);
    expect(bytes2[0]).toBe(30);
    expect(bytes2[39]).toBe(69);

    // 第三次读取剩余 30 字节（请求上限 50 字节）
    const read3 = await manager.read(ownerA, processId, {
      cursor: read2.nextCursor,
      maxBytes: 50,
      waitMs: 0,
      onGap: "error",
    });
    const bytes3 = decodeBytes(read3.chunks[0].data);
    expect(read3.chunks.length).toBe(1);
    expect(bytes3.byteLength).toBe(30);
    expect(bytes3[0]).toBe(70);
    expect(bytes3[29]).toBe(99);

    // 拼接全部三次分页返回的字节，与原始字节完全对齐
    const combined = new Uint8Array(100);
    combined.set(bytes1, 0);
    combined.set(bytes2, 30);
    combined.set(bytes3, 70);
    expect(combined).toEqual(originalBytes);
  });

  it("UTF-8 每个字节分块、stdout/stderr 交错：逐流解码正确，不声称真实跨流全序", async () => {
    const { manager, driver } = createManager();

    const startRes = await manager.start(ownerA, {
      requestId: "req-utf8-interleave-start",
      spec: defaultSpec,
    });
    const processId = startRes.process.id;

    const handle = driver.handles.get(processId)!;

    const stdoutText = "测试标准输出多字节内容。";
    const stderrText = "警告异常诊断通道。";

    const stdoutBytes = new TextEncoder().encode(stdoutText);
    const stderrBytes = new TextEncoder().encode(stderrText);

    // 按单字节交错推送至 stdout 与 stderr
    const maxLen = Math.max(stdoutBytes.length, stderrBytes.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < stdoutBytes.length) {
        handle.emitOutput("stdout", new Uint8Array([stdoutBytes[i]]));
      }
      if (i < stderrBytes.length) {
        handle.emitOutput("stderr", new Uint8Array([stderrBytes[i]]));
      }
    }

    // 全量读取所有输出块
    const readRes = await manager.read(ownerA, processId, {
      cursor: startRes.initialCursor,
      maxBytes: 10000,
      waitMs: 0,
      onGap: "error",
    });

    expect(readRes.chunks.length).toBe(stdoutBytes.length + stderrBytes.length);

    // 使用 SDK 规范的逐流增量 UTF-8 解码器分别重组
    const decoder = createIncrementalTextDecoder();
    let decodedStdout = "";
    let decodedStderr = "";

    for (const chunk of readRes.chunks) {
      if (chunk.stream === "stdout") {
        decodedStdout += decoder.decode(chunk);
      } else if (chunk.stream === "stderr") {
        decodedStderr += decoder.decode(chunk);
      }
    }

    decodedStdout += decoder.flush("stdout");
    decodedStderr += decoder.flush("stderr");

    expect(decodedStdout).toBe(stdoutText);
    expect(decodedStderr).toBe(stderrText);
  });

  it("ring buffer 淘汰当前 cursor：明确 gap；error 模式不自动推进", async () => {
    const { manager, driver } = createManager();

    // 设置单个进程缓冲区容量为 100 字节
    const startRes = await manager.start(ownerA, {
      requestId: "req-gap-start",
      spec: defaultSpec,
      limits: { outputBufferBytes: 100 },
    });
    const processId = startRes.process.id;
    const initialCursor = startRes.initialCursor;

    const handle = driver.handles.get(processId)!;

    // 推送 60 字节
    handle.emitOutput("stdout", new Uint8Array(60).fill(1));
    // 再次推送 60 字节，超出 100 字节容量，导致第 1 块被部分或全部淘汰
    handle.emitOutput("stderr", new Uint8Array(60).fill(2));

    // 使用淘汰后的 initialCursor 且 onGap="error" 读取
    await expect(
      manager.read(ownerA, processId, {
        cursor: initialCursor,
        maxBytes: 100,
        waitMs: 0,
        onGap: "error",
      })
    ).rejects.toThrow(ProcessError);

    try {
      await manager.read(ownerA, processId, {
        cursor: initialCursor,
        maxBytes: 100,
        waitMs: 0,
        onGap: "error",
      });
    } catch (err: any) {
      expect(err.code).toBe(OUTPUT_GAP);
      expect(err.details?.earliestCursor).toBeDefined();
    }

    // 使用 onGap="skip" 读取，报告 gap 并跳至当前最早可用游标
    const skipRead = await manager.read(ownerA, processId, {
      cursor: initialCursor,
      maxBytes: 100,
      waitMs: 0,
      onGap: "skip",
    });

    expect(skipRead.truncated).toBe(true);
    expect(skipRead.gap).toBeDefined();
    expect(skipRead.gap?.fromCursor).toBe(initialCursor);
    expect(skipRead.chunks.length).toBeGreaterThan(0);
  });

  it("输出到达发生在 waiter 注册附近：无漏唤醒、无无限等待", async () => {
    const { manager, driver } = createManager();

    const startRes = await manager.start(ownerA, {
      requestId: "req-race-waiter-start",
      spec: defaultSpec,
    });
    const processId = startRes.process.id;

    const handle = driver.handles.get(processId)!;

    // 并发发起长轮询等待与输出写入
    const waitPromise = manager.read(ownerA, processId, {
      cursor: startRes.initialCursor,
      maxBytes: 1024,
      waitMs: 500,
      onGap: "error",
    });

    // 立即推送数据
    handle.emitOutput("stdout", "timely output notification");

    const result = await waitPromise;
    expect(result.chunks.length).toBe(1);
    expect(decodeText(result.chunks[0].data)).toBe("timely output notification");
  });

  it("进程 exit 后仍有尾部输出：先退出后读完，未提前 EOF", async () => {
    const { manager, driver } = createManager();

    const startRes = await manager.start(ownerA, {
      requestId: "req-exit-trailing-start",
      spec: defaultSpec,
    });
    const processId = startRes.process.id;

    const handle = driver.handles.get(processId)!;

    // 推送尾部输出后进程退出
    handle.emitOutput("stdout", "trailing output before process death\n");
    handle.emitExit(0, null);

    // 此时进程已 exit
    const infoExited = await manager.inspect(ownerA, processId);
    expect(infoExited.state).toBe("exited");

    // 第一次读取仍能读取到未消费的尾部输出，此时 eof 为 false
    const read1 = await manager.read(ownerA, processId, {
      cursor: startRes.initialCursor,
      maxBytes: 1024,
      waitMs: 0,
      onGap: "error",
    });
    expect(read1.chunks.length).toBe(1);
    expect(decodeText(read1.chunks[0].data)).toBe("trailing output before process death\n");
    expect(read1.eof).toBe(false);

    // 等待 drain deadline 超时关闭输出
    await new Promise((resolve) => setTimeout(resolve, 60));

    // 第二次读取在读完数据后返回 EOF 为 true
    const read2 = await manager.read(ownerA, processId, {
      cursor: read1.nextCursor,
      maxBytes: 1024,
      waitMs: 0,
      onGap: "error",
    });
    expect(read2.chunks.length).toBe(0);
    expect(read2.eof).toBe(true);
  });

  it("后代持续持有输出句柄：drain deadline 生效，输出关闭原因可见", async () => {
    const { manager, driver } = createManager({ drainDeadlineMs: 40 });

    const startRes = await manager.start(ownerA, {
      requestId: "req-drain-deadline-start",
      spec: defaultSpec,
    });
    const processId = startRes.process.id;

    const handle = driver.handles.get(processId)!;

    // 进程退出但未自然关闭输出通道（模拟孙子进程持续持有 stdout）
    handle.emitExit(0, null);

    const infoImmediate = await manager.inspect(ownerA, processId);
    expect(infoImmediate.state).toBe("exited");
    expect(infoImmediate.outputClosed).toBe(false);

    // 等待 drain deadline 宽限期生效（40ms）
    await new Promise((resolve) => setTimeout(resolve, 60));

    const infoDrained = await manager.inspect(ownerA, processId);
    expect(infoDrained.outputClosed).toBe(true);
    expect(infoDrained.outputEndReason).toBe("drain-timeout");

    const readRes = await manager.read(ownerA, processId, {
      cursor: startRes.initialCursor,
      maxBytes: 1024,
      waitMs: 0,
      onGap: "error",
    });
    expect(readRes.eof).toBe(true);
  });

  it("包升级、权限撤销发生在排队期间：dispatch 拒绝，旧资源进入清理", async () => {
    const { manager, driver } = createManager();

    const startRes = await manager.start(ownerA, {
      requestId: "req-upgrade-revoke-start",
      spec: defaultSpec,
    });
    const processId = startRes.process.id;

    const grant = await manager.acquire(ownerA, processId, {
      requestId: "req-upgrade-acq",
      waitMs: 1000,
      ttlMs: 10000,
    });

    // 挂起底层写入
    let resolveWrite: (() => void) | undefined;
    const handle = driver.handles.get(processId)!;
    handle.write = () =>
      new Promise<void>((resolve) => {
        resolveWrite = resolve;
      });

    // 提交首个操作进入调度
    await manager.write(ownerA, processId, {
      token: grant.token,
      requestId: "req-pending-op-1",
      data: encodeText("pending 1"),
    });

    // 排队第二个操作
    await manager.write(ownerA, processId, {
      token: grant.token,
      requestId: "req-pending-op-2",
      data: encodeText("pending 2"),
    });

    // 模拟包升级或者权限撤销：通过 stop 终止清理旧资源
    await manager.stop(ownerA, processId, {
      requestId: "req-upgrade-stop",
      graceMs: 100,
    });

    // 释放首个挂起写入
    if (resolveWrite) {
      resolveWrite();
    }

    await new Promise((resolve) => setTimeout(resolve, 30));

    // 第二个排队操作已被取消拒绝
    const op2 = await manager.operation(ownerA, processId, "req-pending-op-2");
    expect(op2.state).toBe("failed");
    expect(op2.errorCode).toBe(PROCESS_CANCELLED);

    const info = await manager.inspect(ownerA, processId);
    expect(info.state).toBe("exited");
    expect(info.control).toBe("closed");
  });

  it("Run 取消但 shell 仍运行：控制权撤销，资源隔离或被 stop", async () => {
    const { manager } = createManager();

    const startRes = await manager.start(ownerA, {
      requestId: "req-shell-abort-start",
      spec: {
        executable: "bash",
        args: ["-i"],
        io: { mode: "pipe" },
      },
    });
    const processId = startRes.process.id;

    const controller = new AbortController();
    const contextApi = new ContextProcessAPI(
      manager,
      ownerA,
      "run-shell-controller",
      controller.signal
    );

    const grant = await contextApi.acquire(processId, {
      requestId: "req-shell-acq",
      waitMs: 1000,
      ttlMs: 10000,
    });
    expect(grant.token).toBeDefined();

    // 触发 Run 取消信号
    controller.abort();

    await new Promise((resolve) => setTimeout(resolve, 20));

    // 控制权自动被撤销并置入隔离状态 quarantined
    const info = await manager.inspect(ownerA, processId);
    expect(info.control).toBe("quarantined");

    // 隔离状态下无法直接被后续操作侵入
    await expect(
      contextApi.acquire(processId, {
        requestId: "req-shell-acq-again",
        waitMs: 50,
        ttlMs: 1000,
      })
    ).rejects.toThrow(ProcessError);

    // 执行显式 stop 清理 shell
    const stopRes = await manager.stop(ownerA, processId, {
      requestId: "req-shell-stop",
      graceMs: 50,
    });
    expect(stopRes.state).toBe("exited");
    expect(stopRes.control).toBe("closed");
  });

  it("host crash 后 PID 被其他进程复用：旧记录 lost，不盲杀新进程", async () => {
    const metadataStore = new MemoryProcessMetadataStore();

    // 模拟旧宿主崩溃前遗留的进程记录
    await metadataStore.saveProcess({
      processId: "proc-host-crashed",
      tenantId: ownerA.tenantId,
      principalId: ownerA.principalId,
      packageInstanceId: ownerA.packageInstanceId,
      generationId: ownerA.generationId,
      hostEpoch: "epoch-crashed",
      state: "running",
      control: "held",
      controlState: "held",
    });

    const driver = new MemoryProcessDriver();
    const manager = new ProcessManager({
      hostEpoch: "epoch-new-reboot",
      driver,
      metadataStore,
    });

    // 新宿主启动执行恢复初始化
    const recovered = await manager.initialize();
    expect(recovered).toBe(1);

    const procRecord = await metadataStore.getProcess("proc-host-crashed");
    expect(procRecord?.state).toBe("lost");
    expect(procRecord?.control).toBe("closed");
    expect(procRecord?.endReason).toBe("host-lost");

    // 驱动中未执行盲目 kill 操作，保护了系统可能复用的 PID
    expect(driver.handles.size).toBe(0);
  });

  it("yes 刷屏、慢读、stdin 不消费：输出/队列内存有界，stop 仍可执行", async () => {
    const { manager, driver } = createManager({
      quotas: {
        maxPendingQueueBytesPerProcess: 100,
      },
    });

    // 限制单进程输出缓冲区为 300 字节
    const startRes = await manager.start(ownerA, {
      requestId: "req-yes-flood-start",
      spec: defaultSpec,
      limits: { outputBufferBytes: 300 },
    });
    const processId = startRes.process.id;

    const grant = await manager.acquire(ownerA, processId, {
      requestId: "req-flood-acq",
      waitMs: 1000,
      ttlMs: 10000,
    });

    const handle = driver.handles.get(processId)!;

    // - yes 刷屏：推送大量输出（10KB）
    const floodChunk = new Uint8Array(100).fill(121); // 'y'
    for (let i = 0; i < 100; i++) {
      handle.emitOutput("stdout", floodChunk);
    }

    // 验证输出日志内存严格有界（不超过 300 字节配置容量）
    const inspectProc = (manager as any).processes.get(processId);
    expect(inspectProc.outputLog.currentBytes).toBeLessThanOrEqual(300);

    // - stdin 不消费：挂起驱动写入并灌入输入数据
    handle.write = () => new Promise<void>(() => {});

    await manager.write(ownerA, processId, {
      token: grant.token,
      requestId: "req-write-fill-1",
      data: encodeBytes(new Uint8Array(80)),
    });

    // 再次写入 50 字节，超过 100 字节待写入配额，抛出 QUEUE_FULL 拒绝
    await expect(
      manager.write(ownerA, processId, {
        token: grant.token,
        requestId: "req-write-fill-2",
        data: encodeBytes(new Uint8Array(50)),
      })
    ).rejects.toThrow(ProcessError);

    try {
      await manager.write(ownerA, processId, {
        token: grant.token,
        requestId: "req-write-fill-2",
        data: encodeBytes(new Uint8Array(50)),
      });
    } catch (err: any) {
      expect(err.code).toBe(QUEUE_FULL);
    }

    // - 在刷屏与背压爆仓状态下，stop 仍可通畅执行
    const stopped = await manager.stop(ownerA, processId, {
      requestId: "req-flood-stop",
      graceMs: 10,
    });
    expect(stopped.state).toBe("exited");
    expect(stopped.control).toBe("closed");
  });

  it("元数据、去重或资源配额耗尽：明确拒绝新请求，保留终止通道", async () => {
    const { manager } = createManager({
      quotas: {
        maxActiveProcessesPerScope: 2,
      },
    });

    // 启动 2 个进程占满配额
    const p1 = await manager.start(ownerA, {
      requestId: "req-quota-p1",
      spec: defaultSpec,
    });
    const p2 = await manager.start(ownerA, {
      requestId: "req-quota-p2",
      spec: defaultSpec,
    });

    // 尝试启动第 3 个进程触发配额拒绝
    await expect(
      manager.start(ownerA, {
        requestId: "req-quota-p3",
        spec: defaultSpec,
      })
    ).rejects.toThrow(ProcessError);

    try {
      await manager.start(ownerA, {
        requestId: "req-quota-p3",
        spec: defaultSpec,
      });
    } catch (err: any) {
      expect(err.code).toBe(QUOTA_EXCEEDED);
    }

    // 终止通道始终可用不受配额阻断
    const stopResult = await manager.stop(ownerA, p1.process.id, {
      requestId: "req-quota-free-p1",
      graceMs: 10,
    });
    expect(stopResult.state).toBe("exited");
    expect(stopResult.control).toBe("closed");

    // 释放配额后可以成功启动新进程
    const p3 = await manager.start(ownerA, {
      requestId: "req-quota-p3-retry",
      spec: defaultSpec,
    });
    expect(p3.process.id).toBeDefined();

    await manager.stop(ownerA, p2.process.id, { requestId: "req-stop-p2", graceMs: 10 });
    await manager.stop(ownerA, p3.process.id, { requestId: "req-stop-p3", graceMs: 10 });
  });

  it("自然关闭输出通道：取消 drain 宽限期并正确标记 natural 原因", async () => {
    const { manager, driver } = createManager({ drainDeadlineMs: 5000 });

    const startRes = await manager.start(ownerA, {
      requestId: "req-natural-close-start",
      spec: defaultSpec,
    });
    const processId = startRes.process.id;
    const handle = driver.handles.get(processId)!;

    handle.emitExit(0, null);

    const exitedInfo = await manager.inspect(ownerA, processId);
    expect(exitedInfo.state).toBe("exited");
    expect(exitedInfo.outputClosed).toBe(false);

    handle.emitOutputClosed("natural");

    const closedInfo = await manager.inspect(ownerA, processId);
    expect(closedInfo.outputClosed).toBe(true);
    expect(closedInfo.outputEndReason).toBe("natural");
  });
});
