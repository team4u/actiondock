import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { defineAction, type RunOrigin, type RunRecord } from "@actiondock/sdk";
import { MemoryStorage } from "@actiondock/testing";
import { createActionDockMcpServer } from "@actiondock/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { DefaultExecutionService } from "../src/execution/service";
import { createActionDockHost } from "../src/host/host";
import { createPackageRuntime } from "../src/package/runtime";
import { snapshotRunOrigin } from "../src/runtime/run-origin";
import { buildInitialRunRecord, type InitialRunRecordInput } from "../src/runtime/run-persistence";
import { createPackageIdentity } from "../src/runtime/identity";
import { createServerRunOrigin, startActionDockServer } from "../src/server";
import { NodeSqliteDriver } from "../src/storage/sqlite-driver";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import { renderRunDetail } from "../../cli/src/renderers/runs";

const expectedOrigin: RunOrigin = {
  channel: "http",
  viewName: "reader",
  authenticated: true,
};

function makeRecord(id: string, origin?: RunOrigin): RunRecord {
  const now = new Date().toISOString();
  return {
    id,
    rootRunId: id,
    packageId: "pkg.origin",
    packageInstanceId: "pkg.origin-instance",
    actionId: "echo",
    generationId: "1",
    ownerId: "host-test",
    status: "success",
    startedAt: now,
    finishedAt: now,
    ...(origin !== undefined ? { origin } : {}),
  };
}

async function createFixture(t: TestContext) {
  const app = await createPackageRuntime({
    projectConfig: {
      id: "pkg.origin",
      name: "Origin tests",
      version: "1.0.0",
      actions: {
        echo: { entry: "", description: "Origin echo" },
        invalid: { entry: "" },
        fail: { entry: "" },
      },
    },
    actions: {
      echo: defineAction({ run: (input: any) => input }),
      invalid: defineAction({
        inputSchema: { type: "object", required: ["requiredValue"] },
        run: () => ({ ok: true }),
      }),
      fail: defineAction({ run: () => { throw new Error("Expected action failure"); } }),
    },
    inMemory: true,
  });
  const host = await createActionDockHost({
    packages: [app],
    autoLoadCurrentProject: false,
    inMemory: true,
  });
  t.after(() => host.close());
  return { app, host };
}

async function createHttpFixture(t: TestContext, token: string | undefined = "root-token") {
  const { host, app } = await createFixture(t);
  const server = await startActionDockServer({
    service: host,
    host: "127.0.0.1",
    port: 0,
    token,
    enableMcp: false,
    packageAllowlist: ["*"],
    views: {
      reader: { token: "reader-token", packageAllowlist: ["*"] },
      worker: { token: "worker-token", packageAllowlist: ["*"] },
      public: { packageAllowlist: ["*"] },
    },
  });
  t.after(() => server.stop());
  return { host, app, server };
}

