import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderRawExecutionResult } from "../src/commands/run";
import { extractTextFieldPayload, resolveActionDefaultTextField } from "../src/renderer";
import { ArgumentError, ExecutionError } from "../src/errors";
import { startActionDockServer, type ActionDockServerInstance } from "@actiondock/core/server";
import type { ExecutionResult } from "@actiondock/sdk";

import { runCliAsync } from "./helpers/run-cli";

let tempHome: string | undefined;
let serverInstance: ActionDockServerInstance | undefined;
let tempRemoteDir: string | undefined;
let serverUrl: string | undefined;
const REMOTE_SECRET = "test-secret-raw-token";

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

  describe("Text Field Extraction & Default Annotation - Unit Tests", () => {
    it("resolveActionDefaultTextField extracts valid textField string", () => {
      assert.strictEqual(
        resolveActionDefaultTextField({ "actiondock.cli": { textField: "content" } }),
        "content"
      );
    });

    it("resolveActionDefaultTextField returns undefined when annotations or actiondock.cli is absent", () => {
      assert.strictEqual(resolveActionDefaultTextField(undefined), undefined);
      assert.strictEqual(resolveActionDefaultTextField({}), undefined);
      assert.strictEqual(resolveActionDefaultTextField({ other: "val" }), undefined);
      assert.strictEqual(resolveActionDefaultTextField({ "actiondock.cli": {} }), undefined);
    });

    it("resolveActionDefaultTextField throws ExecutionError on invalid actiondock.cli annotation", () => {
      assert.throws(
        () => resolveActionDefaultTextField({ "actiondock.cli": "not-an-object" as any }),
        (err: any) => err instanceof ExecutionError && err.code === "INVALID_ANNOTATION"
      );
      assert.throws(
        () => resolveActionDefaultTextField({ "actiondock.cli": [1, 2] as any }),
        (err: any) => err instanceof ExecutionError && err.code === "INVALID_ANNOTATION"
      );
      assert.throws(
        () => resolveActionDefaultTextField({ "actiondock.cli": { textField: 123 } as any }),
        (err: any) => err instanceof ExecutionError && err.code === "INVALID_ANNOTATION"
      );
      assert.throws(
        () => resolveActionDefaultTextField({ "actiondock.cli": { textField: "" } }),
        (err: any) => err instanceof ExecutionError && err.code === "INVALID_ANNOTATION"
      );
      assert.throws(
        () => resolveActionDefaultTextField({ "actiondock.cli": { textField: "   " } }),
        (err: any) => err instanceof ExecutionError && err.code === "INVALID_ANNOTATION"
      );
    });

    it("extractTextFieldPayload extracts string text and non-empty metadata", () => {
      const data = {
        path: "README.md",
        startLine: 1,
        endLine: 3,
        content: "# Header\nLine 2",
        hasMore: false,
      };
      const res = extractTextFieldPayload(data, "content");
      assert.strictEqual(res.text, "# Header\nLine 2");
      assert.deepStrictEqual(res.metadata, {
        path: "README.md",
        startLine: 1,
        endLine: 3,
        hasMore: false,
      });
    });

    it("extractTextFieldPayload handles text-only data with undefined metadata", () => {
      const res = extractTextFieldPayload({ message: "just message" }, "message");
      assert.strictEqual(res.text, "just message");
      assert.strictEqual(res.metadata, undefined);
    });

    it("extractTextFieldPayload accepts empty string as valid text", () => {
      const res = extractTextFieldPayload({ content: "", path: "test.txt" }, "content");
      assert.strictEqual(res.text, "");
      assert.deepStrictEqual(res.metadata, { path: "test.txt" });
    });

    it("extractTextFieldPayload throws on non-object or array data", () => {
      assert.throws(
        () => extractTextFieldPayload(null, "content"),
        (err: any) => err instanceof ExecutionError && err.code === "OUTPUT_FORMAT_ERROR"
      );
      assert.throws(
        () => extractTextFieldPayload("scalar string", "content"),
        (err: any) => err instanceof ExecutionError && err.code === "OUTPUT_FORMAT_ERROR"
      );
      assert.throws(
        () => extractTextFieldPayload(42, "content"),
        (err: any) => err instanceof ExecutionError && err.code === "OUTPUT_FORMAT_ERROR"
      );
      assert.throws(
        () => extractTextFieldPayload([{ content: "in array" }], "content"),
        (err: any) => err instanceof ExecutionError && err.code === "OUTPUT_FORMAT_ERROR"
      );
    });

    it("extractTextFieldPayload throws when field is missing or non-string", () => {
      assert.throws(
        () => extractTextFieldPayload({ path: "test.txt" }, "content"),
        (err: any) => err instanceof ExecutionError && err.code === "OUTPUT_FORMAT_ERROR"
      );
      assert.throws(
        () => extractTextFieldPayload({ content: 123 }, "content"),
        (err: any) => err instanceof ExecutionError && err.code === "OUTPUT_FORMAT_ERROR"
      );
      assert.throws(
        () => extractTextFieldPayload({ content: null }, "content"),
        (err: any) => err instanceof ExecutionError && err.code === "OUTPUT_FORMAT_ERROR"
      );
      assert.throws(
        () => extractTextFieldPayload({ content: { nested: true } }, "content"),
        (err: any) => err instanceof ExecutionError && err.code === "OUTPUT_FORMAT_ERROR"
      );
    });

    it("extractTextFieldPayload rejects prototype-inherited fields and avoids prototype pollution in metadata", () => {
      const proto = { inherited: "proto-val" };
      const obj = Object.create(proto);
      obj.own = "own-val";

      assert.throws(
        () => extractTextFieldPayload(obj, "inherited"),
        (err: any) => err instanceof ExecutionError && err.code === "OUTPUT_FORMAT_ERROR"
      );

      const res = extractTextFieldPayload(
        { content: "text", __proto__: { evil: true } as any, normal: 1 },
        "content"
      );
      assert.strictEqual(res.text, "text");
      assert.strictEqual(Object.prototype.hasOwnProperty.call(Object.prototype, "evil"), false);
    });

    it("renderRawExecutionResult with textField outputs raw text to stdout and metadata to stderr", () => {
      const stdoutLogs: string[] = [];
      const stderrLogs: string[] = [];

      renderRawExecutionResult(
        "files.read",
        {
          ok: true,
          runId: "run-tf-1",
          data: { path: "a.ts", content: "export default 1;\n" },
        },
        {
          stdout: (msg) => stdoutLogs.push(msg),
          stderr: (msg) => stderrLogs.push(msg),
        },
        { textField: "content" }
      );

      assert.strictEqual(stdoutLogs.join("\n"), "export default 1;\n");
      assert.strictEqual(
        stderrLogs.join("\n"),
        JSON.stringify({ path: "a.ts" }, null, 2)
      );
    });

    it("renderRawExecutionResult with textField does not write to stderr if metadata is empty", () => {
      const stdoutLogs: string[] = [];
      const stderrLogs: string[] = [];

      renderRawExecutionResult(
        "files.read",
        {
          ok: true,
          runId: "run-tf-2",
          data: { content: "only body" },
        },
        {
          stdout: (msg) => stdoutLogs.push(msg),
          stderr: (msg) => stderrLogs.push(msg),
        },
        { textField: "content" }
      );

      assert.strictEqual(stdoutLogs.join("\n"), "only body");
      assert.strictEqual(stderrLogs.length, 0);
    });
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

    // Create additional test actions
    writeFileSync(
      join(tempDir, "actions", "text-only.ts"),
      `import { defineAction } from "@actiondock/sdk";
export default defineAction(async () => {
  return { content: "only text content" };
});
`,
      "utf-8"
    );

    writeFileSync(
      join(tempDir, "actions", "empty-text.ts"),
      `import { defineAction } from "@actiondock/sdk";
export default defineAction(async () => {
  return { content: "", fileId: "123" };
});
`,
      "utf-8"
    );

    writeFileSync(
      join(tempDir, "actions", "annotated.ts"),
      `import { defineAction } from "@actiondock/sdk";
export default defineAction(async () => {
  return {
    path: "docs/readme.md",
    content: "# Title\\nBody line 2",
    extra: 42,
  };
});
`,
      "utf-8"
    );

    writeFileSync(
      join(tempDir, "actions", "bad-annotated.ts"),
      `import { defineAction } from "@actiondock/sdk";
import { writeFileSync } from "node:fs";
export default defineAction(async () => {
  writeFileSync("${join(tempDir, "bad-annotated.ran").replace(/\\/g, "/")}", "ran");
  return { content: "should not run" };
});
`,
      "utf-8"
    );

    writeFileSync(
      join(tempDir, "actions", "side-effect.ts"),
      `import { defineAction } from "@actiondock/sdk";
import { appendFileSync } from "node:fs";
export default defineAction(async () => {
  appendFileSync("${join(tempDir, "side-effect-counter.txt").replace(/\\/g, "/")}", "1\\n");
  return { notContent: "no text field here" };
});
`,
      "utf-8"
    );

    writeFileSync(
      join(tempDir, "actions", "array.ts"),
      `import { defineAction } from "@actiondock/sdk";
export default defineAction(async () => {
  return [{ content: "in array" }];
});
`,
      "utf-8"
    );

    writeFileSync(
      join(tempDir, "actions", "proto.ts"),
      `import { defineAction } from "@actiondock/sdk";
export default defineAction(async () => {
  const p = { content: "from proto" };
  const obj = Object.create(p);
  obj.own = "val";
  return obj;
});
`,
      "utf-8"
    );

    // Register actions in actiondock.json
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
    existingConfig.actions["files.text-only"] = {
      entry: "actions/text-only.ts",
      description: "Text only",
    };
    existingConfig.actions["files.empty-text"] = {
      entry: "actions/empty-text.ts",
      description: "Empty text",
    };
    existingConfig.actions["annotated.read"] = {
      entry: "actions/annotated.ts",
      description: "Annotated read",
      annotations: {
        "actiondock.cli": {
          textField: "content",
        },
      },
    };
    existingConfig.actions["bad-annotated.action"] = {
      entry: "actions/bad-annotated.ts",
      description: "Bad annotation",
      annotations: {
        "actiondock.cli": {
          textField: 12345,
        },
      },
    };
    existingConfig.actions["side-effect.action"] = {
      entry: "actions/side-effect.ts",
      description: "Side effect counter",
    };
    existingConfig.actions["array.action"] = {
      entry: "actions/array.ts",
      description: "Array result",
    };
    existingConfig.actions["proto.action"] = {
      entry: "actions/proto.ts",
      description: "Proto result",
    };
    writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), "utf-8");

    // Initialize remote package and start server
    tempRemoteDir = mkdtempSync(join(tmpdir(), "ad-cli-raw-remote-"));
    const remoteInit = await runCli(["init", "--id", "test.remote-pkg", "--name", "Remote Pkg", "."], tempRemoteDir);
    assert.strictEqual(remoteInit.exitCode, 0);

    const remoteActionSource = `import { defineAction } from "@actiondock/sdk";
export default defineAction(async () => {
  return {
    remotePath: "remote/file.txt",
    body: "Remote multiline body\\nLine 2",
    version: 1,
  };
});
`;
    writeFileSync(join(tempRemoteDir, "actions", "remote-read.ts"), remoteActionSource, "utf-8");

    const remoteConfigPath = join(tempRemoteDir, "actiondock.json");
    const remoteConfig = JSON.parse(
      existsSync(remoteConfigPath) ? readFileSync(remoteConfigPath, "utf-8") : "{}"
    );
    remoteConfig.actions = remoteConfig.actions || {};
    remoteConfig.actions["remote.read"] = {
      entry: "actions/remote-read.ts",
      description: "Remote read with annotation",
      annotations: {
        "actiondock.cli": {
          textField: "body",
        },
      },
    };
    writeFileSync(remoteConfigPath, JSON.stringify(remoteConfig, null, 2), "utf-8");

    serverInstance = await startActionDockServer({
      port: 0,
      host: "127.0.0.1",
      token: REMOTE_SECRET,
      projectRoot: tempRemoteDir,
    });
    serverUrl = `http://127.0.0.1:${serverInstance.port}`;
  });

  after(async () => {
    if (serverInstance) {
      try {
        await serverInstance.stop();
      } catch {}
      serverInstance = undefined;
    }
    if (tempRemoteDir && existsSync(tempRemoteDir)) {
      try {
        rmSync(tempRemoteDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {}
      tempRemoteDir = undefined;
    }
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

  it("outputs raw text to stdout and remaining metadata to stderr with --text-field", async () => {
    const proc = await runCli(
      [
        "run",
        "files.read",
        "--text-field",
        "content",
        "-i",
        JSON.stringify({ path: "docs/readme.md" }),
      ],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 0);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    assert.strictEqual(stdout, "# File Header\n\nBody text line 3\n");
    const meta = JSON.parse(stderr);
    assert.deepStrictEqual(meta, {
      path: "docs/readme.md",
      startLine: 1,
      endLine: 3,
      hasMore: false,
    });
  });

  it("outputs raw text to stdout with empty stderr when text field is the only field", async () => {
    const proc = await runCli(
      ["run", "files.text-only", "--text-field", "content"],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 0);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    assert.strictEqual(stdout, "only text content\n");
    assert.strictEqual(stderr.trim(), "");
  });

  it("handles empty string as valid text field value and outputs metadata to stderr", async () => {
    const proc = await runCli(
      ["run", "files.empty-text", "--text-field", "content"],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 0);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    assert.strictEqual(stdout, "\n");
    const meta = JSON.parse(stderr);
    assert.deepStrictEqual(meta, { fileId: "123" });
  });

  it("automatically outputs declared text field and metadata when Action has default cli annotation", async () => {
    const proc = await runCli(["run", "annotated.read"], tempDir);
    assert.strictEqual(proc.exitCode, 0);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    assert.strictEqual(stdout, "# Title\nBody line 2\n");
    const meta = JSON.parse(stderr);
    assert.deepStrictEqual(meta, { path: "docs/readme.md", extra: 42 });
  });

  it("allows explicit --text-field to override Action default cli annotation", async () => {
    const proc = await runCli(
      ["run", "annotated.read", "--text-field", "path"],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 0);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    assert.strictEqual(stdout, "docs/readme.md\n");
    const meta = JSON.parse(stderr);
    assert.deepStrictEqual(meta, {
      content: "# Title\nBody line 2",
      extra: 42,
    });
  });

  it("ignores Action default cli annotation and outputs machine envelope when --json is provided", async () => {
    const proc = await runCli(["run", "annotated.read", "--json"], tempDir);
    assert.strictEqual(proc.exitCode, 0);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    assert.strictEqual(stderr.trim(), "");
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.data.path, "docs/readme.md");
    assert.strictEqual(parsed.data.content, "# Title\nBody line 2");
    assert.strictEqual(parsed.data.extra, 42);
  });

  it("rejects --text-field combined with --json before execution", async () => {
    const proc = await runCli(
      ["run", "files.read", "--text-field", "content", "--json"],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 2);

    const parsed = JSON.parse(proc.stdout.toString());
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.error.code, "INVALID_ARGUMENT");
    assert.ok(parsed.error.message.includes("Cannot specify both --text-field and --json"));
  });

  it("rejects --text-field combined with --async before execution", async () => {
    const proc = await runCli(
      ["run", "files.read", "--text-field", "content", "--async"],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 2);

    const stderr = proc.stderr.toString();
    assert.ok(stderr.includes("Cannot specify both --text-field and --async"));
  });

  it("rejects empty --text-field option before execution", async () => {
    const proc = await runCli(
      ["run", "files.read", "--text-field", ""],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 2);

    const stderr = proc.stderr.toString();
    assert.ok(stderr.includes("requires a non-empty field name"));
  });

  it("rejects execution before calling action when Action has invalid annotation", async () => {
    const proc = await runCli(["run", "bad-annotated.action"], tempDir);
    assert.strictEqual(proc.exitCode, 1);

    const stderr = proc.stderr.toString();
    assert.ok(stderr.includes("Invalid 'actiondock.cli.textField' annotation"));

    // Verify action was NEVER invoked (no side-effect executed)
    assert.strictEqual(existsSync(join(tempDir, "bad-annotated.ran")), false);
  });

  it("reports CLI output format error and does not re-run action on runtime missing text field", async () => {
    const proc = await runCli(
      ["run", "side-effect.action", "--text-field", "content"],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 1);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    assert.strictEqual(stdout.trim(), "");
    assert.ok(
      stderr.includes("CLI output format error: text field 'content' was not found in result data")
    );

    // Verify action ran exactly once (was NOT re-run)
    const counterContent = readFileSync(join(tempDir, "side-effect-counter.txt"), "utf-8");
    assert.strictEqual(counterContent.trim(), "1");

    // Verify run record in storage was recorded as completed and not rewritten
    const runsProc = await runCli(["runs", "list", "-a", "side-effect.action", "--json"], tempDir);
    assert.strictEqual(runsProc.exitCode, 0);
    const runsData = JSON.parse(runsProc.stdout.toString());
    const items = Array.isArray(runsData) ? runsData : runsData.items;
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].status, "success");
  });

  it("reports CLI output format error when result data is an array", async () => {
    const proc = await runCli(
      ["run", "array.action", "--text-field", "content"],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 1);

    const stderr = proc.stderr.toString();
    assert.ok(
      stderr.includes("CLI output format error: expected result data to be an object, but received an array")
    );
  });

  it("reports CLI output format error when target text field is inherited from prototype", async () => {
    const proc = await runCli(
      [
        "run",
        "files.read",
        "--text-field",
        "toString",
        "-i",
        JSON.stringify({ path: "docs/readme.md" }),
      ],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 1);

    const stderr = proc.stderr.toString();
    assert.ok(
      stderr.includes("CLI output format error: text field 'toString' was not found in result data")
    );
  });

  it("resolves default annotation and outputs text and metadata on remote server", async () => {
    const proc = await runCli(
      [
        "run",
        "remote.read",
        "--server",
        serverUrl!,
        "--token",
        REMOTE_SECRET,
        "--allow-insecure-http",
      ],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 0);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    assert.strictEqual(stdout, "Remote multiline body\nLine 2\n");
    const meta = JSON.parse(stderr);
    assert.deepStrictEqual(meta, {
      remotePath: "remote/file.txt",
      version: 1,
    });
  });

  it("allows explicit --text-field to override default annotation on remote server", async () => {
    const proc = await runCli(
      [
        "run",
        "remote.read",
        "--server",
        serverUrl!,
        "--token",
        REMOTE_SECRET,
        "--allow-insecure-http",
        "--text-field",
        "remotePath",
      ],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 0);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    assert.strictEqual(stdout, "remote/file.txt\n");
    const meta = JSON.parse(stderr);
    assert.deepStrictEqual(meta, {
      body: "Remote multiline body\nLine 2",
      version: 1,
    });
  });

  it("ignores default annotation on remote server when --json is provided", async () => {
    const proc = await runCli(
      [
        "run",
        "remote.read",
        "--server",
        serverUrl!,
        "--token",
        REMOTE_SECRET,
        "--allow-insecure-http",
        "--json",
      ],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 0);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    assert.strictEqual(stderr.trim(), "");
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.data.body, "Remote multiline body\nLine 2");
    assert.strictEqual(parsed.data.remotePath, "remote/file.txt");
    assert.strictEqual(parsed.data.version, 1);
  });
});
