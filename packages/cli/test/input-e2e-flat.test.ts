import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
setDefaultTimeout(120000);
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildActionInputAdvice,
  formatActionDetail,
} from "../src/utils/input";

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

describe("CLI Action Input Resolution - Flat Arguments and Advice", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-cli-input-flat-test-"));
    tempHome = mkdtempSync(join(tmpdir(), "ad-cli-input-flat-home-"));

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "dir");
      } catch {}
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

  afterAll(async () => {
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
