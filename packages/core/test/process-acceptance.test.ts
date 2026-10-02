import assert from "node:assert/strict";
import { describe, it } from "node:test";
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

    assert.strictEqual(result2.process.id, result1.process.id);
    assert.strictEqual(result2.initialCursor, result1.initialCursor);
    assert.strictEqual(driver.handles.size, 1);
  });

  it("start 取消与 spawn 成功交错：不泄漏未交付进程，取消胜出时执行 stop", async () => {
    const { manager, driver } = createManager();

    let createdHandle: MemoryProcessDriverHandle | undefined;
    driver.spawnHook = async (spec: LaunchSpec, observer: any) => {
      // 模拟驱动派生异步耗时
      await new Promise((resolve) => setTimeout(resolve, 40));
      createdHandle = new MemoryProcessDriverHandle(observer.processId || "test-proc", spec, {
        onOutput: (stream, data) => observer.output(stream, data),
        onExit: (exit) => observer.exited(exit),
        onOutputClosed: (reason) => observer.outputClosed(reason),
        onError: (err) => observer.fault?.(err),
      });
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

    await assert.rejects(startPromise, ProcessError);

    try {
      await startPromise;
      assert.fail("不应到达此分支");
    } catch (err: any) {
      assert.strictEqual(err.code, PROCESS_CANCELLED);
    }

    // 等待异步 spawn 完成后的取消清理工作流转
    await new Promise((resolve) => setTimeout(resolve, 60));

    // 驱动句柄已被执行终止，未发生进程泄漏
    assert.notStrictEqual(createdHandle, undefined);
    assert.strictEqual(createdHandle!.terminated, true);

    const listRes = await manager.list(ownerA, {});
    const proc = listRes.processes.find((p) => p.id === createdHandle!.processId);
    assert.notStrictEqual(proc, undefined);
    assert.strictEqual(proc!.state, "exited");
    assert.strictEqual(proc!.endReason, "requested");
    assert.strictEqual(proc!.control, "closed");
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
    assert.strictEqual(read1.chunks.length, 1);
    assert.strictEqual(bytes1.byteLength, 30);
    assert.strictEqual(bytes1[0], 0);
    assert.strictEqual(bytes1[29], 29);

    // 第二次读取 40 字节
    const read2 = await manager.read(ownerA, processId, {
      cursor: read1.nextCursor,
      maxBytes: 40,
      waitMs: 0,
      onGap: "error",
    });
    const bytes2 = decodeBytes(read2.chunks[0].data);
    assert.strictEqual(read2.chunks.length, 1);
    assert.strictEqual(bytes2.byteLength, 40);
    assert.strictEqual(bytes2[0], 30);
    assert.strictEqual(bytes2[39], 69);

    // 第三次读取剩余 30 字节（请求上限 50 字节）
    const read3 = await manager.read(ownerA, processId, {
      cursor: read2.nextCursor,
      maxBytes: 50,
      waitMs: 0,
      onGap: "error",
    });
    const bytes3 = decodeBytes(read3.chunks[0].data);
    assert.strictEqual(read3.chunks.length, 1);
    assert.strictEqual(bytes3.byteLength, 30);
    assert.strictEqual(bytes3[0], 70);
    assert.strictEqual(bytes3[29], 99);

    // 拼接全部三次分页返回的字节，与原始字节完全对齐
    const combined = new Uint8Array(100);
    combined.set(bytes1, 0);
    combined.set(bytes2, 30);
    combined.set(bytes3, 70);
    assert.deepStrictEqual(combined, originalBytes);
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

    assert.strictEqual(readRes.chunks.length, stdoutBytes.length + stderrBytes.length);

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

    assert.strictEqual(decodedStdout, stdoutText);
    assert.strictEqual(decodedStderr, stderrText);
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
    await assert.rejects(
      manager.read(ownerA, processId, {
        cursor: initialCursor,
        maxBytes: 100,
        waitMs: 0,
        onGap: "error",
      })
    , ProcessError);

    try {
      await manager.read(ownerA, processId, {
        cursor: initialCursor,
        maxBytes: 100,
        waitMs: 0,
        onGap: "error",
      });
      assert.fail("不应到达此分支");
    } catch (err: any) {
      assert.strictEqual(err.code, OUTPUT_GAP);
      assert.notStrictEqual(err.details?.earliestCursor, undefined);
    }

    // 使用 onGap="skip" 读取，报告 gap 并跳至当前最早可用游标
    const skipRead = await manager.read(ownerA, processId, {
      cursor: initialCursor,
      maxBytes: 100,
      waitMs: 0,
      onGap: "skip",
    });

    assert.strictEqual(skipRead.truncated, true);
    assert.notStrictEqual(skipRead.gap, undefined);
    assert.strictEqual(skipRead.gap?.fromCursor, initialCursor);
    assert.ok((skipRead.chunks.length) > 0);
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
    assert.strictEqual(result.chunks.length, 1);
    assert.strictEqual(decodeText(result.chunks[0].data), "timely output notification");
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
    assert.strictEqual(infoExited.state, "exited");

    // 第一次读取仍能读取到未消费的尾部输出，此时 eof 为 false
    const read1 = await manager.read(ownerA, processId, {
      cursor: startRes.initialCursor,
      maxBytes: 1024,
      waitMs: 0,
      onGap: "error",
    });
    assert.strictEqual(read1.chunks.length, 1);
    assert.strictEqual(decodeText(read1.chunks[0].data), "trailing output before process death\n");
    assert.strictEqual(read1.eof, false);

    // 等待 drain deadline 超时关闭输出
    await new Promise((resolve) => setTimeout(resolve, 60));

    // 第二次读取在读完数据后返回 EOF 为 true
    const read2 = await manager.read(ownerA, processId, {
      cursor: read1.nextCursor,
      maxBytes: 1024,
      waitMs: 0,
      onGap: "error",
    });
    assert.strictEqual(read2.chunks.length, 0);
    assert.strictEqual(read2.eof, true);
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
    assert.strictEqual(infoImmediate.state, "exited");
    assert.strictEqual(infoImmediate.outputClosed, false);

    // 等待 drain deadline 宽限期生效（40ms）
    await new Promise((resolve) => setTimeout(resolve, 60));

    const infoDrained = await manager.inspect(ownerA, processId);
    assert.strictEqual(infoDrained.outputClosed, true);
    assert.strictEqual(infoDrained.outputEndReason, "drain-timeout");

    const readRes = await manager.read(ownerA, processId, {
      cursor: startRes.initialCursor,
      maxBytes: 1024,
      waitMs: 0,
      onGap: "error",
    });
    assert.strictEqual(readRes.eof, true);
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
    assert.strictEqual(recovered, 1);

    const procRecord = await metadataStore.getProcess("proc-host-crashed");
    assert.strictEqual(procRecord?.state, "lost");
    assert.strictEqual(procRecord?.control, "closed");
    assert.strictEqual(procRecord?.endReason, "host-lost");

    // 驱动中未执行盲目 kill 操作，保护了系统可能复用的 PID
    assert.strictEqual(driver.handles.size, 0);
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
    await assert.rejects(
      manager.start(ownerA, {
        requestId: "req-quota-p3",
        spec: defaultSpec,
      })
    , ProcessError);

    try {
      await manager.start(ownerA, {
        requestId: "req-quota-p3",
        spec: defaultSpec,
      });
      assert.fail("不应到达此分支");
    } catch (err: any) {
      assert.strictEqual(err.code, QUOTA_EXCEEDED);
    }

    // 终止通道始终可用不受配额阻断
    const stopResult = await manager.stop(ownerA, p1.process.id, {
      requestId: "req-quota-free-p1",
      graceMs: 10,
    });
    assert.strictEqual(stopResult.state, "exited");
    assert.strictEqual(stopResult.control, "closed");

    // 释放配额后可以成功启动新进程
    const p3 = await manager.start(ownerA, {
      requestId: "req-quota-p3-retry",
      spec: defaultSpec,
    });
    assert.notStrictEqual(p3.process.id, undefined);

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
    assert.strictEqual(exitedInfo.state, "exited");
    assert.strictEqual(exitedInfo.outputClosed, false);

    handle.emitOutputClosed("natural");

    const closedInfo = await manager.inspect(ownerA, processId);
    assert.strictEqual(closedInfo.outputClosed, true);
    assert.strictEqual(closedInfo.outputEndReason, "natural");
  });
});