async function postAction(baseUrl: string, token?: string, prefix = "", body: object = {}, mode = "run") {
  const response = await fetch(`${baseUrl}${prefix}/api/v2/packages/pkg.origin/actions/echo/${mode}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.json() as any };
}

async function callMcp(url: string, token: string, method: string, params: object) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  const data = text.split("\n").find((line) => line.startsWith("data:"));
  assert.equal(response.status, 200, text);
  return JSON.parse(data ? data.slice(5).trim() : text);
}

describe("Run origin snapshots", () => {
  it("captures only known fields, preserves view names and freezes the snapshot", () => {
    const input = { channel: "http", viewName: " reader ", authenticated: true, token: "private-token" };
    const origin = snapshotRunOrigin(input)!;
    input.viewName = "changed";
    assert.deepEqual(origin, { ...expectedOrigin, viewName: " reader " });
    assert.ok(Object.isFrozen(origin));
    assert.equal("token" in origin, false);
    assert.throws(() => { (origin as any).viewName = "changed"; }, TypeError);
  });

  it("rejects invalid sources without leaking submitted values", () => {
    for (const input of [false, [], { ...expectedOrigin, authenticated: "false" },
      { channel: "http", authenticated: true }, { ...expectedOrigin, viewName: "" }]) {
      assert.throws(() => snapshotRunOrigin(input), { code: "INVALID_ARGUMENT" });
    }
    assert.throws(() => snapshotRunOrigin({ ...expectedOrigin, channel: "secret-value" }),
      (error: any) => error.code === "INVALID_ARGUMENT" && !error.message.includes("secret-value"));
    assert.equal(snapshotRunOrigin(undefined), undefined);
  });

  it("derives the effective view and authentication state without keeping tokens", () => {
    assert.deepEqual(createServerRunOrigin({ viewName: "reader", token: "reader-token" }, "http"), expectedOrigin);
    for (const token of [undefined, "", "   "]) {
      const origin = createServerRunOrigin({ token }, "mcp");
      assert.deepEqual(origin, { channel: "mcp", viewName: "default", authenticated: false });
      assert.ok(Object.isFrozen(origin));
    }
  });

  it("keeps initial run construction source-safe and leaves legacy sources absent", () => {
    const raw = { ...expectedOrigin, token: "private-token" };
    const params: InitialRunRecordInput = {
      runId: "initial", rootRunId: "initial", targetPackageId: "pkg.origin", targetActionId: "echo",
      startedAt: new Date().toISOString(), input: {}, runnerPackageId: "pkg.origin",
      runnerPackageInstanceId: "instance", runnerGenerationId: "1", origin: raw,
    };
    const record = buildInitialRunRecord(params, "running");
    raw.viewName = "changed";
    assert.deepEqual(record.origin, expectedOrigin);
    assert.equal("token" in record.origin!, false);
    const legacy = buildInitialRunRecord({ ...params, origin: undefined }, "failed");
    assert.equal(Object.hasOwn(legacy, "origin"), false);
  });
});

describe("Run origin storage", () => {
  it("keeps memory storage snapshots independent of both writers and readers", () => {
    const storage = new MemoryStorage({ packageId: "pkg.origin" });
    try {
      const raw = { ...expectedOrigin, token: "private-token" };
      storage.createRun(makeRecord("memory", raw));
      raw.viewName = "changed";
      const read = storage.getRun("memory")!;
      assert.deepEqual(read.origin, expectedOrigin);
      assert.throws(() => { (read.origin as any).viewName = "changed"; }, TypeError);
      assert.deepEqual(storage.listRuns()[0].origin, expectedOrigin);
      assert.deepEqual(storage.getRun("memory")?.origin, expectedOrigin);
      assert.equal(JSON.stringify(read).includes("private-token"), false);
      storage.createRun(makeRecord("legacy"));
      assert.equal(Object.hasOwn(storage.getRun("legacy")!, "origin"), false);
      assert.throws(() => storage.createRun({ ...makeRecord("invalid"), origin: false } as unknown as RunRecord),
        { code: "INVALID_ARGUMENT" });
    } finally {
      storage.close();
    }
  });

  it("migrates a legacy table without inventing sources and preserves new sources after reopening", () => {
    const directory = mkdtempSync(join(tmpdir(), "ad-run-origin-"));
    const dbPath = join(directory, "runs.db");
    let storage: SqliteRuntimeStorage | undefined;
    try {
      storage = new SqliteRuntimeStorage({ packageId: "pkg.origin", dbPath });
      storage.createRun(makeRecord("legacy"));
      storage.close();
      const driver = new NodeSqliteDriver(dbPath);
      try { driver.exec("ALTER TABLE runs DROP COLUMN origin_json"); } finally { driver.close(); }
      storage = new SqliteRuntimeStorage({ packageId: "pkg.origin", dbPath });
      assert.equal(Object.hasOwn(storage.getRun("legacy")!, "origin"), false);
      storage.createRun(makeRecord("new", expectedOrigin));
      storage.close();
      storage = new SqliteRuntimeStorage({ packageId: "pkg.origin", dbPath });
      assert.deepEqual(storage.getRun("new")?.origin, expectedOrigin);
      assert.deepEqual(storage.listRuns().find((run) => run.id === "new")?.origin, expectedOrigin);
    } finally {
      storage?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports corrupted origin JSON without exposing its contents or skipping empty values", () => {
    const driver = new NodeSqliteDriver(":memory:");
    const storage = new SqliteRuntimeStorage({ packageId: "pkg.origin", driver });
    try {
      storage.createRun(makeRecord("corrupted", expectedOrigin));
      for (const raw of ["", '{"token":"private-value"']) {
        driver.prepare("UPDATE runs SET origin_json = ? WHERE id = ?").run(raw, "corrupted");
        assert.throws(() => storage.getRun("corrupted"), (error: any) =>
          error.code === "RUN_REPOSITORY_UNAVAILABLE" && !error.message.includes("private-value"));
      }
      driver.prepare("UPDATE runs SET origin_json = ? WHERE id = ?").run("false", "corrupted");
      assert.throws(() => storage.getRun("corrupted"), { code: "INVALID_ARGUMENT" });
    } finally {
      storage.close();
    }
  });

  it("does not swallow failures when adding the origin column", () => {
    const driver = new NodeSqliteDriver(":memory:");
    const storage = new SqliteRuntimeStorage({ packageId: "pkg.origin", driver });
    driver.exec("ALTER TABLE runs DROP COLUMN origin_json");
    const exec = driver.exec.bind(driver);
    driver.exec = (sql: string) => {
      if (sql.includes("ADD COLUMN origin_json")) throw new Error("Origin migration failed");
      exec(sql);
    };
    try {
      assert.throws(() => new SqliteRuntimeStorage({ packageId: "pkg.origin", driver }), /Origin migration failed/);
    } finally {
      storage.close();
    }
  });
});

describe("Run origin execution", () => {
  it("captures service options before the first await and removes secret extensions", async (t) => {
    const { host } = await createFixture(t);
    const raw = { ...expectedOrigin, token: "private-token" };
    const pending = host.execution.run("pkg.origin/echo", {}, { origin: raw });
    raw.viewName = "changed";
    const result = await pending;
    assert.equal(result.ok, true);
    const record = await host.runs.get(result.runId);
    assert.deepEqual(record?.origin, expectedOrigin);
    assert.equal(JSON.stringify(record).includes("private-token"), false);
  });

  it("keeps absent origins absent when options are modified after direct submission", async (t) => {
    const { host, app } = await createFixture(t);
    for (const invoke of [host.runAction.bind(host), host.startAction.bind(host),
      app.runAction.bind(app), app.startAction.bind(app)]) {
      const options: { origin?: RunOrigin } = {};
      const pending = invoke("echo", {}, options);
      options.origin = expectedOrigin;
      const result = await pending;
      if ("result" in result) await result.result;
      const record = await host.runs.get(result.runId);
      assert.equal(record?.origin, undefined);
      assert.ok(record);
    }
  });

  it("persists the same source for validation and action failures", async (t) => {
    const { host } = await createFixture(t);
    for (const action of ["invalid", "fail"]) {
      const result = await host.execution.run(`pkg.origin/${action}`, {}, { origin: expectedOrigin });
      assert.equal(result.ok, false);
      assert.deepEqual((await host.runs.get(result.runId))?.origin, expectedOrigin);
    }
  });

  it("persists source information for an already-recorded missing action failure", async () => {
    const storage = new MemoryStorage({ packageId: "pkg.origin" });
    const runner = new DefaultExecutionService({ identity: createPackageIdentity({ id: "pkg.origin" }), storage });
    try {
      const result = await runner.execute("missing", {}, { origin: expectedOrigin });
      assert.equal(result.ok, false);
      assert.deepEqual(storage.getRun(result.runId)?.origin, expectedOrigin);
    } finally {
      await runner.close();
      storage.close();
    }
  });

  it("inherits the root origin across local and cross-package child calls", async (t) => {
    const host = await createActionDockHost({
      autoLoadCurrentProject: false,
      inMemory: true,
      packages: [
        {
          projectConfig: {
            id: "pkg.caller", name: "Caller", version: "1.0.0",
            actions: {
              parent: { entry: "", uses: ["pkg.caller/child", "pkg.worker/leaf"] },
              child: { entry: "" },
            },
          },
          actions: {
            parent: defineAction({ run: async (_input, ctx) => {
              await ctx.actions.invoke("pkg.caller/child", {});
              return ctx.actions.invoke("pkg.worker/leaf", {});
            } }),
            child: defineAction({ run: () => ({ child: true }) }),
          },
          inMemory: true,
        },
        {
          projectConfig: { id: "pkg.worker", name: "Worker", version: "1.0.0" },
          actions: { leaf: defineAction({ run: () => ({ leaf: true }) }) },
          inMemory: true,
        },
      ],
    });
    t.after(() => host.close());
    const result = await host.execution.run("pkg.caller/parent", {}, { origin: expectedOrigin });
    assert.equal(result.ok, true);
    const records = await host.runs.list();
    assert.equal(records.length, 3);
    for (const record of records) {
      assert.deepEqual(record.origin, expectedOrigin);
      assert.equal(record.rootRunId, result.runId);
      if (record.id !== result.runId) assert.equal(record.parentRunId, result.runId);
    }
  });
});

describe("HTTP run origin", () => {
  it("records default and token-selected views for synchronous and asynchronous execution", async (t) => {
    const { host, server } = await createHttpFixture(t);
    for (const [token, prefix, mode, viewName] of [
      ["root-token", "", "run", "default"],
      ["reader-token", "", "run", "reader"],
      ["worker-token", "/views/worker", "start", "worker"],
    ]) {
      const response = await postAction(server.url, token, prefix, { input: { value: viewName } }, mode);
      assert.equal(response.status, mode === "start" ? 202 : 200);
      assert.deepEqual((await host.runs.get(response.body.runId))?.origin,
        { channel: "http", viewName, authenticated: true });
    }
    const denied = await postAction(server.url, "wrong-token", "/views/reader");
    assert.equal(denied.status, 401);
    assert.equal((await host.runs.list()).length, 3);
  });

  it("does not mistake an arbitrary bearer header on public views for successful authentication", async (t) => {
    const { host, server } = await createHttpFixture(t, "");
    for (const [prefix, token, viewName] of [["", "", "default"],
      ["", "unknown-token", "default"], ["/views/public", "unknown-token", "public"]]) {
      const response = await postAction(server.url, token, prefix);
      assert.equal(response.status, 200);
      assert.deepEqual((await host.runs.get(response.body.runId))?.origin,
        { channel: "http", viewName, authenticated: false });
    }
  });

  it("ignores client-declared provenance while preserving business input", async (t) => {
    const { host, server } = await createHttpFixture(t);
    const forged = { channel: "mcp", viewName: "admin", authenticated: false, token: "private-value" };
    const input = { value: 7, origin: { business: true } };
    const response = await postAction(server.url, "reader-token", "", {
      input, origin: forged, execution: { origin: forged },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, input);
    const record = await host.runs.get(response.body.runId);
    assert.deepEqual(record?.origin, expectedOrigin);
    assert.deepEqual(record?.input, input);
    assert.equal(JSON.stringify(record).includes("private-value"), false);
  });

  it("preserves the first origin when another view reuses an idempotent request", async (t) => {
    const { host, server } = await createHttpFixture(t);
    const body = { input: { value: 42 }, requestId: "shared-request" };
    const first = await postAction(server.url, "reader-token", "", body);
    const repeated = await postAction(server.url, "worker-token", "", body);
    assert.equal(first.status, 200);
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.runId, first.body.runId);
    assert.deepEqual((await host.runs.get(first.body.runId))?.origin, expectedOrigin);
    assert.equal((await host.runs.list()).length, 1);
  });

  it("returns the persisted origin through run detail and list APIs", async (t) => {
    const { server } = await createHttpFixture(t);
    const submitted = await postAction(server.url, "reader-token");
    const headers = { Authorization: "Bearer reader-token" };
    const detail = await fetch(`${server.url}/api/v2/runs/${submitted.body.runId}`, { headers });
    assert.equal(detail.status, 200);
    assert.deepEqual((await detail.json() as any).origin, expectedOrigin);
    const listed = await fetch(`${server.url}/api/v2/runs`, { headers });
    assert.equal(listed.status, 200);
    const payload = await listed.json() as any;
    const records = Array.isArray(payload) ? payload : payload.items;
    assert.deepEqual(records[0].origin, expectedOrigin);
  });
});

describe("MCP run origin", () => {
  it("keeps origins isolated between concurrent root and named view requests", async (t) => {
    const { host } = await createFixture(t);
    const server = await startActionDockServer({
      service: host, host: "127.0.0.1", port: 0, token: "root-token",
      packageAllowlist: ["*"],
      views: { reader: { token: "reader-token", packageAllowlist: ["*"] }, worker: { token: "worker-token", packageAllowlist: ["*"] } },
      mcpHandlerFactory: (policy) => {
        const origin = createServerRunOrigin(policy, "mcp");
        const handler = createMcpHandler(() => createActionDockMcpServer({ service: host, origin, packageAllowlist: ["*"] }));
        return (request) => handler.fetch(request);
      },
    });
    t.after(() => server.stop());
    const responses = await Promise.all([
      callMcp(`${server.url}/mcp`, "root-token", "tools/call", { name: "echo", arguments: { caller: "default" } }),
      callMcp(`${server.url}/mcp`, "reader-token", "tools/call", { name: "echo", arguments: { caller: "reader" } }),
      callMcp(`${server.url}/views/worker/mcp`, "worker-token", "tools/call", { name: "echo", arguments: { caller: "worker" } }),
    ]);
    for (const [index, response] of responses.entries()) {
      assert.equal(response.error, undefined, JSON.stringify(response));
      const result = JSON.parse(response.result.content[0].text);
      assert.equal(result.ok, true);
      assert.deepEqual((await host.runs.get(result.runId))?.origin, {
        channel: "mcp", viewName: ["default", "reader", "worker"][index], authenticated: true,
      });
    }
  });

  it("does not add a service origin to an unbound MCP adapter", async (t) => {
    const { host } = await createFixture(t);
    const handler = createMcpHandler(() => createActionDockMcpServer({ service: host, packageAllowlist: ["*"] }));
    const request = new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: {} } }),
    });
    const response = await handler.fetch(request);
    assert.equal(response.status, 200);
    const text = await response.text();
    const data = text.split("\n").find((line) => line.startsWith("data:"));
    const payload = JSON.parse(data ? data.slice(5).trim() : text);
    const result = JSON.parse(payload.result.content[0].text);
    assert.equal((await host.runs.get(result.runId))?.origin, undefined);
  });
});

describe("Run origin presentation", () => {
  it("shows the source in English without changing legacy run details", () => {
    const current = makeRecord("current", expectedOrigin);
    assert.match(renderRunDetail(current), /Origin: +channel=http view=reader authenticated=true/);
    assert.deepEqual(JSON.parse(JSON.stringify(current)).origin, expectedOrigin);
    assert.equal(renderRunDetail(makeRecord("legacy")).includes("Origin:"), false);
  });
});
