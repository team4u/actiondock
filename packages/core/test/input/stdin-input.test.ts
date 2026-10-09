import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readStdinBounded } from "../../src/input/stdin-input";
import {
  InputError,
  INPUT_FILE_READ_FAILED,
  INPUT_LIMIT_EXCEEDED,
  INVALID_JSON,
} from "../../src/input/flat-errors";

describe("标准输入有界读取 readStdinBounded", () => {
  it("正常流式读取完整 Buffer 数据", async () => {
    const stream = Readable.from([
      Buffer.from('{"name":'),
      Buffer.from('"alice"}'),
    ]);
    const text = await readStdinBounded(stream);
    assert.strictEqual(text, '{"name":"alice"}');
  });

  it("当输入数据超过 maxInputBytes 时抛出 INPUT_LIMIT_EXCEEDED", async () => {
    const stream = Readable.from([
      Buffer.from("12345"),
      Buffer.from("67890"),
    ]);

    try {
      await readStdinBounded(stream, { maxInputBytes: 8 });
      assert.fail("不应到达此分支");
    } catch (err: any) {
      assert.ok(err instanceof InputError);
      assert.strictEqual(err.code, INPUT_LIMIT_EXCEEDED);
      assert.strictEqual((err.details as Record<string, unknown>)?.reason, "MAX_INPUT_BYTES");
    }
  });

  it("在 byteStreamOnly: true 下拦截字符串 chunk 并抛出 INVALID_STREAM_CHUNK_TYPE", async () => {
    const stream = Readable.from(["string-chunk-not-buffer"]);

    try {
      await readStdinBounded(stream, { byteStreamOnly: true });
      assert.fail("不应到达此分支");
    } catch (err: any) {
      assert.ok(err instanceof InputError);
      assert.strictEqual(err.code, INPUT_FILE_READ_FAILED);
      assert.strictEqual((err.details as Record<string, unknown>)?.reason, "INVALID_STREAM_CHUNK_TYPE");
    }
  });

  it("在 byteStreamOnly: false 下自动将字符串 chunk 转换为 Buffer", async () => {
    const stream = Readable.from(["hello ", "world"]);
    const text = await readStdinBounded(stream, { byteStreamOnly: false });
    assert.strictEqual(text, "hello world");
  });

  it("首个观测终态事件获胜（First Observed Terminal Event Wins）：限额超限后迟到的 abort 不篡改结果", async () => {
    const controller = new AbortController();
    const stream = Readable.from([Buffer.from("very-large-content-exceeding-limit")]);

    try {
      await readStdinBounded(stream, {
        maxInputBytes: 5,
        signal: controller.signal,
      });
      assert.fail("不应到达此分支");
    } catch (err: any) {
      // 随后触发 abort
      controller.abort(new Error("late-abort"));
      // 必须是超限错误，而不是 abort 错误
      assert.ok(err instanceof InputError);
      assert.strictEqual(err.code, INPUT_LIMIT_EXCEEDED);
      assert.strictEqual((err.details as Record<string, unknown>)?.reason, "MAX_INPUT_BYTES");
    }
  });

  it("首个观测终态事件获胜：EOF 完成后迟到的 abort 不篡改结果", async () => {
    const controller = new AbortController();
    const stream = Readable.from([Buffer.from("quick-done")]);

    const result = await readStdinBounded(stream, {
      signal: controller.signal,
    });
    assert.strictEqual(result, "quick-done");

    // 随后 abort
    controller.abort(new Error("late-abort"));
    // 已经 resolve，结果不受影响
  });

  it("先观测到 AbortSignal 则中止读取", async () => {
    const controller = new AbortController();
    controller.abort(new Error("manual-abort"));

    const stream = Readable.from([Buffer.from("some-data")]);
    await assert.rejects(
      readStdinBounded(stream, { signal: controller.signal })
    , /manual\-abort/);
  });

  it("rawText 模式保留开头 BOM 且编码失败报 INPUT_FILE_READ_FAILED / INVALID_UTF8", async () => {
    // BOM 保留
    const bomStream = Readable.from([Buffer.from([0xef, 0xbb, 0xbf, 0x61])]);
    const bomText = await readStdinBounded(bomStream, { rawText: true });
    assert.strictEqual(bomText, "\uFEFFa");

    // 非法 UTF-8 字节：读取失败而非 JSON 解析失败
    try {
      await readStdinBounded(Readable.from([Buffer.from([0xff, 0xfe, 0x28])]), {
        rawText: true,
      });
      assert.fail("不应到达此分支");
    } catch (err: any) {
      assert.ok(err instanceof InputError);
      assert.strictEqual(err.code, INPUT_FILE_READ_FAILED);
      assert.strictEqual((err.details as Record<string, unknown>)?.reason, "INVALID_UTF8");
    }
  });

  it("非 rawText 模式维持既有行为：BOM 由后续 JSON 解析剥离，编码失败报 INVALID_JSON", async () => {
    try {
      await readStdinBounded(Readable.from([Buffer.from([0xff])]), {
        strictUtf8: true,
      });
      assert.fail("不应到达此分支");
    } catch (err: any) {
      assert.ok(err instanceof InputError);
      assert.strictEqual(err.code, "INVALID_JSON");
      assert.strictEqual((err.details as Record<string, unknown>)?.reason, "INVALID_UTF8");
    }
  });
});
