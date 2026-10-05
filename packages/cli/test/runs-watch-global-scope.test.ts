import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "@actiondock/core";
import { linkPackage } from "@actiondock/core/registry";
import { runCliAsync } from "./helpers/run-cli";

/**
 * 无本地工程目录下的 watch 归属解析回归用例。
 *
 * 背景：watch 的 requestId 反查与位置参数 runId 解析曾以「当前目录无工程且
 * 无本地链接包」为由直接判定未命中，但全局注册表中已链接的包（~/.actiondock
 * 注册表）仍是可反查作用域，runs list 在同一场景可命中；本组用例锁定该一致性。
 */
describe("CLI runs watch - 无本地工程目录下的全局链接包反查", () => {
  let bareDir: string;
  let tempHome: string;
  let pkgDir: string;

  beforeEach(async () => {
    // 无工程目录：空目录，无工程清单、无本地链接、无 node_modules
    bareDir = mkdtempSync(join(tmpdir(), "actiondock-cli-watch-bare-"));
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-cli-watch-glob-home-"));
    pkgDir = mkdtempSync(join(tmpdir(), "actiondock-cli-watch-glob-pkg-"));
    process.env.ACTIONDOCK_HOME = tempHome;

    // 构造一个最小可执行包并注册到全局链接注册表（模拟 ~/.actiondock 全局链接）
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(pkgDir, "node_modules"), "junction");
      } catch {}
    }
    initProject(pkgDir, { id: "test.watch-glob-pkg", name: "Watch Global Package" });
    const manifestPath = join(pkgDir, "actiondock.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.actions["test.ping"] = {
      entry: "actions/ping.ts",
      description: "Instant ping action",
      inputSchema: {
        type: "object",
        properties: {},
      },
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    mkdirSync(join(pkgDir, "actions"), { recursive: true });
    writeFileSync(
      join(pkgDir, "actions", "ping.ts"),
      [
        'import { defineAction } from "@actiondock/sdk";',
        "",
        "export default defineAction(async () => {",
        '  return { pong: true };',
        "});",
        "",
      ].join("\n")
    );
    await linkPackage(pkgDir, tempHome);
  });

  afterEach(async () => {
    delete process.env.ACTIONDOCK_HOME;
    for (const dir of [bareDir, tempHome, pkgDir]) {
      if (dir && existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch {
          await new Promise((r) => setTimeout(r, 200));
          try {
            rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
          } catch {}
        }
      }
    }
  });

  it("无工程目录下按 requestId 反查全局链接包运行记录命中", { timeout: 60000 }, async () => {
    const requestId = `req-bare-${Date.now()}`;

    // 在链接包目录内以 requestId 派工一次，记录落入全局链接包运行库
    const runRes = await runCliAsync(
      ["run", "test.ping", "--request-id", requestId, "--json"],
      pkgDir
    );
    assert.strictEqual(runRes.exitCode, 0);

    // 回归断言基准：list 在无工程目录下按 requestId 能命中（既有语义）
    const listRes = await runCliAsync(
      ["runs", "list", "--request-id", requestId, "--json"],
      bareDir
    );
    assert.strictEqual(listRes.exitCode, 0);
    const listed = JSON.parse(listRes.stdout.toString());
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(listed[0].requestId, requestId);

    // 核心断言：watch 在同一无工程目录下反查同一 requestId 也必须命中
    const watchRes = await runCliAsync(
      [
        "runs",
        "watch",
        "--request-id",
        requestId,
        "--resolve-timeout",
        "5s",
        "--interval",
        "200ms",
        "--json",
      ],
      bareDir
    );
    assert.strictEqual(watchRes.exitCode, 0);
    const agg = JSON.parse(watchRes.stdout.toString());
    assert.strictEqual(agg.ok, true);
    assert.strictEqual(agg.runs.length, 1);
    assert.strictEqual(agg.runs[0].requestId, requestId);
    assert.strictEqual(agg.runs[0].source, "local");
    assert.strictEqual(agg.runs[0].status, "success");
    assert.deepStrictEqual(agg.runs[0].data, { pong: true });
  });

  it("无工程目录下按位置参数 runId 在全局链接包运行库命中", { timeout: 60000 }, async () => {
    const runRes = await runCliAsync(
      ["run", "test.ping", "--json"],
      pkgDir
    );
    assert.strictEqual(runRes.exitCode, 0);
    const runId = JSON.parse(runRes.stdout.toString()).runId;

    const watchRes = await runCliAsync(
      ["runs", "watch", runId, "--interval", "200ms", "--json"],
      bareDir
    );
    assert.strictEqual(watchRes.exitCode, 0);
    const agg = JSON.parse(watchRes.stdout.toString());
    assert.strictEqual(agg.ok, true);
    assert.strictEqual(agg.runs[0].runId, runId);
    assert.strictEqual(agg.runs[0].source, "local");
    assert.strictEqual(agg.runs[0].status, "success");
  });

  it("无工程目录且无任何链接包时反查仍未命中并报未找到", { timeout: 30000 }, async () => {
    // 独立空 home：既无工程也无全局链接包，保持既有未命中报错语义
    const emptyHome = mkdtempSync(join(tmpdir(), "actiondock-cli-watch-empty-home-"));
    try {
      const watchRes = await runCliAsync(
        [
          "runs",
          "watch",
          "--request-id",
          "req-empty-scope",
          "--resolve-timeout",
          "1s",
          "--interval",
          "200ms",
          "--json",
        ],
        bareDir,
        { ACTIONDOCK_HOME: emptyHome }
      );
      assert.strictEqual(watchRes.exitCode, 1);
      const out = watchRes.stdout.toString() + watchRes.stderr.toString();
      assert.ok(out.includes("req-empty-scope"));
      assert.ok(out.includes("not found"));
    } finally {
      if (existsSync(emptyHome)) {
        rmSync(emptyHome, { recursive: true, force: true });
      }
    }
  });

  it("本地工程目录下未传 --package 时能正常命中当前工程外已链接包的任务与 requestId 反查", { timeout: 60000 }, async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "actiondock-cli-watch-proj-"));
    try {
      const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
      if (existsSync(rootNodeModules)) {
        try {
          symlinkSync(rootNodeModules, join(projectDir, "node_modules"), "junction");
        } catch {}
      }
      initProject(projectDir, { id: "test.current-project", name: "Current Project" });

      const requestId = `req-linked-${Date.now()}`;
      // 在链接包中执行一次任务并记录 requestId
      const runRes = await runCliAsync(
        ["run", "test.ping", "--request-id", requestId, "--json"],
        pkgDir
      );
      assert.strictEqual(runRes.exitCode, 0);
      const runId = JSON.parse(runRes.stdout.toString()).runId;

      // 1. 在当前工程目录下，未传 --package 时按位置参数 runId watch 外部链接包任务
      const watchRunIdRes = await runCliAsync(
        ["runs", "watch", runId, "--interval", "200ms", "--json"],
        projectDir
      );
      assert.strictEqual(watchRunIdRes.exitCode, 0);
      const agg1 = JSON.parse(watchRunIdRes.stdout.toString());
      assert.strictEqual(agg1.ok, true);
      assert.strictEqual(agg1.runs.length, 1);
      assert.strictEqual(agg1.runs[0].runId, runId);
      assert.strictEqual(agg1.runs[0].status, "success");

      // 2. 在当前工程目录下，未传 --package 时按 --request-id 反查外部链接包任务
      const watchReqIdRes = await runCliAsync(
        [
          "runs",
          "watch",
          "--request-id",
          requestId,
          "--resolve-timeout",
          "5s",
          "--interval",
          "200ms",
          "--json",
        ],
        projectDir
      );
      assert.strictEqual(watchReqIdRes.exitCode, 0);
      const agg2 = JSON.parse(watchReqIdRes.stdout.toString());
      assert.strictEqual(agg2.ok, true);
      assert.strictEqual(agg2.runs.length, 1);
      assert.strictEqual(agg2.runs[0].requestId, requestId);
      assert.strictEqual(agg2.runs[0].runId, runId);
      assert.strictEqual(agg2.runs[0].status, "success");

      // 3. 显式指定当前工程包 --package test.current-project 时，因严格隔离在目标包范围内报 not found
      const watchScopedRes = await runCliAsync(
        ["runs", "watch", runId, "--package", "test.current-project", "--interval", "200ms", "--json"],
        projectDir
      );
      assert.strictEqual(watchScopedRes.exitCode, 1);
      const errOut = watchScopedRes.stdout.toString() + watchScopedRes.stderr.toString();
      assert.ok(errOut.includes("not found"));
    } finally {
      if (existsSync(projectDir)) {
        try {
          rmSync(projectDir, { recursive: true, force: true });
        } catch {}
      }
    }
  });
});

