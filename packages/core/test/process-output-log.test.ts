import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INVALID_CURSOR,
  OUTPUT_GAP,
  PROCESS_CANCELLED,
  QUOTA_EXCEEDED,
  ProcessError,
} from "../src/errors";
import {
  compareCursorPos,
  decodeCursor,
  encodeCursor,
  parseCursor,
} from "../src/process/cursor";
import { ProcessOutputLog } from "../src/process/output-log";

describe("不透明游标引擎", () => {
  const hostEpoch = "epoch-test-1";
  const processId = "proc-test-100";

  it("支持正常编码与解析不透明游标", () => {
    const cursorStr = encodeCursor(hostEpoch, processId, 42, 128);
    assert.strictEqual(typeof cursorStr, "string");
    assert.strictEqual(cursorStr.startsWith("cur_"), true);

    const parsed = parseCursor(cursorStr, hostEpoch, processId);
    assert.strictEqual(parsed.sequence, 42);
    assert.strictEqual(parsed.offset, 128);

    const decoded = decodeCursor(cursorStr);
    assert.strictEqual(decoded.hostEpoch, hostEpoch);
    assert.strictEqual(decoded.processId, processId);
    assert.strictEqual(decoded.sequence, 42);
    assert.strictEqual(decoded.offset, 128);
  });

  it("游标坐标比较函数正确判定先后顺序", () => {
    assert.ok((compareCursorPos({ sequence: 1, offset: 0 }, { sequence: 2, offset: 0 })) < 0);
    assert.ok((compareCursorPos({ sequence: 2, offset: 0 }, { sequence: 1, offset: 0 })) > 0);
    assert.ok((compareCursorPos({ sequence: 1, offset: 10 }, { sequence: 1, offset: 20 })) < 0);
    assert.ok((compareCursorPos({ sequence: 1, offset: 20 }, { sequence: 1, offset: 10 })) > 0);
    assert.strictEqual(compareCursorPos({ sequence: 1, offset: 10 }, { sequence: 1, offset: 10 }), 0);
  });

  it("遇到格式错误与损坏游标抛出 INVALID_CURSOR", () => {
    assert.throws(() => parseCursor("", hostEpoch, processId));
    assert.throws(() => parseCursor("cur_invalid_base64!!!", hostEpoch, processId));

    try {
      parseCursor("cur_not_json", hostEpoch, processId);
      assert.fail("不应到达此分支");
    } catch (err) {
      assert.strictEqual(err instanceof ProcessError, true);
      assert.strictEqual((err as ProcessError).code, INVALID_CURSOR);
    }
  });

  it("跨宿主纪元访问抛出 INVALID_CURSOR 并附带对比详情", () => {
    const cursorStr = encodeCursor("other-epoch", processId, 1, 0);
    try {
      parseCursor(cursorStr, hostEpoch, processId);
      assert.fail("不应到达此分支");
    } catch (err) {
      assert.strictEqual(err instanceof ProcessError, true);
      const procErr = err as ProcessError;
      assert.strictEqual(procErr.code, INVALID_CURSOR);
      assert.strictEqual(procErr.details?.expectedHostEpoch, hostEpoch);
      assert.strictEqual(procErr.details?.actualHostEpoch, "other-epoch");
    }
  });

  it("跨受管进程访问抛出 INVALID_CURSOR 并附带对比详情", () => {
    const cursorStr = encodeCursor(hostEpoch, "other-proc", 1, 0);
    try {
      parseCursor(cursorStr, hostEpoch, processId);
      assert.fail("不应到达此分支");
    } catch (err) {
      assert.strictEqual(err instanceof ProcessError, true);
      const procErr = err as ProcessError;
      assert.strictEqual(procErr.code, INVALID_CURSOR);
      assert.strictEqual(procErr.details?.expectedProcessId, processId);
      assert.strictEqual(procErr.details?.actualProcessId, "other-proc");
    }
  });

  it("编码时非法序号或偏移量抛出 INVALID_CURSOR", () => {
    assert.throws(() => encodeCursor(hostEpoch, processId, -1, 0));
    assert.throws(() => encodeCursor(hostEpoch, processId, 0, -5));
    assert.throws(() => encodeCursor(hostEpoch, processId, 1.5, 0));
  });
});

