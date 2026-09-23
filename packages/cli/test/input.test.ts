import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
setDefaultTimeout(120000);
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import {
  parseJson,
  readStdin,
  resolveActionInput,
  stripBom,
  buildActionInputAdvice,
  formatActionDetail,
} from "../src/utils/input";
import { ArgumentError } from "../src/errors";
import {
  FlatInputError,
  InputError,
} from "@actiondock/core";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");

let tempHome: string | undefined;

function runCli(
  args: string[],
  cwd?: string,
  stdinInput?: string | Buffer,
  env?: Record<string, string>
) {
  return Bun.spawnSync(["bun", cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}),
      ...env,
    },
    stdin: stdinInput !== undefined ? (Buffer.isBuffer(stdinInput) ? stdinInput : Buffer.from(stdinInput)) : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("CLI Action Input Resolution - Unit Tests", () => {
  it("stripBom removes leading BOM character and preserves clean string", () => {
    expect(stripBom("\uFEFFhello")).toBe("hello");
    expect(stripBom("hello")).toBe("hello");
    expect(stripBom("\uFEFF{\"a\":1}")).toBe("{\"a\":1}");
    expect(stripBom("")).toBe("");
  });

  it("parseJson correctly parses valid JSON objects, arrays, and primitives", () => {
    expect(parseJson("{\"name\":\"Alice\"}", "--input")).toEqual({ name: "Alice" });
    expect(parseJson("[1, 2, 3]", "--input")).toEqual([1, 2, 3]);
    expect(parseJson("\"hello\"", "--input")).toBe("hello");
    expect(parseJson("123", "--input")).toBe(123);
    expect(parseJson("true", "--input")).toBe(true);
    expect(parseJson("\uFEFF{\"name\":\"WithBOM\"}", "--input")).toEqual({ name: "WithBOM" });
  });

  it("parseJson throws InputError with INVALID_JSON code on invalid JSON", () => {
    expect(() => parseJson("{bad json}", "--input")).toThrow(InputError);
    try {
      parseJson("{bad json}", "--input");
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err.code).toBe("INVALID_JSON");
      expect(err.message).toContain("Invalid JSON input from --input");
    }

    try {
      parseJson("", "input.json");
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err.code).toBe("INVALID_JSON");
      expect(err.message).toContain("Invalid JSON input from input.json");
    }
  });

  it("parseJson throws InputError with INVALID_JSON on 1e400 (Infinity) or deep structure", () => {
    expect(() => parseJson("1e400", "--input")).toThrow(InputError);
    try {
      parseJson("1e400", "--input");
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err.code).toBe("INVALID_JSON");
      expect(err.message).toContain("Number is non-finite or NaN");
    }

    let deep = "1";
    for (let i = 0; i < 260; i++) {
      deep = `{"inner":${deep}}`;
    }
    expect(() => parseJson(deep, "--input")).toThrow(InputError);
    try {
      parseJson(deep, "--input");
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err.code).toBe("INVALID_JSON");
      expect(err.message).toContain("Max JSON depth limit");
    }
  });

  it("readStdin reads full stream content", async () => {
    const stream = Readable.from(["hello ", "world"]);
    const text = await readStdin(stream);
    expect(text).toBe("hello world");
  });

  it("resolveActionInput returns {} when neither input nor inputFile is provided", async () => {
    const res = await resolveActionInput({});
    expect(res).toEqual({});
  });

  it("resolveActionInput throws INPUT_CONFLICT when both input and inputFile are specified", async () => {
    try {
      await resolveActionInput({ input: "{\"a\":1}", inputFile: "test.json" });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err).not.toBeInstanceOf(FlatInputError);
      expect(err.code).toBe("INPUT_CONFLICT");
      expect(err.message).toContain("mutually exclusive");
    }
  });

  it("resolveActionInput parses inline JSON", async () => {
    const res = await resolveActionInput({ input: "{\"name\":\"Test\"}" });
    expect(res).toEqual({ name: "Test" });
  });

  it("resolveActionInput reads and parses from stdin when inputFile is '-'", async () => {
    const stream = Readable.from(["{\"from\":\"stdin\"}"]);
    const res = await resolveActionInput({ inputFile: "-", stdin: stream });
    expect(res).toEqual({ from: "stdin" });
  });

  it("resolveActionInput throws INPUT_FILE_NOT_FOUND when file does not exist", async () => {
    try {
      await resolveActionInput({ inputFile: "nonexistent_file_12345.json" });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err).not.toBeInstanceOf(FlatInputError);
      expect(err.code).toBe("INPUT_FILE_NOT_FOUND");
      expect(err.message).toBe("Input file not found: nonexistent_file_12345.json");
    }
  });

  it("resolveActionInput throws INPUT_FILE_READ_FAILED when reading file fails", async () => {
    try {
      await resolveActionInput({ inputFile: tmpdir() });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err).not.toBeInstanceOf(FlatInputError);
      expect(err.code).toBe("INPUT_FILE_READ_FAILED");
    }
  });

  it("verifies InputError and FlatInputError inheritance", () => {
    const baseErr = new InputError("TEST_CODE", "test message");
    expect(baseErr).toBeInstanceOf(InputError);
    expect(baseErr).not.toBeInstanceOf(FlatInputError);

    const flatErr = new FlatInputError("FLAT_CODE", "flat message");
    expect(flatErr).toBeInstanceOf(FlatInputError);
    expect(flatErr).toBeInstanceOf(InputError);
  });
});

