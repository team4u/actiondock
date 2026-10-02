import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  formatActionDetail,
} from "../src/utils/input";

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

describe("CLI Action Input Resolution - Flat Arguments and Advice", () => {
  let tempDir: string;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-cli-input-flat-test-"));
    tempHome = mkdtempSync(join(tmpdir(), "ad-cli-input-flat-home-"));

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

  // 18. Flat JsonValue Encoding v1: 通过 -- 传递字符串赋值、JSON 赋值、嵌套对象、数字索引数组
  it("executes action with flat arguments via -- supporting =, :=, nested objects, and indexed arrays", async () => {
    const proc = await runCli(
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
    assert.strictEqual(proc.exitCode, 0);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.data.received, {
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
  it("rejects when both flat args (via --) and --input are provided with exit code 2 and INPUT_CONFLICT", async () => {
    const proc = await runCli(
      ["run", "test.echo", "--input", '{"a":1}', "--json", "--", "b=2"],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 2);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, "INPUT_CONFLICT");
    assert.ok((res.error.message).includes("mutually exclusive"));
  });

  // 20. Flat 参数与 --input-file 冲突返回退出码 2 及结构化错误
  it("rejects when both flat args (via --) and --input-file are provided with exit code 2 and INPUT_CONFLICT", async () => {
    const filePath = join(tempDir, "input.json");
    writeFileSync(filePath, "{}", "utf-8");

    const proc = await runCli(
      ["run", "test.echo", "--input-file", filePath, "--json", "--", "b=2"],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 2);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, "INPUT_CONFLICT");
    assert.ok((res.error.message).includes("mutually exclusive"));
  });

  // 21. 非法 Flat 参数在 --json 模式下返回正确的错误信封
  it("rejects invalid JSON literal in flat args with exit code 2 and INVALID_JSON_LITERAL", async () => {
    const proc = await runCli(
      ["run", "test.echo", "--json", "--", "num:=invalid_json"],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 2);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, "INVALID_JSON_LITERAL");
  });

  it("rejects invalid path in flat args with exit code 2 and INVALID_FLAT_ARGUMENT", async () => {
    const proc = await runCli(
      ["run", "test.echo", "--json", "--", "bad..path=1"],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 2);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, "INVALID_FLAT_ARGUMENT");
  });

  it("rejects path conflict in flat args with exit code 2 and INPUT_PATH_CONFLICT", async () => {
    const proc = await runCli(
      ["run", "test.echo", "--json", "--", "a=1", "a.b=2"],
      tempDir
    );
    assert.strictEqual(proc.exitCode, 2);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, "INPUT_PATH_CONFLICT");
  });

  // 22. --input '1e400' 抛出 INVALID_JSON
  it("rejects --input '1e400' (Infinity) with exit code 2 and INVALID_JSON code", async () => {
    const proc = await runCli(["run", "test.echo", "--input", "1e400", "--json"], tempDir);
    assert.strictEqual(proc.exitCode, 2);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, "INVALID_JSON");
    assert.ok((res.error.message).includes("Number is non-finite or NaN"));
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
    assert.ok((formatted).includes("Action: test.echo"));
    assert.ok((formatted).includes("Recommended Input: flat"));
    assert.ok((formatted).includes("Assignments:"));
    assert.ok((formatted).includes("  name="));
    assert.ok((formatted).includes("  count:="));
    assert.ok((formatted).includes("  meta:="));
    assert.ok((formatted).includes("Syntax Reference:"));
    assert.ok((formatted).includes('key="value"'));
    assert.ok((formatted).includes("count:=10  enabled:=true"));
    assert.ok((formatted).includes('tags:=\'["a", "b"]\' (or tags.0="a" tags.1="b")'));
    assert.ok((formatted).includes("--input-file input.json"));
  });
});