describe("ProcessOutputLog 原始字节输出日志", () => {
  const hostEpoch = "epoch-test-2";
  const processId = "proc-test-200";

  it("初始化状态与空日志读取", () => {
    const log = new ProcessOutputLog(hostEpoch, processId);

    assert.strictEqual(log.earliestCursor, log.tailCursor);
    assert.strictEqual(log.currentBytes, 0);
    assert.strictEqual(log.outputClosed, false);

    const res = log.read(log.earliestCursor);
    assert.strictEqual(res.chunks.length, 0);
    assert.strictEqual(res.nextCursor, log.earliestCursor);
    assert.strictEqual(res.truncated, false);
    assert.strictEqual(res.eof, false);
  });

  it("支持追加原始字节并按游标顺序读取", () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    const startCursor = log.earliestCursor;

    const data1 = new TextEncoder().encode("Hello, ");
    const data2 = new TextEncoder().encode("ActionDock!");
    log.append("stdout", data1);
    log.append("stderr", data2);

    assert.strictEqual(log.currentBytes, data1.byteLength + data2.byteLength);

    const res = log.read(startCursor);
    assert.strictEqual(res.chunks.length, 2);
    assert.strictEqual(res.chunks[0].stream, "stdout");
    assert.strictEqual(new TextDecoder().decode(res.chunks[0].data), "Hello, ");
    assert.strictEqual(res.chunks[1].stream, "stderr");
    assert.strictEqual(new TextDecoder().decode(res.chunks[1].data), "ActionDock!");
    assert.strictEqual(res.nextCursor, log.tailCursor);
    assert.strictEqual(res.eof, false);

    // 幂等读取
    const resIdempotent = log.read(startCursor);
    assert.strictEqual(resIdempotent.chunks.length, 2);

    // 从 tailCursor 继续读无新数据
    const resEmpty = log.read(res.nextCursor);
    assert.strictEqual(resEmpty.chunks.length, 0);
    assert.strictEqual(resEmpty.nextCursor, res.nextCursor);
  });

  it("单条大记录按 maxBytes 步进切分与游标推进", () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    const startCursor = log.earliestCursor;

    const fullBuffer = new Uint8Array(100);
    for (let i = 0; i < 100; i++) {
      fullBuffer[i] = i;
    }
    log.append("stdout", fullBuffer);

    // 第一次读取 30 字节
    const read1 = log.read(startCursor, 30);
    assert.strictEqual(read1.chunks.length, 1);
    assert.strictEqual(read1.chunks[0].data.byteLength, 30);
    assert.strictEqual(read1.chunks[0].data[0], 0);
    assert.strictEqual(read1.chunks[0].data[29], 29);
    const pos1 = parseCursor(read1.nextCursor, hostEpoch, processId);
    assert.strictEqual(pos1.sequence, 0);
    assert.strictEqual(pos1.offset, 30);

    // 第二次读取 40 字节
    const read2 = log.read(read1.nextCursor, 40);
    assert.strictEqual(read2.chunks.length, 1);
    assert.strictEqual(read2.chunks[0].data.byteLength, 40);
    assert.strictEqual(read2.chunks[0].data[0], 30);
    assert.strictEqual(read2.chunks[0].data[39], 69);
    const pos2 = parseCursor(read2.nextCursor, hostEpoch, processId);
    assert.strictEqual(pos2.sequence, 0);
    assert.strictEqual(pos2.offset, 70);

    // 第三次读取剩余 30 字节（请求 50 字节上限）
    const read3 = log.read(read2.nextCursor, 50);
    assert.strictEqual(read3.chunks.length, 1);
    assert.strictEqual(read3.chunks[0].data.byteLength, 30);
    assert.strictEqual(read3.chunks[0].data[0], 70);
    assert.strictEqual(read3.chunks[0].data[29], 99);

    // 读取完毕后推进到下一条序号起点，与 tailCursor 对齐
    const pos3 = parseCursor(read3.nextCursor, hostEpoch, processId);
    assert.strictEqual(pos3.sequence, 1);
    assert.strictEqual(pos3.offset, 0);
    assert.strictEqual(read3.nextCursor, log.tailCursor);

    // 拼接验证全部 100 字节完整一致
    const combined = new Uint8Array(100);
    combined.set(read1.chunks[0].data, 0);
    combined.set(read2.chunks[0].data, 30);
    combined.set(read3.chunks[0].data, 70);
    assert.deepStrictEqual(combined, fullBuffer);
  });

  it("多条记录跨记录分页切分读取", () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    const startCursor = log.earliestCursor;

    const chunk1 = new Uint8Array(20).fill(1);
    const chunk2 = new Uint8Array(30).fill(2);
    const chunk3 = new Uint8Array(40).fill(3);

    log.append("stdout", chunk1);
    log.append("stderr", chunk2);
    log.append("pty", chunk3);

    // 一次读取 35 字节：应包含第 1 条完整 20 字节与第 2 条的前 15 字节
    const read1 = log.read(startCursor, 35);
    assert.strictEqual(read1.chunks.length, 2);
    assert.strictEqual(read1.chunks[0].stream, "stdout");
    assert.strictEqual(read1.chunks[0].data.byteLength, 20);
    assert.strictEqual(read1.chunks[1].stream, "stderr");
    assert.strictEqual(read1.chunks[1].data.byteLength, 15);

    const pos1 = parseCursor(read1.nextCursor, hostEpoch, processId);
    assert.strictEqual(pos1.sequence, 1);
    assert.strictEqual(pos1.offset, 15);

    // 第二次读取 30 字节：应包含第 2 条剩余 15 字节与第 3 条的前 15 字节
    const read2 = log.read(read1.nextCursor, 30);
    assert.strictEqual(read2.chunks.length, 2);
    assert.strictEqual(read2.chunks[0].stream, "stderr");
    assert.strictEqual(read2.chunks[0].data.byteLength, 15);
    assert.strictEqual(read2.chunks[1].stream, "pty");
    assert.strictEqual(read2.chunks[1].data.byteLength, 15);

    const pos2 = parseCursor(read2.nextCursor, hostEpoch, processId);
    assert.strictEqual(pos2.sequence, 2);
    assert.strictEqual(pos2.offset, 15);

    // 第三次读取剩余数据
    const read3 = log.read(read2.nextCursor, 100);
    assert.strictEqual(read3.chunks.length, 1);
    assert.strictEqual(read3.chunks[0].stream, "pty");
    assert.strictEqual(read3.chunks[0].data.byteLength, 25);
    assert.strictEqual(read3.nextCursor, log.tailCursor);
  });

  it("缓冲区超额容量淘汰旧记录并更新 earliestCursor", () => {
    // 设置最大容量为 100 字节
    const log = new ProcessOutputLog(hostEpoch, processId, { maxBufferBytes: 100 });
    const cursor0 = log.earliestCursor;

    const data1 = new Uint8Array(60).fill(65);
    log.append("stdout", data1);
    assert.strictEqual(log.currentBytes, 60);
    assert.strictEqual(log.earliestCursor, cursor0);

    const data2 = new Uint8Array(60).fill(66);
    log.append("stderr", data2);
    // 超过 100 字节，data1 记录被淘汰
    assert.strictEqual(log.currentBytes, 60);
    assert.notStrictEqual(log.earliestCursor, cursor0);

    const earliestPos = parseCursor(log.earliestCursor, hostEpoch, processId);
    assert.strictEqual(earliestPos.sequence, 1);
    assert.strictEqual(earliestPos.offset, 0);
  });

  it("落后于淘汰窗口时 onGap=error 抛出 OUTPUT_GAP 并带回 earliestCursor", () => {
    const log = new ProcessOutputLog(hostEpoch, processId, { maxBufferBytes: 80 });
    const oldCursor = log.earliestCursor;

    log.append("stdout", new Uint8Array(50).fill(1));
    log.append("stdout", new Uint8Array(50).fill(2));

    try {
      log.read(oldCursor, 50, "error");
      assert.fail("不应到达此分支");
    } catch (err) {
      assert.strictEqual(err instanceof ProcessError, true);
      const procErr = err as ProcessError;
      assert.strictEqual(procErr.code, OUTPUT_GAP);
      assert.strictEqual(procErr.details?.earliestCursor, log.earliestCursor);
    }
  });

  it("落后于淘汰窗口时 onGap=skip 跳过缺口并标记 truncated 与 gap", () => {
    const log = new ProcessOutputLog(hostEpoch, processId, { maxBufferBytes: 80 });
    const oldCursor = log.earliestCursor;

    log.append("stdout", new Uint8Array(50).fill(1));
    log.append("stderr", new Uint8Array(50).fill(2));

    const res = log.read(oldCursor, 50, "skip");
    assert.strictEqual(res.truncated, true);
    assert.notStrictEqual(res.gap, undefined);
    assert.strictEqual(res.gap?.fromCursor, oldCursor);
    assert.strictEqual(res.gap?.toCursor, log.earliestCursor);
    assert.strictEqual(res.chunks.length, 1);
    assert.strictEqual(res.chunks[0].stream, "stderr");
    assert.strictEqual(res.chunks[0].data.byteLength, 50);
  });

  it("单条大记录超额时切分保留尾部并更新内部游标偏移量", () => {
    const log = new ProcessOutputLog(hostEpoch, processId, { maxBufferBytes: 50 });
    const oldCursor = log.earliestCursor;

    const largeData = new Uint8Array(80);
    for (let i = 0; i < 80; i++) {
      largeData[i] = i;
    }
    log.append("stdout", largeData);

    assert.strictEqual(log.currentBytes, 50);
    const earliestPos = parseCursor(log.earliestCursor, hostEpoch, processId);
    assert.strictEqual(earliestPos.sequence, 0);
    assert.strictEqual(earliestPos.offset, 30);

    // 从被淘汰的前部读取抛出 OUTPUT_GAP
    assert.throws(() => log.read(oldCursor, 50, "error"));

    // 从 earliestCursor 读取能够读出保留的尾部 50 字节
    const read = log.read(log.earliestCursor, 100);
    assert.strictEqual(read.chunks.length, 1);
    assert.strictEqual(read.chunks[0].data.byteLength, 50);
    assert.strictEqual(read.chunks[0].data[0], 30);
    assert.strictEqual(read.chunks[0].data[49], 79);
  });

  it("超出末尾游标或偏移量越界抛出 INVALID_CURSOR", () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    log.append("stdout", new Uint8Array(20));

    // 未来的 sequence
    const futureCursor = encodeCursor(hostEpoch, processId, 999, 0);
    assert.throws(() => log.read(futureCursor));

    // 当前 sequence 但 offset 超过记录长度
    const invalidOffsetCursor = encodeCursor(hostEpoch, processId, 0, 999);
    assert.throws(() => log.read(invalidOffsetCursor));
  });

  it("输出通道关闭与 EOF 正确联动", () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    const startCursor = log.earliestCursor;

    log.append("stdout", new Uint8Array(10));
    assert.strictEqual(log.outputClosed, false);

    // 未关闭时读取到尾部，eof 为 false
    const read1 = log.read(startCursor);
    assert.strictEqual(read1.eof, false);

    // 关闭输出
    log.closeOutput("drain-timeout");
    assert.strictEqual(log.outputClosed, true);
    assert.strictEqual(log.outputEndReason, "drain-timeout");

    // 读到末尾且 outputClosed 时，eof 为 true
    const read2 = log.read(read1.nextCursor);
    assert.strictEqual(read2.chunks.length, 0);
    assert.strictEqual(read2.eof, true);
  });
});

