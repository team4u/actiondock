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

  it("显式设置 ACTIONDOCK_SILENCE_WARNINGS=0 时应保留实验性警告（逃生通道）", () => {
    const code = `
      import "./packages/core/dist/utils/warning.js";
      process.emitWarning("Explicit experimental check", "ExperimentalWarning");
    `;

    const res = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: process.cwd(),
      encoding: "utf-8",
      env: { ...process.env, ACTIONDOCK_SILENCE_WARNINGS: "0" },
    });

    assert.strictEqual(res.status, 0);
    assert.ok(
      res.stderr.includes("ExperimentalWarning"),
      `stderr should retain ExperimentalWarning when disabled, got: ${res.stderr}`
    );
  });

  it("支持通过 @actiondock/core 根导出引入 suppressExperimentalWarnings", () => {
    const code = `
      import { suppressExperimentalWarnings } from "./packages/core/dist/index.js";
      suppressExperimentalWarnings();
      process.emitWarning("Root export check", "ExperimentalWarning");
    `;

    const res = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });

    assert.strictEqual(res.status, 0);
    assert.ok(
      !res.stderr.includes("ExperimentalWarning"),
      `stderr should not contain ExperimentalWarning, got: ${res.stderr}`
    );
  });

  it("CLI 入口 bin/ad.js 启动时基于单一事实源拦截实验性警告", () => {
    const res = spawnSync(process.execPath, ["packages/cli/bin/ad.js", "--version"], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });

    assert.strictEqual(res.status, 0);
    assert.ok(
      !res.stderr.includes("ExperimentalWarning"),
      `ad.js stderr should not contain ExperimentalWarning, got: ${res.stderr}`
    );
  });

  it("CLI 入口 bin/ad.js 尊崇 ACTIONDOCK_SILENCE_WARNINGS=0 逃生通道", () => {
    // 注入并触发警告的临时包装脚本，验证 ad.js 启动链路上的逃生通道
    const code = `
      await import("./packages/cli/bin/ad.js");
      process.emitWarning("Ad escape check", "ExperimentalWarning");
    `;

    const res = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: process.cwd(),
      encoding: "utf-8",
      env: { ...process.env, ACTIONDOCK_SILENCE_WARNINGS: "0" },
    });

    assert.ok(
      res.stderr.includes("ExperimentalWarning"),
      `ad.js should retain ExperimentalWarning when disabled via escape hatch, got: ${res.stderr}`
    );
  });
});


