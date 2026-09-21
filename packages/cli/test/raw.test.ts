import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
setDefaultTimeout(120000);
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderRawExecutionResult } from "../src/commands/run";
import type { ExecutionResult } from "@actiondock/sdk";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");

let tempHome: string | undefined;

function runCli(
  args: string[],
  cwd?: string,
  env?: Record<string, string>
) {
  return Bun.spawnSync(["bun", cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("CLI Action Raw Output Mode - Unit Tests", () => {
  it("renders content to stdout and metadata to stderr when result has content and range info", () => {
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

    expect(stdoutLogs.join("\n")).toBe("# Database Map\nLine 2\nLine 3");
    expect(stderrLogs.join("\n")).toContain("[system-knowledge/db-map.md | lines 1-17 | hasMore: false]");
  });

  it("renders truncated metadata flag when truncated is true", () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    const mockResult: ExecutionResult = {
      ok: true,
      runId: "test-run-2",
      data: {
        path: "large-file.log",
        startLine: 1,
        endLine: 200,
        content: "Log content...",
        hasMore: true,
        truncated: true,
      },
    };

    renderRawExecutionResult("files.read", mockResult, {
      stdout: (msg) => stdoutLogs.push(msg),
      stderr: (msg) => stderrLogs.push(msg),
    });

    expect(stdoutLogs.join("\n")).toBe("Log content...");
    expect(stderrLogs.join("\n")).toContain("truncated: true");
    expect(stderrLogs.join("\n")).toContain("hasMore: true");
  });

  it("safely stringifies content when content itself is a nested object", () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    const mockResult: ExecutionResult = {
      ok: true,
      runId: "test-run-obj-content",
      data: {
        path: "config.json",
        content: { key: "value", list: [1, 2] },
      },
    };

    renderRawExecutionResult("files.read", mockResult, {
      stdout: (msg) => stdoutLogs.push(msg),
      stderr: (msg) => stderrLogs.push(msg),
    });

    expect(stdoutLogs.join("\n")).toBe(JSON.stringify({ key: "value", list: [1, 2] }, null, 2));
    expect(stderrLogs.join("\n")).toContain("[config.json]");
  });

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

    expect(stdoutLogs.join("\n")).toBe("pure string output");
    expect(stderrLogs.length).toBe(0);
  });

  it("renders message field to stdout when data contains message", () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    const mockResult: ExecutionResult = {
      ok: true,
      runId: "test-run-4",
      data: {
        message: "Hello from action!",
      },
    };

    renderRawExecutionResult("sample.greet", mockResult, {
      stdout: (msg) => stdoutLogs.push(msg),
      stderr: (msg) => stderrLogs.push(msg),
    });

    expect(stdoutLogs.join("\n")).toBe("Hello from action!");
    expect(stderrLogs.length).toBe(0);
  });

  it("renders text field to stdout when data contains text", () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    const mockResult: ExecutionResult = {
      ok: true,
      runId: "test-run-5",
      data: {
        text: "Some text block",
        code: 200,
      },
    };

    renderRawExecutionResult("test.generate", mockResult, {
      stdout: (msg) => stdoutLogs.push(msg),
      stderr: (msg) => stderrLogs.push(msg),
    });

    expect(stdoutLogs.join("\n")).toBe("Some text block");
    expect(stderrLogs.join("\n")).toContain("code: 200");
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

      expect(stdoutLogs.length).toBe(0);
      expect(stderrLogs.join("\n")).toContain("Error [FILE_NOT_FOUND]: File could not be opened");
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = prevExitCode ?? 0;
    }
  });
});

describe("CLI Action Raw Output Mode - End-to-End Tests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-cli-raw-test-"));
    tempHome = mkdtempSync(join(tmpdir(), "ad-cli-raw-home-"));

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "dir");
    }

    // Initialize package
    const initProc = runCli(["init", "--id", "test.raw-pkg", "--name", "Raw Pkg", "."], tempDir);
    expect(initProc.exitCode).toBe(0);

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
    };
    writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), "utf-8");
  });

  afterEach(async () => {
    if (tempHome && existsSync(tempHome)) {
      try {
        rmSync(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {}
      tempHome = undefined;
    }
    if (existsSync(tempDir)) {
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

  it("outputs unescaped raw content to stdout and metadata to stderr with --raw", () => {
    const proc = runCli(
      ["run", "files.read", "--input", JSON.stringify({ path: "docs/readme.md" }), "--raw"],
      tempDir
    );
    expect(proc.exitCode).toBe(0);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    expect(stdout).toBe("# File Header\n\nBody text line 3\n");
    expect(stderr).toContain("[docs/readme.md | lines 1-3 | hasMore: false]");
  });

  it("outputs raw content with short flag -r", () => {
    const proc = runCli(
      ["run", "files.read", "-i", JSON.stringify({ path: "test.txt" }), "-r"],
      tempDir
    );
    expect(proc.exitCode).toBe(0);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    expect(stdout).toBe("# File Header\n\nBody text line 3\n");
    expect(stderr).toContain("[test.txt | lines 1-3 | hasMore: false]");
  });

  it("works with ad action run --raw", () => {
    const proc = runCli(
      ["action", "run", "files.read", "-i", JSON.stringify({ path: "info.md" }), "--raw"],
      tempDir
    );
    expect(proc.exitCode).toBe(0);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    expect(stdout).toBe("# File Header\n\nBody text line 3\n");
    expect(stderr).toContain("[info.md | lines 1-3 | hasMore: false]");
  });

  it("handles action error properly under --raw mode by writing to stderr", () => {
    const proc = runCli(
      ["run", "files.read", "-i", JSON.stringify({ path: "missing.txt" }), "--raw"],
      tempDir
    );
    expect(proc.exitCode).toBe(1);

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();

    expect(stdout.trim()).toBe("");
    expect(stderr).toContain("Error");
    expect(stderr).toContain("File not found: missing.txt");
  });
});
