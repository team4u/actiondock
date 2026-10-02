import { runCommandSync, whichExecutable } from "../../../scripts/lib/spawn-helper.mjs";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  initProject,
} from "@actiondock/core";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");

function runCli(args: string[], cwd?: string) {
  return runCommandSync(["bun", cliPath, ...args], {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("CLI ad validate 本地相对依赖完整性校验", () => {
  let tempDir: string;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-validate-deps-"));
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
      } catch {}
    }
    initProject(tempDir, {
      id: "test.validate-deps",
      name: "Validate Deps Package",
    });
  });

  after(async () => {
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

  it("当 Action 引用未在 files 中声明的本地代码模块时 ad validate 报错阻断", () => {
    // 创建 src/helper.js
    const srcDir = join(tempDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "helper.js"), "export const calc = (x) => x * 2;\n");

    // 修改 actions/greet.ts 引入 ../src/helper.js
    const actionPath = join(tempDir, "actions", "greet.ts");
    writeFileSync(
      actionPath,
      `import { defineAction } from "@actiondock/sdk";
import { calc } from "../src/helper.js";

export default defineAction(async () => {
  return { res: calc(21) };
});
`
    );

    // 执行 ad validate
    const res = runCli(["validate"], tempDir);
    assert.notStrictEqual(res.exitCode, 0);
    const stderr = res.stderr.toString();
    const stdout = res.stdout.toString();
    const output = stdout + "\n" + stderr;
    assert.ok((output).includes("Action dependency integrity validation failed"));
    assert.ok((output).includes("src/helper.js"));
    assert.ok((output).includes("files"));

    // 在 actiondock.json 中声明 files 后，再次 validate 应成功
    const configPath = join(tempDir, "actiondock.json");
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    raw.files = ["src"];
    writeFileSync(configPath, JSON.stringify(raw, null, 2));

    const res2 = runCli(["validate"], tempDir);
    assert.strictEqual(res2.exitCode, 0);
  });
});
