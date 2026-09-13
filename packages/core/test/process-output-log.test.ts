import { describe, expect, it } from "bun:test";
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
    expect(typeof cursorStr).toBe("string");
    expect(cursorStr.startsWith("cur_")).toBe(true);

    const parsed = parseCursor(cursorStr, hostEpoch, processId);
    expect(parsed.sequence).toBe(42);
    expect(parsed.offset).toBe(128);

    const decoded = decodeCursor(cursorStr);
    expect(decoded.hostEpoch).toBe(hostEpoch);
    expect(decoded.processId).toBe(processId);
    expect(decoded.sequence).toBe(42);
    expect(decoded.offset).toBe(128);
  });

  it("游标坐标比较函数正确判定先后顺序", () => {
    expect(compareCursorPos({ sequence: 1, offset: 0 }, { sequence: 2, offset: 0 })).toBeLessThan(0);
    expect(compareCursorPos({ sequence: 2, offset: 0 }, { sequence: 1, offset: 0 })).toBeGreaterThan(0);
    expect(compareCursorPos({ sequence: 1, offset: 10 }, { sequence: 1, offset: 20 })).toBeLessThan(0);
    expect(compareCursorPos({ sequence: 1, offset: 20 }, { sequence: 1, offset: 10 })).toBeGreaterThan(0);
    expect(compareCursorPos({ sequence: 1, offset: 10 }, { sequence: 1, offset: 10 })).toBe(0);
  });

  it("遇到格式错误与损坏游标抛出 INVALID_CURSOR", () => {
    expect(() => parseCursor("", hostEpoch, processId)).toThrow();
    expect(() => parseCursor("cur_invalid_base64!!!", hostEpoch, processId)).toThrow();

    try {
      parseCursor("cur_not_json", hostEpoch, processId);
      expect(true).toBe(false);
    } catch (err) {
      expect(err instanceof ProcessError).toBe(true);
      expect((err as ProcessError).code).toBe(INVALID_CURSOR);
    }
  });

  it("跨宿主纪元访问抛出 INVALID_CURSOR 并附带对比详情", () => {
    const cursorStr = encodeCursor("other-epoch", processId, 1, 0);
    try {
      parseCursor(cursorStr, hostEpoch, processId);
      expect(true).toBe(false);
    } catch (err) {
      expect(err instanceof ProcessError).toBe(true);
      const procErr = err as ProcessError;
      expect(procErr.code).toBe(INVALID_CURSOR);
      expect(procErr.details?.expectedHostEpoch).toBe(hostEpoch);
      expect(procErr.details?.actualHostEpoch).toBe("other-epoch");
    }
  });

  it("跨受管进程访问抛出 INVALID_CURSOR 并附带对比详情", () => {
    const cursorStr = encodeCursor(hostEpoch, "other-proc", 1, 0);
    try {
      parseCursor(cursorStr, hostEpoch, processId);
      expect(true).toBe(false);
    } catch (err) {
      expect(err instanceof ProcessError).toBe(true);
      const procErr = err as ProcessError;
      expect(procErr.code).toBe(INVALID_CURSOR);
      expect(procErr.details?.expectedProcessId).toBe(processId);
      expect(procErr.details?.actualProcessId).toBe("other-proc");
    }
  });

  it("编码时非法序号或偏移量抛出 INVALID_CURSOR", () => {
    expect(() => encodeCursor(hostEpoch, processId, -1, 0)).toThrow();
    expect(() => encodeCursor(hostEpoch, processId, 0, -5)).toThrow();
    expect(() => encodeCursor(hostEpoch, processId, 1.5, 0)).toThrow();
  });
});

