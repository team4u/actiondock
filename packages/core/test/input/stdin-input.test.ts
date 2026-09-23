import { describe, expect, it } from "bun:test";
import { Readable } from "node:stream";
import { readStdinBounded } from "../../src/input/stdin-input";
import {
  InputError,
  INPUT_FILE_READ_FAILED,
  INPUT_LIMIT_EXCEEDED,
} from "../../src/input/flat-errors";

describe("标准输入有界读取 readStdinBounded", () => {
  it("正常流式读取完整 Buffer 数据", async () => {
    const stream = Readable.from([
      Buffer.from('{"name":'),
      Buffer.from('"alice"}'),
    ]);
    const text = await readStdinBounded(stream);
    expect(text).toBe('{"name":"alice"}');
  });

  it("当输入数据超过 maxInputBytes 时抛出 INPUT_LIMIT_EXCEEDED", async () => {
    const stream = Readable.from([
      Buffer.from("12345"),
      Buffer.from("67890"),
    ]);

    try {
      await readStdinBounded(stream, { maxInputBytes: 8 });
      expect.unreachable();
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err.code).toBe(INPUT_LIMIT_EXCEEDED);
      expect(err.details?.reason).toBe("MAX_INPUT_BYTES");
    }
  });

  it("在 byteStreamOnly: true 下拦截字符串 chunk 并抛出 INVALID_STREAM_CHUNK_TYPE", async () => {
    const stream = Readable.from(["string-chunk-not-buffer"]);

    try {
      await readStdinBounded(stream, { byteStreamOnly: true });
      expect.unreachable();
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err.code).toBe(INPUT_FILE_READ_FAILED);
      expect(err.details?.reason).toBe("INVALID_STREAM_CHUNK_TYPE");
    }
  });

  it("在 byteStreamOnly: false 下自动将字符串 chunk 转换为 Buffer", async () => {
    const stream = Readable.from(["hello ", "world"]);
    const text = await readStdinBounded(stream, { byteStreamOnly: false });
    expect(text).toBe("hello world");
  });

  it("首个观测终态事件获胜（First Observed Terminal Event Wins）：限额超限后迟到的 abort 不篡改结果", async () => {
    const controller = new AbortController();
    const stream = Readable.from([Buffer.from("very-large-content-exceeding-limit")]);

    try {
      await readStdinBounded(stream, {
        maxInputBytes: 5,
        signal: controller.signal,
      });
      expect.unreachable();
    } catch (err: any) {
      // 随后触发 abort
      controller.abort(new Error("late-abort"));
      // 必须是超限错误，而不是 abort 错误
      expect(err).toBeInstanceOf(InputError);
      expect(err.code).toBe(INPUT_LIMIT_EXCEEDED);
      expect(err.details?.reason).toBe("MAX_INPUT_BYTES");
    }
  });

  it("首个观测终态事件获胜：EOF 完成后迟到的 abort 不篡改结果", async () => {
    const controller = new AbortController();
    const stream = Readable.from([Buffer.from("quick-done")]);

    const result = await readStdinBounded(stream, {
      signal: controller.signal,
    });
    expect(result).toBe("quick-done");

    // 随后 abort
    controller.abort(new Error("late-abort"));
    // 已经 resolve，结果不受影响
  });

  it("先观测到 AbortSignal 则中止读取", async () => {
    const controller = new AbortController();
    controller.abort(new Error("manual-abort"));

    const stream = Readable.from([Buffer.from("some-data")]);
    await expect(
      readStdinBounded(stream, { signal: controller.signal })
    ).rejects.toThrow("manual-abort");
  });
});
