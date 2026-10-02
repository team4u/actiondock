import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runCliAsync } from "./helpers/run-cli";

let tempHome: string | undefined;

async function runCli(
  args: string[],
  cwd?: string,
  stdinInput?: string | Buffer,
  env?: Record<string, string>
) {
  return await runCliAsync(
    args,
    cwd,
    {
      ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}),
      ...env,
    },
    stdinInput
  );
}

describe("CLI Action Input Resolution - JSON and File Inputs", () => {
  let tempDir: string;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-cli-input-json-test-"));
    tempHome = mkdtempSync(join(tmpdir(), "ad-cli-input-json-home-"));

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
      } catch {}
    }

    // Initialize project
    const initProc = await runCli(["init", "--id", "test.input-pkg", "--name", "Input Pkg", "."], tempDir);
    assert.strictEqual(initProc.exitCode, 0);

    // Create an echo action that returns the exact received input
    const echoActionSource = `import { defineAction } from "@actiondock/sdk";
export default defineAction(async (input: any) => {
  return { received: input };
});
`;
    writeFileSync(join(tempDir, "actions", "echo.ts"), echoActionSource, "utf-8");

    // Register echo action in actiondock.json
    const configPath = join(tempDir, "actiondock.json");
    const existingConfig = JSON.parse(
      existsSync(configPath) ? readFileSync(configPath, "utf-8") : "{}"
    );
    existingConfig.actions = existingConfig.actions || {};
    existingConfig.actions["test.echo"] = {
      entry: "actions/echo.ts",
      description: "Echo input payload",
    };
    writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), "utf-8");
  });

  after(async () => {
    if (tempHome && existsSync(tempHome)) {
      try {
        rmSync(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {}
      tempHome = undefined;
    }
    if (tempDir && existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {
        await new Promise((r) => setTimeout(r, 200));
        try {
          rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        } catch {}
      }
    }
  });

  // 1. --input 正常 JSON
  it("executes action with valid inline JSON via --input", async () => {
    const proc = await runCli(["run", "test.echo", "--input", "{\"name\":\"Alice\",\"age\":30}", "--json"], tempDir);
    assert.strictEqual(proc.exitCode, 0);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.data.received, { name: "Alice", age: 30 });
  });

  // 2. --input-file 正常文件
  it("executes action with valid file JSON via --input-file", async () => {
    const filePath = join(tempDir, "valid-input.json");
    writeFileSync(filePath, JSON.stringify({ project: "ActionDock", stars: 100 }), "utf-8");

    const proc = await runCli(["run", "test.echo", "--input-file", filePath, "--json"], tempDir);
    assert.strictEqual(proc.exitCode, 0);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.data.received, { project: "ActionDock", stars: 100 });
  });

  // 3. --input-file - stdin
  it("executes action reading JSON from stdin via --input-file -", async () => {
    const stdinPayload = JSON.stringify({ mode: "streamed", count: 99 });
    const proc = await runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, stdinPayload);
    assert.strictEqual(proc.exitCode, 0);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.data.received, { mode: "streamed", count: 99 });
  });

  // 4. 无输入默认 {}
  it("executes action with default empty object {} when no input is provided", async () => {
    const proc = await runCli(["run", "test.echo", "--json"], tempDir);
    assert.strictEqual(proc.exitCode, 0);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.data.received, {});
  });

  // 5. --input 与 --input-file 冲突
  it("rejects when both --input and --input-file are provided with exit code 2", async () => {
    const filePath = join(tempDir, "input.json");
    writeFileSync(filePath, "{}", "utf-8");

    // Human mode
    const proc = await runCli(["run", "test.echo", "--input", "{\"a\":1}", "--input-file", filePath], tempDir);
    assert.strictEqual(proc.exitCode, 2);
    assert.ok((proc.stderr.toString()).includes("mutually exclusive"));

    // Machine mode (--json)
    const procJson = await runCli(["run", "test.echo", "--input", "{\"a\":1}", "--input-file", filePath, "--json"], tempDir);
    assert.strictEqual(procJson.exitCode, 2);
    const res = JSON.parse(procJson.stdout.toString());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, "INPUT_CONFLICT");
    assert.ok((res.error.message).includes("mutually exclusive"));
  });

  // 6. 非法 inline JSON
  it("rejects invalid inline JSON with exit code 2 and INVALID_JSON code", async () => {
    const proc = await runCli(["run", "test.echo", "--input", "{\"invalid\":", "--json"], tempDir);
    assert.strictEqual(proc.exitCode, 2);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, "INVALID_JSON");
    assert.ok((res.error.message).includes("Invalid JSON input from --input"));
  });

  // 7. 非法文件 JSON
  it("rejects invalid JSON file with exit code 2 and INVALID_JSON code", async () => {
    const filePath = join(tempDir, "bad.json");
    writeFileSync(filePath, "{\ninvalid json here\n", "utf-8");

    const proc = await runCli(["run", "test.echo", "--input-file", filePath, "--json"], tempDir);
    assert.strictEqual(proc.exitCode, 2);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, "INVALID_JSON");
    assert.ok((res.error.message).includes(`Invalid JSON input from ${filePath}`));
  });

  // 8. 非法 stdin JSON
  it("rejects invalid JSON from stdin with exit code 2 and INVALID_JSON code", async () => {
    const proc = await runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, "{not json}");
    assert.strictEqual(proc.exitCode, 2);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, "INVALID_JSON");
    assert.ok((res.error.message).includes("Invalid JSON input from stdin"));
  });

  // 9. 文件不存在
  it("rejects nonexistent input file with exit code 2 and INPUT_FILE_NOT_FOUND code", async () => {
    const missingPath = join(tempDir, "does-not-exist.json");
    const proc = await runCli(["run", "test.echo", "--input-file", missingPath, "--json"], tempDir);
    assert.strictEqual(proc.exitCode, 2);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, "INPUT_FILE_NOT_FOUND");
    assert.ok((res.error.message).includes(`Input file not found: ${missingPath}`));
  });

  // 10. UTF-8 BOM
  it("strips UTF-8 BOM correctly from both file and stdin", async () => {
    // BOM in file
    const bomFilePath = join(tempDir, "bom.json");
    writeFileSync(bomFilePath, "\uFEFF{\"source\":\"bom-file\",\"active\":true}", "utf-8");
    const fileProc = await runCli(["run", "test.echo", "--input-file", bomFilePath, "--json"], tempDir);
    assert.strictEqual(fileProc.exitCode, 0);
    const fileRes = JSON.parse(fileProc.stdout.toString());
    assert.strictEqual(fileRes.ok, true);
    assert.deepStrictEqual(fileRes.data.received, { source: "bom-file", active: true });

    // BOM in stdin
    const bomStdin = "\uFEFF{\"source\":\"bom-stdin\",\"active\":false}";
    const stdinProc = await runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, bomStdin);
    assert.strictEqual(stdinProc.exitCode, 0);
    const stdinRes = JSON.parse(stdinProc.stdout.toString());
    assert.strictEqual(stdinRes.ok, true);
    assert.deepStrictEqual(stdinRes.data.received, { source: "bom-stdin", active: false });
  });

  // 11. 多行 JSON
  it("correctly parses multi-line formatted JSON from file and stdin", async () => {
    const multilineJson = `{\n  "title": "multi-line",\n  "nested": {\n    "items": [\n      1,\n      2,\n      3\n    ]\n  }\n}`;
    const filePath = join(tempDir, "multiline.json");
    writeFileSync(filePath, multilineJson, "utf-8");

    const fileProc = await runCli(["run", "test.echo", "--input-file", filePath, "--json"], tempDir);
    assert.strictEqual(fileProc.exitCode, 0);
    const fileRes = JSON.parse(fileProc.stdout.toString());
    assert.strictEqual(fileRes.ok, true);
    assert.deepStrictEqual(fileRes.data.received.nested.items, [1, 2, 3]);

    const stdinProc = await runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, multilineJson);
    assert.strictEqual(stdinProc.exitCode, 0);
    const stdinRes = JSON.parse(stdinProc.stdout.toString());
    assert.strictEqual(stdinRes.ok, true);
    assert.strictEqual(stdinRes.data.received.title, "multi-line");
  });

  // 12. JSON 中包含双引号、反斜杠、换行
  it("correctly handles quotes, backslashes, and escaped newlines inside JSON values", async () => {
    const complexPayload = {
      escapedQuotes: 'He said, "ActionDock is great!"',
      backslashes: 'C:\\Users\\admin\\Desktop\\project\\config.json',
      newlines: 'Line 1\nLine 2\nLine 3\r\nLine 4',
      regex: '^https?:\\/\\/[a-z0-9]+',
    };
    const jsonStr = JSON.stringify(complexPayload);

    // Test file input
    const filePath = join(tempDir, "complex.json");
    writeFileSync(filePath, jsonStr, "utf-8");
    const fileProc = await runCli(["run", "test.echo", "--input-file", filePath, "--json"], tempDir);
    assert.strictEqual(fileProc.exitCode, 0);
    const fileRes = JSON.parse(fileProc.stdout.toString());
    assert.deepStrictEqual(fileRes.data.received, complexPayload);

    // Test stdin input
    const stdinProc = await runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, jsonStr);
    assert.strictEqual(stdinProc.exitCode, 0);
    const stdinRes = JSON.parse(stdinProc.stdout.toString());
    assert.deepStrictEqual(stdinRes.data.received, complexPayload);
  });

  // 13. 空文件
  it("rejects empty file with exit code 2 and INVALID_JSON error", async () => {
    const emptyFile = join(tempDir, "empty.json");
    writeFileSync(emptyFile, "", "utf-8");

    const proc = await runCli(["run", "test.echo", "--input-file", emptyFile, "--json"], tempDir);
    assert.strictEqual(proc.exitCode, 2);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, "INVALID_JSON");
    assert.ok((res.error.message).includes(`Invalid JSON input from ${emptyFile}`));
  });

  // 14. 空 stdin
  it("rejects empty stdin with exit code 2 and INVALID_JSON error", async () => {
    const proc = await runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, "");
    assert.strictEqual(proc.exitCode, 2);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, "INVALID_JSON");
    assert.ok((res.error.message).includes("Invalid JSON input from stdin"));
  });
});