describe("长轮询等待机制 (waitForData)", () => {
  const hostEpoch = "epoch-test-3";
  const processId = "proc-test-300";

  it("已有未读数据时立即返回不挂起", async () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    const startCursor = log.earliestCursor;
    log.append("stdout", new TextEncoder().encode("Instant data"));

    const result = await log.waitForData(startCursor, 5000);
    assert.strictEqual(result.chunks.length, 1);
    assert.strictEqual(new TextDecoder().decode(result.chunks[0].data), "Instant data");
    assert.strictEqual(log.waiterCount, 0);
  });

  it("输出通道已关闭时立即返回不挂起", async () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    log.closeOutput("natural");

    const result = await log.waitForData(log.tailCursor, 5000);
    assert.strictEqual(result.chunks.length, 0);
    assert.strictEqual(result.eof, true);
    assert.strictEqual(log.waiterCount, 0);
  });

  it("waitMs 小于等于 0 时立即返回不挂起", async () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    const result = await log.waitForData(log.tailCursor, 0);
    assert.strictEqual(result.chunks.length, 0);
    assert.strictEqual(result.eof, false);
    assert.strictEqual(log.waiterCount, 0);
  });

  it("无数据时挂起等待并在数据到达时立即唤醒", async () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    const startCursor = log.earliestCursor;

    const waitPromise = log.waitForData(startCursor, 5000);
    assert.strictEqual(log.waiterCount, 1);

    // 稍后追加数据
    setTimeout(() => {
      log.append("pty", new TextEncoder().encode("Terminal response"));
    }, 20);

    const result = await waitPromise;
    assert.strictEqual(result.chunks.length, 1);
    assert.strictEqual(result.chunks[0].stream, "pty");
    assert.strictEqual(new TextDecoder().decode(result.chunks[0].data), "Terminal response");
    assert.strictEqual(log.waiterCount, 0);
  });

  it("无数据时挂起等待并在输出关闭时立即唤醒", async () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    const startCursor = log.earliestCursor;

    const waitPromise = log.waitForData(startCursor, 5000);
    assert.strictEqual(log.waiterCount, 1);

    setTimeout(() => {
      log.closeOutput("natural");
    }, 20);

    const result = await waitPromise;
    assert.strictEqual(result.chunks.length, 0);
    assert.strictEqual(result.eof, true);
    assert.strictEqual(log.waiterCount, 0);
  });

  it("等待超时自动唤醒并返回空结果", async () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    const startCursor = log.earliestCursor;

    const startTime = Date.now();
    const result = await log.waitForData(startCursor, 30);
    const elapsed = Date.now() - startTime;

    assert.ok((elapsed) >= 25);
    assert.strictEqual(result.chunks.length, 0);
    assert.strictEqual(result.eof, false);
    assert.strictEqual(log.waiterCount, 0);
  });

  it("支持 AbortSignal 取消等待且不破坏游标状态", async () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    const startCursor = log.earliestCursor;
    const controller = new AbortController();

    const waitPromise = log.waitForData(startCursor, 5000, controller.signal);
    assert.strictEqual(log.waiterCount, 1);

    setTimeout(() => {
      controller.abort("User cancelled read");
    }, 20);

    try {
      await waitPromise;
      assert.fail("不应到达此分支");
    } catch (err) {
      assert.strictEqual(err instanceof ProcessError, true);
      const procErr = err as ProcessError;
      assert.strictEqual(procErr.code, PROCESS_CANCELLED);
    }

    assert.strictEqual(log.waiterCount, 0);
    assert.strictEqual(log.earliestCursor, startCursor);
  });

  it("严格控制等待者配额，超额抛出 QUOTA_EXCEEDED", async () => {
    const maxWaiters = 3;
    const log = new ProcessOutputLog(hostEpoch, processId, { maxWaiters });
    const cursor = log.tailCursor;

    const p1 = log.waitForData(cursor, 1000);
    const p2 = log.waitForData(cursor, 1000);
    const p3 = log.waitForData(cursor, 1000);
    assert.strictEqual(log.waiterCount, 3);

    // 第 4 个超额拒绝
    try {
      await log.waitForData(cursor, 1000);
      assert.fail("不应到达此分支");
    } catch (err) {
      assert.strictEqual(err instanceof ProcessError, true);
      const procErr = err as ProcessError;
      assert.strictEqual(procErr.code, QUOTA_EXCEEDED);
    }

    // 唤醒前面 3 个
    log.closeOutput();
    await Promise.all([p1, p2, p3]);
    assert.strictEqual(log.waiterCount, 0);
  });
});
