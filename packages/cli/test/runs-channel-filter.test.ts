import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject, createActionDock, startActionDockServer } from "@actiondock/core";
import { createStorage } from "@actiondock/core/package";
import { fetchRemoteRuns } from "@actiondock/core/profile";
import { runCliAsync } from "./helpers/run-cli";

describe("CLI runs list - 过滤项与总数统计能力", () => {
  let tempDir: string;
  let tempHome: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-runs-filter-"));
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-runs-filter-home-"));
    process.env.ACTIONDOCK_HOME = tempHome;

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
      } catch {}
    }

    initProject(tempDir, { id: "test.channel-pkg", name: "Channel Test Package" });

    // 初始化测试运行记录，分别覆盖 http、mcp 通道与成功、失败等状态
    const storage = createStorage("test.channel-pkg", { customHome: tempHome });

    // 2条 HTTP 运行记录
    storage.createRun({
      id: "run-http-1",
      rootRunId: "run-http-1",
      packageId: "test.channel-pkg",
      packageInstanceId: "test.channel-pkg",
      generationId: "1",
      ownerId: "local",
      actionId: "sample.greet",
      status: "success",
      startedAt: "2026-10-14T10:00:00.000Z",
      finishedAt: "2026-10-14T10:00:01.000Z",
      durationMs: 1000,
      input: { name: "Alice" },
      output: { greeting: "Hello Alice" },
      origin: { channel: "http", viewName: "default", authenticated: true },
    });

    storage.createRun({
      id: "run-http-2",
      rootRunId: "run-http-2",
      packageId: "test.channel-pkg",
      packageInstanceId: "test.channel-pkg",
      generationId: "1",
      ownerId: "local",
      actionId: "sample.greet",
      status: "failed",
      startedAt: "2026-10-14T10:01:00.000Z",
      finishedAt: "2026-10-14T10:01:01.000Z",
      durationMs: 1000,
      input: { name: "Bob" },
      error: { code: "EXECUTION_FAILED", message: "HTTP failure" },
      origin: { channel: "http", viewName: "admin", authenticated: true },
    });

    // 3条 MCP 运行记录
    storage.createRun({
      id: "run-mcp-1",
      rootRunId: "run-mcp-1",
      packageId: "test.channel-pkg",
      packageInstanceId: "test.channel-pkg",
      generationId: "1",
      ownerId: "local",
      actionId: "sample.greet",
      status: "success",
      startedAt: "2026-10-14T10:02:00.000Z",
      finishedAt: "2026-10-14T10:02:01.000Z",
      durationMs: 1000,
      input: { name: "Charlie" },
      output: { greeting: "Hello Charlie" },
      origin: { channel: "mcp", viewName: "default", authenticated: false },
    });

    storage.createRun({
      id: "run-mcp-2",
      rootRunId: "run-mcp-2",
      packageId: "test.channel-pkg",
      packageInstanceId: "test.channel-pkg",
      generationId: "1",
      ownerId: "local",
      actionId: "sample.greet",
      status: "success",
      startedAt: "2026-10-14T10:03:00.000Z",
      finishedAt: "2026-10-14T10:03:01.000Z",
      durationMs: 1000,
      input: { name: "David" },
      output: { greeting: "Hello David" },
      origin: { channel: "mcp", viewName: "restricted", authenticated: true },
    });

    storage.createRun({
      id: "run-mcp-3",
      rootRunId: "run-mcp-3",
      packageId: "test.channel-pkg",
      packageInstanceId: "test.channel-pkg",
      generationId: "1",
      ownerId: "local",
      actionId: "sample.greet",
      status: "failed",
      startedAt: "2026-10-14T10:04:00.000Z",
      finishedAt: "2026-10-14T10:04:01.000Z",
      durationMs: 1000,
      input: { name: "Eve" },
      error: { code: "EXECUTION_FAILED", message: "MCP failure" },
      origin: { channel: "mcp", viewName: "restricted", authenticated: true },
    });
  });

  afterEach(async () => {
    delete process.env.ACTIONDOCK_HOME;
    if (tempHome && existsSync(tempHome)) {
      try {
        rmSync(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {}
    }
    if (tempDir && existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {}
    }
  });

  it("ad runs list --channel http -n N 正确筛选 http 通道且限制条数", async () => {
    const res = await runCliAsync(
      ["runs", "list", "--channel", "http", "-n", "1", "--json"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(res.exitCode, 0);
    const runs = JSON.parse(res.stdout.toString());
    assert.ok(Array.isArray(runs));
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].origin?.channel, "http");
    assert.strictEqual(runs[0].id, "run-http-2");
  });

  it("ad runs list --channel mcp 正确筛选 mcp 全部通道记录", async () => {
    const res = await runCliAsync(
      ["runs", "list", "--channel", "mcp", "--json"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(res.exitCode, 0);
    const runs = JSON.parse(res.stdout.toString());
    assert.ok(Array.isArray(runs));
    assert.strictEqual(runs.length, 3);
    for (const r of runs) {
      assert.strictEqual(r.origin?.channel, "mcp");
    }
  });

  it("ad runs list --status 正确按状态过滤记录", async () => {
    // 仅成功记录
    const successRes = await runCliAsync(
      ["runs", "list", "--status", "success", "--json"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(successRes.exitCode, 0);
    const successRuns = JSON.parse(successRes.stdout.toString());
    assert.strictEqual(successRuns.length, 3);
    for (const r of successRuns) {
      assert.strictEqual(r.status, "success");
    }

    // mcp 通道下的失败记录
    const mcpFailedRes = await runCliAsync(
      ["runs", "list", "--channel", "mcp", "--status", "failed", "--json"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(mcpFailedRes.exitCode, 0);
    const mcpFailedRuns = JSON.parse(mcpFailedRes.stdout.toString());
    assert.strictEqual(mcpFailedRuns.length, 1);
    assert.strictEqual(mcpFailedRuns[0].id, "run-mcp-3");
    assert.strictEqual(mcpFailedRuns[0].origin?.channel, "mcp");
    assert.strictEqual(mcpFailedRuns[0].status, "failed");
  });

  it("ad runs list --offset 正确跳过指定记录条数", async () => {
    const allMcpRes = await runCliAsync(
      ["runs", "list", "--channel", "mcp", "--json"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(allMcpRes.exitCode, 0);
    const allMcp = JSON.parse(allMcpRes.stdout.toString());
    assert.strictEqual(allMcp.length, 3);

    const offsetRes = await runCliAsync(
      ["runs", "list", "--channel", "mcp", "--offset", "1", "-n", "1", "--json"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(offsetRes.exitCode, 0);
    const paged = JSON.parse(offsetRes.stdout.toString());
    assert.strictEqual(paged.length, 1);
    assert.strictEqual(paged[0].id, allMcp[1].id);
  });

  it("ad runs list --with-total 验证 JSON 模式下包含 total 字段及分页元数据", async () => {
    const res = await runCliAsync(
      ["runs", "list", "--channel", "mcp", "--with-total", "-n", "2", "--offset", "1", "--json"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(res.exitCode, 0);
    const output = JSON.parse(res.stdout.toString());
    assert.strictEqual(typeof output, "object");
    assert.ok(!Array.isArray(output));
    assert.strictEqual(output.total, 3);
    assert.strictEqual(output.limit, 2);
    assert.strictEqual(output.offset, 1);
    assert.strictEqual(output.items.length, 2);

    // 未传递 --with-total 时输出保持数组向下兼容
    const legacyRes = await runCliAsync(
      ["runs", "list", "--channel", "mcp", "-n", "2", "--json"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(legacyRes.exitCode, 0);
    const legacyOutput = JSON.parse(legacyRes.stdout.toString());
    assert.ok(Array.isArray(legacyOutput));
    assert.strictEqual(legacyOutput.length, 2);
  });

  it("ad runs list 人类可读格式中清晰表达 channel、status 过滤摘要与总数", async () => {
    const humanRes = await runCliAsync(
      ["runs", "list", "--channel", "http", "--status", "success", "--with-total"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(humanRes.exitCode, 0);
    const text = humanRes.stdout.toString();
    assert.match(text, /channel='http'/);
    assert.match(text, /status='success'/);
    assert.match(text, /showing 1 of 1/);
    assert.match(text, /run-http-1/);
  });

  it("远端服务 GET /api/v2/runs 与 fetchRemoteRuns 完整支持 channel、withTotal 等过滤项", async () => {
    const AUTH_TOKEN = "test-token-runs-channel";
    const server = await startActionDockServer({
      projectRoot: tempDir,
      customHome: tempHome,
      port: 0,
      token: AUTH_TOKEN,
      packageAllowlist: ["*"],
    });

    try {
      const serverUrl = server.url;

      // 1. fetchRemoteRuns 支持 channel 过滤与 withTotal
      const remoteRes = await fetchRemoteRuns(serverUrl, AUTH_TOKEN, {
        channel: "http",
        status: "success",
        withTotal: true,
        limit: 10,
        offset: 0,
      });
      assert.strictEqual(remoteRes.ok, true);
      assert.strictEqual(remoteRes.total, 1);
      assert.strictEqual(remoteRes.items.length, 1);
      assert.strictEqual(remoteRes.items[0].id, "run-http-1");

      // 2. HTTP 原生 GET /api/v2/runs 解析 channel、status 与 withTotal
      const rawRes = await fetch(
        `${serverUrl}/api/v2/runs?channel=mcp&status=success&withTotal=true&limit=1&offset=0`,
        {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        }
      );
      assert.strictEqual(rawRes.status, 200);
      const data = await rawRes.json() as any;
      assert.strictEqual(data.ok, true);
      assert.strictEqual(data.total, 2);
      assert.strictEqual(data.items.length, 1);
      assert.strictEqual(data.limit, 1);
      assert.strictEqual(data.offset, 0);
    } finally {
      await server.stop();
    }
  });
});
