import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderRawExecutionResult } from "../src/commands/run";
import type { ExecutionResult } from "@actiondock/sdk";

import { runCliAsync } from "./helpers/run-cli";

let tempHome: string | undefined;

async function runCli(
  args: string[],
  cwd?: string,
  env?: Record<string, string>
) {
  return await runCliAsync(args, cwd, {
    ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}),
    ...env,
  });
}

describe("CLI Action Raw Output Mode - Unit Tests", () => {
  it("renders pure string data directly to stdout without metadata", () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    const mockResult: ExecutionResult = {
      ok: true,
      runId: "test-run-3",
      data: "pure string output",
    };

    renderRawExecutionResult("test.echo", mockResult, {
      stdout: (msg) => stdoutLogs.push(msg),
      stderr: (msg) => stderrLogs.push(msg),
    });

    assert.strictEqual(stdoutLogs.join("\n"), "pure string output");
    assert.strictEqual(stderrLogs.length, 0);
  });

  it("renders scalar numbers and booleans directly to stdout without metadata", () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    renderRawExecutionResult(
      "test.num",
      { ok: true, runId: "test-run-num", data: 42 },
      {
        stdout: (msg) => stdoutLogs.push(msg),
        stderr: (msg) => stderrLogs.push(msg),
      }
    );
    renderRawExecutionResult(
      "test.bool",
      { ok: true, runId: "test-run-bool", data: true },
      {
        stdout: (msg) => stdoutLogs.push(msg),
        stderr: (msg) => stderrLogs.push(msg),
      }
    );

    assert.strictEqual(stdoutLogs[0], "42");
    assert.strictEqual(stdoutLogs[1], "true");
    assert.strictEqual(stderrLogs.length, 0);
  });

  it("renders structured object as standard formatted JSON without private metadata sniffing", () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    const mockResult: ExecutionResult = {
      ok: true,
      runId: "test-run-1",
      data: {
        path: "system-knowledge/db-map.md",
        startLine: 1,
        endLine: 17,
        content: "# Database Map\nLine 2\nLine 3",
        hasMore: false,
      },
    };

    renderRawExecutionResult("files.read", mockResult, {
      stdout: (msg) => stdoutLogs.push(msg),
      stderr: (msg) => stderrLogs.push(msg),
    });

    assert.strictEqual(
      stdoutLogs.join("\n"),
      JSON.stringify(mockResult.data, null, 2)
    );
    assert.strictEqual(stderrLogs.length, 0, "通用纯文本输出不应嗅探业务字段写入 stderr 元数据");
  });

  it("renders empty string for undefined data", () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    const mockResult: ExecutionResult = {
      ok: true,
      runId: "test-run-empty",
      data: undefined as any,
    };

    renderRawExecutionResult("test.noop", mockResult, {
      stdout: (msg) => stdoutLogs.push(msg),
      stderr: (msg) => stderrLogs.push(msg),
    });

    assert.strictEqual(stdoutLogs.join("\n"), "");
    assert.strictEqual(stderrLogs.length, 0);
  });

  it("renders error to stderr and sets exitCode on failure", () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    const prevExitCode = process.exitCode;
    try {
      const mockResult: ExecutionResult = {
        ok: false,
        runId: "test-run-err",
        error: {
          code: "FILE_NOT_FOUND",
          message: "File could not be opened",
        },
      };

      renderRawExecutionResult("files.read", mockResult, {
        stdout: (msg) => stdoutLogs.push(msg),
        stderr: (msg) => stderrLogs.push(msg),
      });

      assert.strictEqual(stdoutLogs.length, 0);
      assert.ok((stderrLogs.join("\n")).includes("Error [FILE_NOT_FOUND]: File could not be opened"));
      assert.ok(!(stderrLogs.join("\n")).includes("Tip: Run 'ad describe"));
      assert.strictEqual(process.exitCode, 1);
    } finally {
      process.exitCode = prevExitCode ?? 0;
    }
  });

  it("renders describe guidance tip to stderr when error code is INPUT_VALIDATION_FAILED", () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    const prevExitCode = process.exitCode;
    try {
      const mockResult: ExecutionResult = {
        ok: false,
        runId: "test-run-input-val-err",
        error: {
          code: "INPUT_VALIDATION_FAILED",
          message: "Input schema validation failed for action 'files.read'",
          details: ["must have required property 'path'"],
        },
      };

      renderRawExecutionResult("files.read", mockResult, {
        stdout: (msg) => stdoutLogs.push(msg),
        stderr: (msg) => stderrLogs.push(msg),
      });

      assert.strictEqual(stdoutLogs.length, 0);
      const stderr = stderrLogs.join("\n");
      assert.ok((stderr).includes("Error [INPUT_VALIDATION_FAILED]: Input schema validation failed for action 'files.read'"));
      assert.ok((stderr).includes("must have required property 'path'"));
      assert.ok((stderr).includes("Tip: Run 'ad describe files.read' to inspect schema and syntax examples."));
      assert.strictEqual(process.exitCode, 1);
    } finally {
      process.exitCode = prevExitCode ?? 0;
    }
  });

  it("does not render describe guidance tip when error code is ACTION_FAILED", () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    const prevExitCode = process.exitCode;
    try {
      const mockResult: ExecutionResult = {
        ok: false,
        runId: "test-run-action-failed",
        error: {
          code: "ACTION_FAILED",
          message: "Action business logic threw an unhandled error",
        },
      };

      renderRawExecutionResult("files.read", mockResult, {
        stdout: (msg) => stdoutLogs.push(msg),
        stderr: (msg) => stderrLogs.push(msg),
      });

      assert.strictEqual(stdoutLogs.length, 0);
      const stderr = stderrLogs.join("\n");
      assert.ok((stderr).includes("Error [ACTION_FAILED]: Action business logic threw an unhandled error"));
      assert.ok(!(stderr).includes("Tip: Run 'ad describe"));
      assert.strictEqual(process.exitCode, 1);
    } finally {
      process.exitCode = prevExitCode ?? 0;
    }
  });
});

