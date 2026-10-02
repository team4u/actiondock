import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { suppressExperimentalWarnings } from "../src/utils/warning";

describe("ExperimentalWarning 全局静默机制", () => {
  it("suppressExperimentalWarnings 函数应保持幂等性", () => {
    assert.doesNotThrow(() => {
      suppressExperimentalWarnings();
      suppressExperimentalWarnings();
    });
  });

  it("子进程加载已编译的 SQLite 驱动时不输出任何实验性警告", () => {
    // 启动裸 Node 子进程，测试引入编译后模块并执行时 stderr 保持干净
    const code = `
      import { NodeSqliteDriver } from "./packages/core/dist/storage/sqlite-driver.js";
      const driver = new NodeSqliteDriver(":memory:");
      driver.exec("CREATE TABLE test (id INTEGER PRIMARY KEY);");
      process.emitWarning("Arbitrary experimental feature", "ExperimentalWarning");
    `;

    const res = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });

    assert.strictEqual(res.status, 0, `Subprocess failed: ${res.stderr}`);
    assert.ok(
      !res.stderr.includes("ExperimentalWarning"),
      `stderr should not contain ExperimentalWarning, got: ${res.stderr}`
    );
  });

  it("子进程加载 warning.js 模块后非 ExperimentalWarning 警告应正常透传保留", () => {
    const code = `
      import "./packages/core/dist/utils/warning.js";
      process.emitWarning("This is a deprecation warning", "DeprecationWarning");
      process.emitWarning("This is an experimental warning", "ExperimentalWarning");
    `;

    const res = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });

    assert.strictEqual(res.status, 0);
    assert.ok(
      res.stderr.includes("DeprecationWarning"),
      `stderr should retain DeprecationWarning, got: ${res.stderr}`
    );
    assert.ok(
      !res.stderr.includes("ExperimentalWarning"),
      `stderr should not contain ExperimentalWarning, got: ${res.stderr}`
    );
  });
});
