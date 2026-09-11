import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "@actiondock/core";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");

function runCli(args: string[], cwd?: string) {
  return Bun.spawnSync(["bun", cliPath, ...args], {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("CLI ad validate 本地相对依赖完整性校验", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-validate-deps-"));
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "dir");
    }
    initProject(tempDir, {
      id: "test.validate-deps",
      name: "Validate Deps Package",
    });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {}
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
    expect(res.exitCode).not.toBe(0);
    const stderr = res.stderr.toString();
    const stdout = res.stdout.toString();
    const output = stdout + "\n" + stderr;
    expect(output).toContain("Action dependency integrity validation failed");
    expect(output).toContain("src/helper.js");
    expect(output).toContain("files");

    // 在 actiondock.json 中声明 files 后，再次 validate 应成功
    const configPath = join(tempDir, "actiondock.json");
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    raw.files = ["src"];
    writeFileSync(configPath, JSON.stringify(raw, null, 2));

    const res2 = runCli(["validate"], tempDir);
    expect(res2.exitCode).toBe(0);
  });
});