describe("CLI Action Input Resolution - End-to-End Regression", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-cli-input-test-"));
    tempHome = mkdtempSync(join(tmpdir(), "ad-cli-input-home-"));

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "dir");
    }

    // Initialize project
    const initProc = runCli(["init", "--id", "test.input-pkg", "--name", "Input Pkg", "."], tempDir);
    expect(initProc.exitCode).toBe(0);

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

  // 1. --input 正常 JSON
  it("executes action with valid inline JSON via --input", () => {
    const proc = runCli(["run", "test.echo", "--input", "{\"name\":\"Alice\",\"age\":30}", "--json"], tempDir);
    expect(proc.exitCode).toBe(0);
    const res = JSON.parse(proc.stdout.toString());
    expect(res.ok).toBe(true);
    expect(res.data.received).toEqual({ name: "Alice", age: 30 });
  });

  // 2. --input-file 正常文件
  it("executes action with valid file JSON via --input-file", () => {
    const filePath = join(tempDir, "valid-input.json");
    writeFileSync(filePath, JSON.stringify({ project: "ActionDock", stars: 100 }), "utf-8");

    const proc = runCli(["run", "test.echo", "--input-file", filePath, "--json"], tempDir);
    expect(proc.exitCode).toBe(0);
    const res = JSON.parse(proc.stdout.toString());
    expect(res.ok).toBe(true);
    expect(res.data.received).toEqual({ project: "ActionDock", stars: 100 });
  });

  // 3. --input-file - stdin
  it("executes action reading JSON from stdin via --input-file -", () => {
    const stdinPayload = JSON.stringify({ mode: "streamed", count: 99 });
    const proc = runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, stdinPayload);
    expect(proc.exitCode).toBe(0);
    const res = JSON.parse(proc.stdout.toString());
    expect(res.ok).toBe(true);
    expect(res.data.received).toEqual({ mode: "streamed", count: 99 });
  });

  // 4. 无输入默认 {}
  it("executes action with default empty object {} when no input is provided", () => {
    const proc = runCli(["run", "test.echo", "--json"], tempDir);
    expect(proc.exitCode).toBe(0);
    const res = JSON.parse(proc.stdout.toString());
    expect(res.ok).toBe(true);
    expect(res.data.received).toEqual({});
  });

  // 5. --input 与 --input-file 冲突
  it("rejects when both --input and --input-file are provided with exit code 2", () => {
    const filePath = join(tempDir, "input.json");
    writeFileSync(filePath, "{}", "utf-8");

    // Human mode
    const proc = runCli(["run", "test.echo", "--input", "{\"a\":1}", "--input-file", filePath], tempDir);
    expect(proc.exitCode).toBe(2);
    expect(proc.stderr.toString()).toContain("mutually exclusive");

    // Machine mode (--json)
    const procJson = runCli(["run", "test.echo", "--input", "{\"a\":1}", "--input-file", filePath, "--json"], tempDir);
    expect(procJson.exitCode).toBe(2);
    const res = JSON.parse(procJson.stdout.toString());
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("INPUT_CONFLICT");
    expect(res.error.message).toContain("mutually exclusive");
  });

  // 6. 非法 inline JSON
  it("rejects invalid inline JSON with exit code 2 and INVALID_JSON code", () => {
    const proc = runCli(["run", "test.echo", "--input", "{\"invalid\":", "--json"], tempDir);
    expect(proc.exitCode).toBe(2);
    const res = JSON.parse(proc.stdout.toString());
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("INVALID_JSON");
    expect(res.error.message).toContain("Invalid JSON input from --input");
  });

  // 7. 非法文件 JSON
  it("rejects invalid JSON file with exit code 2 and INVALID_JSON code", () => {
    const filePath = join(tempDir, "bad.json");
    writeFileSync(filePath, "{\ninvalid json here\n", "utf-8");

    const proc = runCli(["run", "test.echo", "--input-file", filePath, "--json"], tempDir);
    expect(proc.exitCode).toBe(2);
    const res = JSON.parse(proc.stdout.toString());
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("INVALID_JSON");
    expect(res.error.message).toContain(`Invalid JSON input from ${filePath}`);
  });

  // 8. 非法 stdin JSON
  it("rejects invalid JSON from stdin with exit code 2 and INVALID_JSON code", () => {
    const proc = runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, "{not json}");
    expect(proc.exitCode).toBe(2);
    const res = JSON.parse(proc.stdout.toString());
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("INVALID_JSON");
    expect(res.error.message).toContain("Invalid JSON input from stdin");
  });

  // 9. 文件不存在
  it("rejects nonexistent input file with exit code 2 and INPUT_FILE_NOT_FOUND code", () => {
    const missingPath = join(tempDir, "does-not-exist.json");
    const proc = runCli(["run", "test.echo", "--input-file", missingPath, "--json"], tempDir);
    expect(proc.exitCode).toBe(2);
    const res = JSON.parse(proc.stdout.toString());
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("INPUT_FILE_NOT_FOUND");
    expect(res.error.message).toContain(`Input file not found: ${missingPath}`);
  });

  // 10. UTF-8 BOM
  it("strips UTF-8 BOM correctly from both file and stdin", () => {
    // BOM in file
    const bomFilePath = join(tempDir, "bom.json");
    writeFileSync(bomFilePath, "\uFEFF{\"source\":\"bom-file\",\"active\":true}", "utf-8");
    const fileProc = runCli(["run", "test.echo", "--input-file", bomFilePath, "--json"], tempDir);
    expect(fileProc.exitCode).toBe(0);
    const fileRes = JSON.parse(fileProc.stdout.toString());
    expect(fileRes.ok).toBe(true);
    expect(fileRes.data.received).toEqual({ source: "bom-file", active: true });

    // BOM in stdin
    const bomStdin = "\uFEFF{\"source\":\"bom-stdin\",\"active\":false}";
    const stdinProc = runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, bomStdin);
    expect(stdinProc.exitCode).toBe(0);
    const stdinRes = JSON.parse(stdinProc.stdout.toString());
    expect(stdinRes.ok).toBe(true);
    expect(stdinRes.data.received).toEqual({ source: "bom-stdin", active: false });
  });

  // 11. 多行 JSON
  it("correctly parses multi-line formatted JSON from file and stdin", () => {
    const multilineJson = `{\n  "title": "multi-line",\n  "nested": {\n    "items": [\n      1,\n      2,\n      3\n    ]\n  }\n}`;
    const filePath = join(tempDir, "multiline.json");
    writeFileSync(filePath, multilineJson, "utf-8");

    const fileProc = runCli(["run", "test.echo", "--input-file", filePath, "--json"], tempDir);
    expect(fileProc.exitCode).toBe(0);
    const fileRes = JSON.parse(fileProc.stdout.toString());
    expect(fileRes.ok).toBe(true);
    expect(fileRes.data.received.nested.items).toEqual([1, 2, 3]);

    const stdinProc = runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, multilineJson);
    expect(stdinProc.exitCode).toBe(0);
    const stdinRes = JSON.parse(stdinProc.stdout.toString());
    expect(stdinRes.ok).toBe(true);
    expect(stdinRes.data.received.title).toBe("multi-line");
  });

  // 12. JSON 中包含双引号、反斜杠、换行
  it("correctly handles quotes, backslashes, and escaped newlines inside JSON values", () => {
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
    const fileProc = runCli(["run", "test.echo", "--input-file", filePath, "--json"], tempDir);
    expect(fileProc.exitCode).toBe(0);
    const fileRes = JSON.parse(fileProc.stdout.toString());
    expect(fileRes.data.received).toEqual(complexPayload);

    // Test stdin input
    const stdinProc = runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, jsonStr);
    expect(stdinProc.exitCode).toBe(0);
    const stdinRes = JSON.parse(stdinProc.stdout.toString());
    expect(stdinRes.data.received).toEqual(complexPayload);
  });

  // 13. 空文件
  it("rejects empty file with exit code 2 and INVALID_JSON error", () => {
    const emptyFile = join(tempDir, "empty.json");
    writeFileSync(emptyFile, "", "utf-8");

    const proc = runCli(["run", "test.echo", "--input-file", emptyFile, "--json"], tempDir);
    expect(proc.exitCode).toBe(2);
    const res = JSON.parse(proc.stdout.toString());
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("INVALID_JSON");
    expect(res.error.message).toContain(`Invalid JSON input from ${emptyFile}`);
  });

  // 14. 空 stdin
  it("rejects empty stdin with exit code 2 and INVALID_JSON error", () => {
    const proc = runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, "");
    expect(proc.exitCode).toBe(2);
    const res = JSON.parse(proc.stdout.toString());
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("INVALID_JSON");
    expect(res.error.message).toContain("Invalid JSON input from stdin");
  });

  // 15. PowerShell 调用
  it("supports PowerShell pipe invocation when pwsh / powershell is available", () => {
    const pwshBin = Bun.which("pwsh") || Bun.which("powershell");
    if (!pwshBin) {
      // If PowerShell is not installed in the environment, test child process piped simulation
      const pipedData = JSON.stringify({ powerShell: true, author: "PowerShellSimulated" });
      const proc = runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, pipedData);
      expect(proc.exitCode).toBe(0);
      const res = JSON.parse(proc.stdout.toString());
      expect(res.ok).toBe(true);
      expect(res.data.received.author).toBe("PowerShellSimulated");
      return;
    }

    const command = `$data = @{ powerShell = $true; author = 'PowerShellUser' }; $data | ConvertTo-Json -Compress | node "${cliPath}" run test.echo --input-file - --json`;
    const res = spawnSync(pwshBin, ["-NoProfile", "-NonInteractive", "-Command", command], {
      cwd: tempDir,
      env: { ...process.env, ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}) },
      encoding: "utf-8",
    });
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.received.author).toBe("PowerShellUser");
  });

  // 16. cmd.exe 调用
  it("supports cmd.exe invocation when cmd is available", () => {
    const cmdBin = Bun.which("cmd.exe") || Bun.which("cmd");
    if (!cmdBin || process.platform !== "win32") {
      // If cmd.exe is not available (e.g. on Linux), verify pipe simulation behavior
      const cmdData = JSON.stringify({ cmd: true, author: "CmdSimulated" });
      const proc = runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, cmdData);
      expect(proc.exitCode).toBe(0);
      const res = JSON.parse(proc.stdout.toString());
      expect(res.ok).toBe(true);
      expect(res.data.received.author).toBe("CmdSimulated");
      return;
    }

    const inputPath = join(tempDir, "cmd-input.json");
    writeFileSync(inputPath, JSON.stringify({ cmd: true, author: "CmdUser" }), "utf-8");
    const cmdCommand = `type "${inputPath}" | node "${cliPath}" run test.echo --input-file - --json`;
    const res = spawnSync(cmdBin, ["/d", "/s", "/c", `"${cmdCommand}"`], {
      cwd: tempDir,
      env: { ...process.env, ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}) },
      encoding: "utf-8",
      windowsVerbatimArguments: true,
    });
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.received.author).toBe("CmdUser");
  });

  // 17. Bash / zsh 调用
  it("supports Bash and zsh pipe and inline JSON invocations", () => {
    if (process.platform === "win32") {
      // Bash and zsh are POSIX shells; on Windows verify pipe simulation behavior
      const shellData = JSON.stringify({ fromShell: true, simulated: true });
      const proc = runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, shellData);
      expect(proc.exitCode).toBe(0);
      const res = JSON.parse(proc.stdout.toString());
      expect(res.ok).toBe(true);
      expect(res.data.received.fromShell).toBe(true);
      return;
    }

    const bashBin = Bun.which("bash");
    const zshBin = Bun.which("zsh");

    if (!bashBin && !zshBin) {
      const shellData = JSON.stringify({ fromShell: true, simulated: true });
      const proc = runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, shellData);
      expect(proc.exitCode).toBe(0);
      const res = JSON.parse(proc.stdout.toString());
      expect(res.ok).toBe(true);
      expect(res.data.received.fromShell).toBe(true);
      return;
    }

    const inputPath = join(tempDir, "shell-input.json");
    writeFileSync(inputPath, JSON.stringify({ fromShell: true }), "utf-8");

    if (bashBin) {
      // Inline JSON in Bash
      const inlineCmd = `node "${cliPath}" run test.echo --input '{"shell":"bash-inline"}' --json`;
      const bashInlineRes = spawnSync(bashBin, ["-c", inlineCmd], {
        cwd: tempDir,
        env: { ...process.env, ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}) },
        encoding: "utf-8",
      });
      expect(bashInlineRes.status).toBe(0);
      const parsedInline = JSON.parse(bashInlineRes.stdout);
      expect(parsedInline.ok).toBe(true);
      expect(parsedInline.data.received.shell).toBe("bash-inline");

      // Stdin pipe in Bash
      const pipeCmd = `cat "${inputPath}" | node "${cliPath}" run test.echo --input-file - --json`;
      const bashPipeRes = spawnSync(bashBin, ["-c", pipeCmd], {
        cwd: tempDir,
        env: { ...process.env, ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}) },
        encoding: "utf-8",
      });
      expect(bashPipeRes.status).toBe(0);
      const parsedPipe = JSON.parse(bashPipeRes.stdout);
      expect(parsedPipe.ok).toBe(true);
      expect(parsedPipe.data.received.fromShell).toBe(true);
    }

    if (zshBin) {
      // Inline JSON in Zsh
      const inlineCmd = `node "${cliPath}" run test.echo --input '{"shell":"zsh-inline"}' --json`;
      const zshInlineRes = spawnSync(zshBin, ["-c", inlineCmd], {
        cwd: tempDir,
        env: { ...process.env, ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}) },
        encoding: "utf-8",
      });
      expect(zshInlineRes.status).toBe(0);
      const parsedInline = JSON.parse(zshInlineRes.stdout);
      expect(parsedInline.ok).toBe(true);
      expect(parsedInline.data.received.shell).toBe("zsh-inline");

      // Stdin pipe in Zsh
      const pipeCmd = `cat "${inputPath}" | node "${cliPath}" run test.echo --input-file - --json`;
      const zshPipeRes = spawnSync(zshBin, ["-c", pipeCmd], {
        cwd: tempDir,
        env: { ...process.env, ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}) },
        encoding: "utf-8",
      });
      expect(zshPipeRes.status).toBe(0);
      const parsedPipe = JSON.parse(zshPipeRes.stdout);
      expect(parsedPipe.ok).toBe(true);
      expect(parsedPipe.data.received.fromShell).toBe(true);
    }
  });

  // 18. Flat JsonValue Encoding v1: 通过 -- 传递字符串赋值、JSON 赋值、嵌套对象、数字索引数组
  it("executes action with flat arguments via -- supporting =, :=, nested objects, and indexed arrays", () => {
    const proc = runCli(
      [
        "run",
        "test.echo",
        "--json",
        "--",
        "str=hello",
        "num:=123",
        "bool:=true",
        "arr:=[1,2]",
        "user.name=Alice",
        "user.age:=30",
        "items.0=first",
        "items.1=second",
      ],
      tempDir
    );
    expect(proc.exitCode).toBe(0);
    const res = JSON.parse(proc.stdout.toString());
    expect(res.ok).toBe(true);
    expect(res.data.received).toEqual({
      str: "hello",
      num: 123,
      bool: true,
      arr: [1, 2],
      user: {
        name: "Alice",
        age: 30,
      },
      items: ["first", "second"],
    });
  });

  // 19. Flat 参数与 --input 冲突返回退出码 2 及结构化错误
  it("rejects when both flat args (via --) and --input are provided with exit code 2 and INPUT_CONFLICT", () => {
    const proc = runCli(
      ["run", "test.echo", "--input", '{"a":1}', "--json", "--", "b=2"],
      tempDir
    );
    expect(proc.exitCode).toBe(2);
    const res = JSON.parse(proc.stdout.toString());
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("INPUT_CONFLICT");
    expect(res.error.message).toContain("mutually exclusive");
  });

  // 20. Flat 参数与 --input-file 冲突返回退出码 2 及结构化错误
  it("rejects when both flat args (via --) and --input-file are provided with exit code 2 and INPUT_CONFLICT", () => {
    const filePath = join(tempDir, "input.json");
    writeFileSync(filePath, "{}", "utf-8");

    const proc = runCli(
      ["run", "test.echo", "--input-file", filePath, "--json", "--", "b=2"],
      tempDir
    );
    expect(proc.exitCode).toBe(2);
    const res = JSON.parse(proc.stdout.toString());
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("INPUT_CONFLICT");
    expect(res.error.message).toContain("mutually exclusive");
  });

  // 21. 非法 Flat 参数在 --json 模式下返回正确的错误信封
  it("rejects invalid JSON literal in flat args with exit code 2 and INVALID_JSON_LITERAL", () => {
    const proc = runCli(
      ["run", "test.echo", "--json", "--", "num:=invalid_json"],
      tempDir
    );
    expect(proc.exitCode).toBe(2);
    const res = JSON.parse(proc.stdout.toString());
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("INVALID_JSON_LITERAL");
  });

  it("rejects invalid path in flat args with exit code 2 and INVALID_FLAT_ARGUMENT", () => {
    const proc = runCli(
      ["run", "test.echo", "--json", "--", "bad..path=1"],
      tempDir
    );
    expect(proc.exitCode).toBe(2);
    const res = JSON.parse(proc.stdout.toString());
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("INVALID_FLAT_ARGUMENT");
  });

  it("rejects path conflict in flat args with exit code 2 and INPUT_PATH_CONFLICT", () => {
    const proc = runCli(
      ["run", "test.echo", "--json", "--", "a=1", "a.b=2"],
      tempDir
    );
    expect(proc.exitCode).toBe(2);
    const res = JSON.parse(proc.stdout.toString());
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("INPUT_PATH_CONFLICT");
  });

  // 22. --input '1e400' 抛出 INVALID_JSON
  it("rejects --input '1e400' (Infinity) with exit code 2 and INVALID_JSON code", () => {
    const proc = runCli(["run", "test.echo", "--input", "1e400", "--json"], tempDir);
    expect(proc.exitCode).toBe(2);
    const res = JSON.parse(proc.stdout.toString());
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("INVALID_JSON");
    expect(res.error.message).toContain("Number is non-finite or NaN");
  });

  // 23. 含有非 flat-safe required 字段时 flatSupported 为 false
  it("marks flatSupported as false when required field contains non-flat-safe characters", () => {
    const advice = buildActionInputAdvice({
      type: "object",
      properties: {
        "user name": { type: "string" },
        age: { type: "number" },
      },
      required: ["user name"],
    });
    expect(advice.flatSupported).toBe(false);
    expect(advice.hasFlatFields).toBe(true);
    expect(advice.notes.some((n) => n.includes("user name"))).toBe(true);
  });

  // 24. 展示扁平推荐模式与建议赋值操作符
  it("generates action detail advice with recommended mode and assignments", () => {
    const formatted = formatActionDetail({
      id: "test.echo",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          count: { type: "number" },
          meta: { type: "object" },
        },
        required: ["name", "count"],
      },
    });
    expect(formatted).toContain("Action: test.echo");
    expect(formatted).toContain("Recommended Input: flat");
    expect(formatted).toContain("Assignments:");
    expect(formatted).toContain("  name=");
    expect(formatted).toContain("  count:=");
    expect(formatted).toContain("  meta:=");
  });
});