describe("ProcessOutputLog 原始字节输出日志", () => {
  const hostEpoch = "epoch-test-2";
  const processId = "proc-test-200";

  it("初始化状态与空日志读取", () => {
    const log = new ProcessOutputLog(hostEpoch, processId);

    expect(log.earliestCursor).toBe(log.tailCursor);
    expect(log.currentBytes).toBe(0);
    expect(log.outputClosed).toBe(false);

    const res = log.read(log.earliestCursor);
    expect(res.chunks.length).toBe(0);
    expect(res.nextCursor).toBe(log.earliestCursor);
    expect(res.truncated).toBe(false);
    expect(res.eof).toBe(false);
  });

  it("支持追加原始字节并按游标顺序读取", () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    const startCursor = log.earliestCursor;

    const data1 = new TextEncoder().encode("Hello, ");
    const data2 = new TextEncoder().encode("ActionDock!");
    log.append("stdout", data1);
    log.append("stderr", data2);

    expect(log.currentBytes).toBe(data1.byteLength + data2.byteLength);

    const res = log.read(startCursor);
    expect(res.chunks.length).toBe(2);
    expect(res.chunks[0].stream).toBe("stdout");
    expect(new TextDecoder().decode(res.chunks[0].data)).toBe("Hello, ");
    expect(res.chunks[1].stream).toBe("stderr");
    expect(new TextDecoder().decode(res.chunks[1].data)).toBe("ActionDock!");
    expect(res.nextCursor).toBe(log.tailCursor);
    expect(res.eof).toBe(false);

    // 幂等读取
    const resIdempotent = log.read(startCursor);
    expect(resIdempotent.chunks.length).toBe(2);

    // 从 tailCursor 继续读无新数据
    const resEmpty = log.read(res.nextCursor);
    expect(resEmpty.chunks.length).toBe(0);
    expect(resEmpty.nextCursor).toBe(res.nextCursor);
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
    expect(read1.chunks.length).toBe(1);
    expect(read1.chunks[0].data.byteLength).toBe(30);
    expect(read1.chunks[0].data[0]).toBe(0);
    expect(read1.chunks[0].data[29]).toBe(29);
    const pos1 = parseCursor(read1.nextCursor, hostEpoch, processId);
    expect(pos1.sequence).toBe(0);
    expect(pos1.offset).toBe(30);

    // 第二次读取 40 字节
    const read2 = log.read(read1.nextCursor, 40);
    expect(read2.chunks.length).toBe(1);
    expect(read2.chunks[0].data.byteLength).toBe(40);
    expect(read2.chunks[0].data[0]).toBe(30);
    expect(read2.chunks[0].data[39]).toBe(69);
    const pos2 = parseCursor(read2.nextCursor, hostEpoch, processId);
    expect(pos2.sequence).toBe(0);
    expect(pos2.offset).toBe(70);

    // 第三次读取剩余 30 字节（请求 50 字节上限）
    const read3 = log.read(read2.nextCursor, 50);
    expect(read3.chunks.length).toBe(1);
    expect(read3.chunks[0].data.byteLength).toBe(30);
    expect(read3.chunks[0].data[0]).toBe(70);
    expect(read3.chunks[0].data[29]).toBe(99);

    // 读取完毕后推进到下一条序号起点，与 tailCursor 对齐
    const pos3 = parseCursor(read3.nextCursor, hostEpoch, processId);
    expect(pos3.sequence).toBe(1);
    expect(pos3.offset).toBe(0);
    expect(read3.nextCursor).toBe(log.tailCursor);

    // 拼接验证全部 100 字节完整一致
    const combined = new Uint8Array(100);
    combined.set(read1.chunks[0].data, 0);
    combined.set(read2.chunks[0].data, 30);
    combined.set(read3.chunks[0].data, 70);
    expect(combined).toEqual(fullBuffer);
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
    expect(read1.chunks.length).toBe(2);
    expect(read1.chunks[0].stream).toBe("stdout");
    expect(read1.chunks[0].data.byteLength).toBe(20);
    expect(read1.chunks[1].stream).toBe("stderr");
    expect(read1.chunks[1].data.byteLength).toBe(15);

    const pos1 = parseCursor(read1.nextCursor, hostEpoch, processId);
    expect(pos1.sequence).toBe(1);
    expect(pos1.offset).toBe(15);

    // 第二次读取 30 字节：应包含第 2 条剩余 15 字节与第 3 条的前 15 字节
    const read2 = log.read(read1.nextCursor, 30);
    expect(read2.chunks.length).toBe(2);
    expect(read2.chunks[0].stream).toBe("stderr");
    expect(read2.chunks[0].data.byteLength).toBe(15);
    expect(read2.chunks[1].stream).toBe("pty");
    expect(read2.chunks[1].data.byteLength).toBe(15);

    const pos2 = parseCursor(read2.nextCursor, hostEpoch, processId);
    expect(pos2.sequence).toBe(2);
    expect(pos2.offset).toBe(15);

    // 第三次读取剩余数据
    const read3 = log.read(read2.nextCursor, 100);
    expect(read3.chunks.length).toBe(1);
    expect(read3.chunks[0].stream).toBe("pty");
    expect(read3.chunks[0].data.byteLength).toBe(25);
    expect(read3.nextCursor).toBe(log.tailCursor);
  });

  it("缓冲区超额容量淘汰旧记录并更新 earliestCursor", () => {
    // 设置最大容量为 100 字节
    const log = new ProcessOutputLog(hostEpoch, processId, { maxBufferBytes: 100 });
    const cursor0 = log.earliestCursor;

    const data1 = new Uint8Array(60).fill(65);
    log.append("stdout", data1);
    expect(log.currentBytes).toBe(60);
    expect(log.earliestCursor).toBe(cursor0);

    const data2 = new Uint8Array(60).fill(66);
    log.append("stderr", data2);
    // 超过 100 字节，data1 记录被淘汰
    expect(log.currentBytes).toBe(60);
    expect(log.earliestCursor).not.toBe(cursor0);

    const earliestPos = parseCursor(log.earliestCursor, hostEpoch, processId);
    expect(earliestPos.sequence).toBe(1);
    expect(earliestPos.offset).toBe(0);
  });

  it("落后于淘汰窗口时 onGap=error 抛出 OUTPUT_GAP 并带回 earliestCursor", () => {
    const log = new ProcessOutputLog(hostEpoch, processId, { maxBufferBytes: 80 });
    const oldCursor = log.earliestCursor;

    log.append("stdout", new Uint8Array(50).fill(1));
    log.append("stdout", new Uint8Array(50).fill(2));

    try {
      log.read(oldCursor, 50, "error");
      expect(true).toBe(false);
    } catch (err) {
      expect(err instanceof ProcessError).toBe(true);
      const procErr = err as ProcessError;
      expect(procErr.code).toBe(OUTPUT_GAP);
      expect(procErr.details?.earliestCursor).toBe(log.earliestCursor);
    }
  });

  it("落后于淘汰窗口时 onGap=skip 跳过缺口并标记 truncated 与 gap", () => {
    const log = new ProcessOutputLog(hostEpoch, processId, { maxBufferBytes: 80 });
    const oldCursor = log.earliestCursor;

    log.append("stdout", new Uint8Array(50).fill(1));
    log.append("stderr", new Uint8Array(50).fill(2));

    const res = log.read(oldCursor, 50, "skip");
    expect(res.truncated).toBe(true);
    expect(res.gap).toBeDefined();
    expect(res.gap?.fromCursor).toBe(oldCursor);
    expect(res.gap?.toCursor).toBe(log.earliestCursor);
    expect(res.chunks.length).toBe(1);
    expect(res.chunks[0].stream).toBe("stderr");
    expect(res.chunks[0].data.byteLength).toBe(50);
  });

  it("单条大记录超额时切分保留尾部并更新内部游标偏移量", () => {
    const log = new ProcessOutputLog(hostEpoch, processId, { maxBufferBytes: 50 });
    const oldCursor = log.earliestCursor;

    const largeData = new Uint8Array(80);
    for (let i = 0; i < 80; i++) {
      largeData[i] = i;
    }
    log.append("stdout", largeData);

    expect(log.currentBytes).toBe(50);
    const earliestPos = parseCursor(log.earliestCursor, hostEpoch, processId);
    expect(earliestPos.sequence).toBe(0);
    expect(earliestPos.offset).toBe(30);

    // 从被淘汰的前部读取抛出 OUTPUT_GAP
    expect(() => log.read(oldCursor, 50, "error")).toThrow();

    // 从 earliestCursor 读取能够读出保留的尾部 50 字节
    const read = log.read(log.earliestCursor, 100);
    expect(read.chunks.length).toBe(1);
    expect(read.chunks[0].data.byteLength).toBe(50);
    expect(read.chunks[0].data[0]).toBe(30);
    expect(read.chunks[0].data[49]).toBe(79);
  });

  it("超出末尾游标或偏移量越界抛出 INVALID_CURSOR", () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    log.append("stdout", new Uint8Array(20));

    // 未来的 sequence
    const futureCursor = encodeCursor(hostEpoch, processId, 999, 0);
    expect(() => log.read(futureCursor)).toThrow();

    // 当前 sequence 但 offset 超过记录长度
    const invalidOffsetCursor = encodeCursor(hostEpoch, processId, 0, 999);
    expect(() => log.read(invalidOffsetCursor)).toThrow();
  });

  it("输出通道关闭与 EOF 正确联动", () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    const startCursor = log.earliestCursor;

    log.append("stdout", new Uint8Array(10));
    expect(log.outputClosed).toBe(false);

    // 未关闭时读取到尾部，eof 为 false
    const read1 = log.read(startCursor);
    expect(read1.eof).toBe(false);

    // 关闭输出
    log.closeOutput("drain-timeout");
    expect(log.outputClosed).toBe(true);
    expect(log.outputEndReason).toBe("drain-timeout");

    // 读到末尾且 outputClosed 时，eof 为 true
    const read2 = log.read(read1.nextCursor);
    expect(read2.chunks.length).toBe(0);
    expect(read2.eof).toBe(true);
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
    expect(result.chunks.length).toBe(1);
    expect(new TextDecoder().decode(result.chunks[0].data)).toBe("Instant data");
    expect(log.waiterCount).toBe(0);
  });

  it("输出通道已关闭时立即返回不挂起", async () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    log.closeOutput("natural");

    const result = await log.waitForData(log.tailCursor, 5000);
    expect(result.chunks.length).toBe(0);
    expect(result.eof).toBe(true);
    expect(log.waiterCount).toBe(0);
  });

  it("waitMs 小于等于 0 时立即返回不挂起", async () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    const result = await log.waitForData(log.tailCursor, 0);
    expect(result.chunks.length).toBe(0);
    expect(result.eof).toBe(false);
    expect(log.waiterCount).toBe(0);
  });

  it("无数据时挂起等待并在数据到达时立即唤醒", async () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    const startCursor = log.earliestCursor;

    const waitPromise = log.waitForData(startCursor, 5000);
    expect(log.waiterCount).toBe(1);

    // 稍后追加数据
    setTimeout(() => {
      log.append("pty", new TextEncoder().encode("Terminal response"));
    }, 20);

    const result = await waitPromise;
    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0].stream).toBe("pty");
    expect(new TextDecoder().decode(result.chunks[0].data)).toBe("Terminal response");
    expect(log.waiterCount).toBe(0);
  });

  it("无数据时挂起等待并在输出关闭时立即唤醒", async () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    const startCursor = log.earliestCursor;

    const waitPromise = log.waitForData(startCursor, 5000);
    expect(log.waiterCount).toBe(1);

    setTimeout(() => {
      log.closeOutput("natural");
    }, 20);

    const result = await waitPromise;
    expect(result.chunks.length).toBe(0);
    expect(result.eof).toBe(true);
    expect(log.waiterCount).toBe(0);
  });

  it("等待超时自动唤醒并返回空结果", async () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    const startCursor = log.earliestCursor;

    const startTime = Date.now();
    const result = await log.waitForData(startCursor, 30);
    const elapsed = Date.now() - startTime;

    expect(elapsed).toBeGreaterThanOrEqual(25);
    expect(result.chunks.length).toBe(0);
    expect(result.eof).toBe(false);
    expect(log.waiterCount).toBe(0);
  });

  it("支持 AbortSignal 取消等待且不破坏游标状态", async () => {
    const log = new ProcessOutputLog(hostEpoch, processId);
    const startCursor = log.earliestCursor;
    const controller = new AbortController();

    const waitPromise = log.waitForData(startCursor, 5000, controller.signal);
    expect(log.waiterCount).toBe(1);

    setTimeout(() => {
      controller.abort("User cancelled read");
    }, 20);

    try {
      await waitPromise;
      expect(true).toBe(false);
    } catch (err) {
      expect(err instanceof ProcessError).toBe(true);
      const procErr = err as ProcessError;
      expect(procErr.code).toBe(PROCESS_CANCELLED);
    }

    expect(log.waiterCount).toBe(0);
    expect(log.earliestCursor).toBe(startCursor);
  });

  it("严格控制等待者配额，超额抛出 QUOTA_EXCEEDED", async () => {
    const maxWaiters = 3;
    const log = new ProcessOutputLog(hostEpoch, processId, { maxWaiters });
    const cursor = log.tailCursor;

    const p1 = log.waitForData(cursor, 1000);
    const p2 = log.waitForData(cursor, 1000);
    const p3 = log.waitForData(cursor, 1000);
    expect(log.waiterCount).toBe(3);

    // 第 4 个超额拒绝
    try {
      await log.waitForData(cursor, 1000);
      expect(true).toBe(false);
    } catch (err) {
      expect(err instanceof ProcessError).toBe(true);
      const procErr = err as ProcessError;
      expect(procErr.code).toBe(QUOTA_EXCEEDED);
    }

    // 唤醒前面 3 个
    log.closeOutput();
    await Promise.all([p1, p2, p3]);
    expect(log.waiterCount).toBe(0);
  });
});