describe("CLI Action Raw Output Mode - End-to-End Tests", () => {
  let tempDir: string;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-cli-raw-test-"));
    tempHome = mkdtempSync(join(tmpdir(), "ad-cli-raw-home-"));

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
      } catch {}
    }

    // Initialize package
    const initProc = await runCli(["init", "--id", "test.raw-pkg", "--name", "Raw Pkg", "."], tempDir);
    assert.strictEqual(initProc.exitCode, 0);

    // Create a mock files.read action
    const filesReadSource = `import { defineAction } from "@actiondock/sdk";
export default defineAction(async (input: { path: string }) => {
  if (input.path === "missing.txt") {
    throw new Error("File not found: missing.txt");
  }
  return {
    path: input.path,
    startLine: 1,
    endLine: 3,
    content: "# File Header\\n\\nBody text line 3",
    hasMore: false,
  };
});
`;
    writeFileSync(join(tempDir, "actions", "read.ts"), filesReadSource, "utf-8");

    // Register action in actiondock.json
    const configPath = join(tempDir, "actiondock.json");
    const existingConfig = JSON.parse(
      existsSync(configPath) ? readFileSync(configPath, "utf-8") : "{}"
    );
    existingConfig.actions = existingConfig.actions || {};
    existingConfig.actions["files.read"] = {
      entry: "actions/read.ts",
      description: "Read file content",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
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

  it("defaults to structured JSON output without stderr metadata sniffing", async () => {
    const proc = await runCli(
      ["run", "files.read", "--input", JSON.stringify({ path: "docs/readme.md" })],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 0);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.path, "docs/readme.md");
    assert.strictEqual(parsed.content, "# File Header\n\nBody text line 3");
    assert.strictEqual(stderr.trim(), "");
  });

  it("outputs standard JSON execution envelope when --json is provided", async () => {
    const proc = await runCli(
      ["run", "files.read", "-i", JSON.stringify({ path: "test.txt" }), "--json"],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 0);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    assert.strictEqual(stderr.trim(), "");
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.ok, true);
    assert.notStrictEqual(parsed.runId, undefined);
    assert.strictEqual(parsed.data.path, "test.txt");
    assert.strictEqual(parsed.data.content, "# File Header\n\nBody text line 3");
  });

  it("works with ad run defaulting to raw and supporting --json", async () => {
    // Default raw (结构化对象按标准规范呈现)
    const procRaw = await runCli(
      ["run", "files.read", "-i", JSON.stringify({ path: "info.md" })],
      tempDir
    );
    assert.strictEqual(procRaw.exitCode, 0);
    const parsedRaw = JSON.parse(procRaw.stdout.toString());
    assert.strictEqual(parsedRaw.path, "info.md");
    assert.strictEqual(procRaw.stderr.toString().trim(), "");

    // --json machine envelope
    const procJson = await runCli(
      ["run", "files.read", "-i", JSON.stringify({ path: "info.md" }), "--json"],
      tempDir
    );
    assert.strictEqual(procJson.exitCode, 0);
    const parsed = JSON.parse(procJson.stdout.toString());
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.data.path, "info.md");

    // 验证 action run 套壳已被删除拒绝
    const procActionRun = await runCli(
      ["action", "run", "files.read", "-i", JSON.stringify({ path: "info.md" })],
      tempDir
    );
    assert.notStrictEqual(procActionRun.exitCode, 0, "action run 套壳命令应被拒绝");
  });

  it("handles action error properly by writing to stderr by default", async () => {
    const proc = await runCli(
      ["run", "files.read", "-i", JSON.stringify({ path: "missing.txt" })],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 1);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    assert.strictEqual(stdout.trim(), "");
    assert.ok((stderr).includes("Error"));
    assert.ok((stderr).includes("File not found: missing.txt"));
    assert.ok(!(stderr).includes("Tip: Run 'ad describe"));
  });

  it("handles action error properly by outputting JSON envelope when --json is provided", async () => {
    const proc = await runCli(
      ["run", "files.read", "-i", JSON.stringify({ path: "missing.txt" }), "--json"],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 1);

    const stdout = proc.stdout.toString();
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.ok, false);
    assert.ok((parsed.error.message).includes("File not found: missing.txt"));
  });

  it("renders describe guidance tip to stderr on INPUT_VALIDATION_FAILED in raw mode", async () => {
    const proc = await runCli(
      ["run", "files.read", "-i", JSON.stringify({ wrongField: "val" })],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 1);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    assert.strictEqual(stdout.trim(), "");
    assert.ok((stderr).includes("Error [INPUT_VALIDATION_FAILED]"));
    assert.ok((stderr).includes("Tip: Run 'ad describe files.read' to inspect schema and syntax examples."));
  });

  it("outputs describe guidance hint on INPUT_VALIDATION_FAILED in machine output when --json is provided", async () => {
    const proc = await runCli(
      ["run", "files.read", "-i", JSON.stringify({ wrongField: "val" }), "--json"],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 1);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    assert.strictEqual(stderr.trim(), "");
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.error.code, "INPUT_VALIDATION_FAILED");
    assert.strictEqual(parsed.hint, "Tip: Run 'ad describe files.read' to inspect schema and syntax examples.");
  });
});
