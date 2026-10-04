import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { initProject } from "@actiondock/core";
import { readEntireStdin } from "../src/prompt";
import { runCliAsync } from "./helpers/run-cli";

/** 构造多块可读流，验证分片收集语义。 */
function chunkedStream(chunks: (string | Buffer)[]): Readable {
  return new Readable({
    highWaterMark: 1,
    read() {
      for (const chunk of chunks) {
        this.push(chunk);
      }
      this.push(null);
    },
  });
}

describe("标准输入完整读取回归（有界复用）", () => {
  it("多块输入合并为完整字符串，分片边界不丢字节", async () => {
    const result = await readEntireStdin(chunkedStream(["hello ", "wor", "ld"]));
    assert.strictEqual(result, "hello world");
  });

  it("多字节 UTF-8 字符跨块切分时仍完整解码", async () => {
    const raw = Buffer.from("你好世界", "utf-8");
    const chunks: Buffer[] = [];
    for (let i = 0; i < raw.length; i += 4) {
      chunks.push(raw.subarray(i, i + 4));
    }
    assert.ok(chunks.length > 1);
    const result = await readEntireStdin(chunkedStream(chunks));
    assert.strictEqual(result, "你好世界");
  });

  it("末尾 CR/LF/CRLF 统一裁剪，中间换行保留", async () => {
    assert.strictEqual(await readEntireStdin(chunkedStream(["line1\n"])), "line1");
    assert.strictEqual(await readEntireStdin(chunkedStream(["line1\r\n"])), "line1");
    assert.strictEqual(await readEntireStdin(chunkedStream(["line1", "\n"])), "line1");
    assert.strictEqual(await readEntireStdin(chunkedStream(["a\nb\n"])), "a\nb");
    assert.strictEqual(await readEntireStdin(chunkedStream(["无换行"])), "无换行");
  });

  it("空输入解析为空字符串", async () => {
    assert.strictEqual(await readEntireStdin(chunkedStream([])), "");
    assert.strictEqual(await readEntireStdin(chunkedStream(["\n"])), "");
  });

  it("不剥离 BOM：带 BOM 输入保留原始字符特征", async () => {
    const result = await readEntireStdin(chunkedStream([Buffer.from("\uFEFFvalue", "utf-8")]));
    assert.strictEqual(result, "\uFEFFvalue");
    assert.strictEqual(result.charCodeAt(0), 0xfeff);
  });

  it("宽松解码：非法 UTF-8 字节序列不抛错", async () => {
    const result = await readEntireStdin(chunkedStream([Buffer.from([0xff, 0xfe, 0x00, 0x41])]));
    assert.ok(result.includes("A"));
  });

  it("流错误透传为包含原始原因的异常", async () => {
    const failing = new Readable({
      read() {
        this.destroy(new Error("boom"));
      },
    });
    await assert.rejects(
      () => readEntireStdin(failing),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("boom"));
        return true;
      }
    );
  });

  it("读取完成后监听器已清理且流被销毁", async () => {
    const stream = chunkedStream(["abc"]);
    await readEntireStdin(stream);
    assert.strictEqual(stream.listenerCount("data"), 0);
    assert.strictEqual(stream.listenerCount("end"), 0);
    assert.strictEqual(stream.listenerCount("error"), 0);
    assert.ok(stream.destroyed);
  });

  it("超过默认 10MB 上限的输入被拒绝并携带结构化错误码", async () => {
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0x61);
    await assert.rejects(
      () => readEntireStdin(chunkedStream([oversized])),
      (err: unknown) => {
        assert.strictEqual((err as { code?: string }).code, "INPUT_LIMIT_EXCEEDED");
        return true;
      }
    );
  });
});

describe("配置写入标准输入端到端回归", () => {
  let tempDir: string;
  let tempHome: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-cli-stdin-"));
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-cli-stdin-home-"));
    initProject(tempDir, { id: "stdin.regression", name: "标准输入回归" });
  });

  afterEach(() => {
    for (const dir of [tempDir, tempHome]) {
      if (dir) {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  });

  it("--stdin 读取管道值写入配置，末尾换行被裁剪", async () => {
    const setProc = await runCliAsync(
      ["config", "set", "STDIN_VALUE", "--stdin"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome },
      "piped-value\n"
    );
    assert.strictEqual(setProc.exitCode, 0);

    const getProc = await runCliAsync(["config", "get", "STDIN_VALUE", "--json"], tempDir, { ACTIONDOCK_HOME: tempHome });
    assert.strictEqual(getProc.exitCode, 0);
    assert.strictEqual(JSON.parse(getProc.stdout.toString()).value, "piped-value");
  });

  it("--stdin 空输入以参数错误退出", async () => {
    const proc = await runCliAsync(
      ["config", "set", "STDIN_EMPTY", "--stdin"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome },
      ""
    );
    assert.notStrictEqual(proc.exitCode, 0);
    assert.ok(proc.stderr.toString().includes("No data received from standard input"));
  });
});
