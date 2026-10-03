import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "@actiondock/core";
import { createStorage } from "@actiondock/core/package";
import { runCliAsync } from "./helpers/run-cli";

describe("CLI Readonly Query - Preserve Running Runs", () => {
  let tempDir: string;
  let tempHome: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-test-query-"));
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-test-query-home-"));
    process.env.ACTIONDOCK_HOME = tempHome;

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
      } catch {}
    }
    initProject(tempDir, { id: "test.query-pkg", name: "Query Test Package" });
  });

  afterEach(async () => {
    delete process.env.ACTIONDOCK_HOME;
    if (tempHome && existsSync(tempHome)) {
      try {
        rmSync(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {}
    }
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {}
    }
  });

  it("ensures read-only query commands do not harvest running run records into interrupted", async () => {
    // 写入一条状态为 running 的在途运行记录
    const storage = createStorage("test.query-pkg", {
      customHome: tempHome,
      projectRoot: tempDir,
      recoverOrphans: false,
    });
    const now = new Date().toISOString();
    const runId = "run-active-123";
    storage.createRun({
      id: runId,
      packageId: "test.query-pkg",
      actionId: "sample.greet",
      status: "running",
      startedAt: now,
      rootRunId: runId,
      packageInstanceId: "pkg-inst",
      generationId: "gen-1",
      ownerId: "owner-1",
    });

    const before = storage.getRun(runId);
    assert.strictEqual(before?.status, "running");
    await storage.close();

    // 执行一系列只读查询命令
    const listRes = await runCliAsync(["runs", "list", "--json"], tempDir);
    assert.strictEqual(listRes.exitCode, 0);
    const runsList = JSON.parse(listRes.stdout.toString());
    assert.strictEqual(runsList.length, 1);
    assert.strictEqual(runsList[0].id, runId);
    assert.strictEqual(runsList[0].status, "running");

    const showRes = await runCliAsync(["runs", "show", runId, "--json"], tempDir);
    assert.strictEqual(showRes.exitCode, 0);
    const runDetail = JSON.parse(showRes.stdout.toString());
    assert.strictEqual(runDetail.id, runId);
    assert.strictEqual(runDetail.status, "running");

    const infoRes = await runCliAsync(["info", "--json"], tempDir);
    assert.strictEqual(infoRes.exitCode, 0);

    const descRes = await runCliAsync(["describe", "sample.greet", "--json"], tempDir);
    assert.strictEqual(descRes.exitCode, 0);

    const stateListRes = await runCliAsync(["state", "list", "--json"], tempDir);
    assert.strictEqual(stateListRes.exitCode, 0);

    const configListRes = await runCliAsync(["config", "list", "--json"], tempDir);
    assert.strictEqual(configListRes.exitCode, 0);

    // 重新打开存储，确认运行记录依然保持为 running，未被篡改为 interrupted
    const checkStorage = createStorage("test.query-pkg", {
      customHome: tempHome,
      projectRoot: tempDir,
      recoverOrphans: false,
    });
    const after = checkStorage.getRun(runId);
    assert.notStrictEqual(after, null);
    assert.strictEqual(after?.status, "running");
    await checkStorage.close();
  });

  it("ensures execution commands with ownDataDir harvest dead orphan runs into interrupted", async () => {
    // 写入一条状态为 running 的遗留死会话运行记录
    const storage = createStorage("test.query-pkg", {
      customHome: tempHome,
      projectRoot: tempDir,
      recoverOrphans: false,
    });
    const now = new Date().toISOString();
    const deadRunId = "run-dead-orphan";
    storage.createRun({
      id: deadRunId,
      packageId: "test.query-pkg",
      actionId: "sample.greet",
      status: "running",
      startedAt: now,
      rootRunId: deadRunId,
      packageInstanceId: "pkg-inst",
      generationId: "gen-1",
      ownerId: "owner-1",
    });
    await storage.close();

    // 执行一次真正的 run 命令（ownDataDir: true）
    const runRes = await runCliAsync(["run", "sample.greet", "--input", '{"name": "Alice"}', "--json"], tempDir);
    assert.strictEqual(runRes.exitCode, 0);

    // 此时旧的 orphan 运行记录应已被恢复为 interrupted
    const checkStorage = createStorage("test.query-pkg", {
      customHome: tempHome,
      projectRoot: tempDir,
      recoverOrphans: false,
    });
    const recovered = checkStorage.getRun(deadRunId);
    assert.notStrictEqual(recovered, null);
    assert.strictEqual(recovered?.status, "interrupted");
    await checkStorage.close();
  });
});
