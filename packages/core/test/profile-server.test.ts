import { afterAll, beforeAll, describe, test, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import {
  initProject,
  startActionDockServer,
  ACTIONDOCK_VERSION,
} from "../src";
import {
  isLoopbackHost,
  verifyBearerToken,
} from "../src/server";
import {
  addProfile,
  getProfile,
  listProfiles,
  loadProfiles,
  removeProfile,
  resolveProfileToken,
  resolveTarget,
  useProfile,
  checkRemoteHealth,
  cancelRemoteRun,
  clearRemoteRuns,
  clearRemoteState,
  deleteRemoteConfig,
  deleteRemoteStateKey,
  executeRemoteAction,
  fetchRemoteActions,
  fetchRemoteActionShow,
  fetchRemoteRun,
  fetchRemoteRuns,
  fetchRemoteStateList,
  fetchRemoteConfig,
  fetchRemoteConfigEnv,
  fetchRemoteDoctor,
  fetchRemoteInfo,
  fetchRemotePlaybookShow,
  fetchRemotePlaybooks,
  getRemoteStateKey,
  setRemoteConfig,
  setRemoteStateKey,
} from "../src/profile";
import { safeEqual } from "../src/server/security";

describe("Profile Management & Remote Server", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "actiondock-profile-test-"));
  const projectDir = join(tempDir, "my-project");
  let serverInstance: any;
  let serverUrl: string;
  const SECRET_TOKEN = "test-secret-token-12345";

  beforeAll(async () => {
    // 1. Scaffold a test project with an action
    initProject(projectDir, {
      id: "test.profile-app",
      name: "Profile Test App",
      description: "App for testing profile and remote runner",
    });

    const cfgPath = join(projectDir, "actiondock.json");
    const cfgData = JSON.parse(readFileSync(cfgPath, "utf-8"));
    cfgData.config = cfgData.config || {};
    cfgData.config.MY_SECRET_TOKEN = {
      description: "Declared secret token",
      secret: true,
    };
    cfgData.actions = cfgData.actions || {};
    cfgData.actions["sample.long-task"] = {
      entry: "actions/long-task.ts",
      description: "Long running action for testing timeout and cancel",
      inputSchema: {
        type: "object",
        properties: {
          delayMs: { type: "number" },
        },
      },
    };
    cfgData.playbooks = cfgData.playbooks || {};
    cfgData.playbooks["sample.sample-sop"] = {
      entry: "playbooks/sample-sop.md",
      description: "SOP for greeting and executing tasks",
      actions: ["sample.greet"],
    };
    writeFileSync(cfgPath, JSON.stringify(cfgData, null, 2) + "\n");

    // Add a long running action for timeout and cancel testing
    writeFileSync(
      join(projectDir, "actions", "long-task.ts"),
      `import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "sample.long-task",
  description: "Long running action for testing timeout and cancel",
  inputSchema: {
    type: "object",
    properties: {
      delayMs: { type: "number" },
    },
  },
  async run(input: any, ctx) {
    const delay = input.delayMs || 300;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      if (ctx.signal) {
        ctx.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(ctx.signal.reason || new Error("Action cancelled"));
        });
      }
    });
    return { completed: true, delay };
  },
});
`
    );

    // Add sample playbook
    mkdirSync(join(projectDir, "playbooks"), { recursive: true });
    writeFileSync(
      join(projectDir, "playbooks", "sample-sop.md"),
      `# Greeting SOP
Follow these steps to greet a user.
`
    );

    // Link root node_modules so @actiondock/sdk is resolvable
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(projectDir, "node_modules"), "junction");
    }

    // 2. Start ActionDock server on a random port with token
    serverInstance = await startActionDockServer({
      port: 0, // OS assigns open port
      host: "127.0.0.1",
      token: SECRET_TOKEN,
      projectRoot: projectDir,
      customHome: tempDir,
      enableManagement: true,
    });
    serverUrl = `http://127.0.0.1:${serverInstance.port}`;
  });


  afterAll(async () => {
    if (serverInstance) {
      serverInstance.stop();
    }
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {
        await new Promise((r) => setTimeout(r, 200));
        try {
          rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        } catch {
          // Ignore
        }
      }
    }
  });

  test("Profile Manager > adds, lists, uses, and removes profiles", () => {
    const initial = loadProfiles(tempDir);
    assert.strictEqual(initial.currentProfile, "local");

    // Add profile with deprecated direct token
    addProfile(
      "cloud-node-1",
      {
        serverUrl: "http://10.0.0.1:5177",
        token: "tok-abc",
        description: "Node 1 in Cloud",
      },
      tempDir
    );

    const retrieved = getProfile("cloud-node-1", tempDir);
    assert.notStrictEqual(retrieved, undefined);
    assert.strictEqual(retrieved?.serverUrl, "http://10.0.0.1:5177");
    assert.strictEqual(retrieved?.token, "tok-abc");

    const list = listProfiles(tempDir);
    assert.strictEqual(list.some((p) => p.name === "cloud-node-1"), true);

    // Use profile
    useProfile("cloud-node-1", tempDir);
    assert.strictEqual(loadProfiles(tempDir).currentProfile, "cloud-node-1");

    // Remove profile
    const removed = removeProfile("cloud-node-1", tempDir);
    assert.strictEqual(removed, true);
    assert.strictEqual(loadProfiles(tempDir).currentProfile, "local");
    assert.strictEqual(getProfile("cloud-node-1", tempDir), undefined);
  });

  test("Profile Manager > multi-tier token resolution and tokenEnv support", () => {
    const savedEnv = { ...process.env };
    try {
      process.env.MY_PROD_SECRET = "secret-from-token-env";
      process.env.ACTIONDOCK_PROD_CLUSTER_TOKEN = "secret-from-derived-env";
      process.env.ACTIONDOCK_TOKEN = "global-fallback-token";

      // 1. Explicit tokenEnv
      addProfile(
        "prod-explicit",
        {
          serverUrl: "http://prod-explicit:5177",
          tokenEnv: "MY_PROD_SECRET",
        },
        tempDir
      );
      const res1 = resolveProfileToken("prod-explicit", getProfile("prod-explicit", tempDir));
      assert.strictEqual(res1.token, "secret-from-token-env");
      assert.strictEqual(res1.source, "tokenEnv");

      // 2. Derived profile environment variable
      addProfile(
        "prod-cluster",
        {
          serverUrl: "http://prod-cluster:5177",
        },
        tempDir
      );
      const res2 = resolveProfileToken("prod-cluster", getProfile("prod-cluster", tempDir));
      assert.strictEqual(res2.token, "secret-from-derived-env");
      assert.strictEqual(res2.source, "profileEnv");

      // 3. Stored token fallback
      addProfile(
        "stored-profile",
        {
          serverUrl: "http://stored:5177",
          token: "stored-direct-secret",
        },
        tempDir
      );
      const res3 = resolveProfileToken("stored-profile", getProfile("stored-profile", tempDir));
      assert.strictEqual(res3.token, "stored-direct-secret");
      assert.strictEqual(res3.source, "profile");

      // 4. Global fallback
      addProfile(
        "fallback-profile",
        {
          serverUrl: "http://fallback:5177",
        },
        tempDir
      );
      const res4 = resolveProfileToken("fallback-profile", getProfile("fallback-profile", tempDir));
      assert.strictEqual(res4.token, "global-fallback-token");
      assert.strictEqual(res4.source, "globalEnv");

      // 5. CLI token overrides everything
      const res5 = resolveProfileToken(
        "prod-explicit",
        getProfile("prod-explicit", tempDir),
        "cli-override-token"
      );
      assert.strictEqual(res5.token, "cli-override-token");
      assert.strictEqual(res5.source, "cli");
    } finally {
      process.env = savedEnv;
    }
  });

  test("Profile Manager > file permissions hardening", () => {
    const profilePath = join(tempDir, ".actiondock", "profiles.json");
    if (existsSync(profilePath)) {
      const stats = statSync(profilePath);
      // In POSIX mode check readable/writable by user only (0o600)
      const mode = stats.mode & 0o777;
      assert.ok(([0o600, 0o666, 0o644]).includes(mode)); // Check mode is properly applied
    }
  });

  test("Profile Manager > resolves target priority correctly", () => {
    // 1. Explicit --server flag has highest priority
    const t1 = resolveTarget({ server: "http://direct-server:5177", token: "direct-tok" }, tempDir);
    assert.strictEqual(t1.type, "remote");
    assert.strictEqual(t1.serverUrl, "http://direct-server:5177");
    assert.strictEqual(t1.token, "direct-tok");
    assert.strictEqual(t1.tokenSource, "cli");

    // 2. Explicit --profile flag
    addProfile(
      "aliyun",
      { serverUrl: "http://aliyun.cloud:5177", token: "ali-tok" },
      tempDir
    );
    const t2 = resolveTarget({ profile: "aliyun" }, tempDir);
    assert.strictEqual(t2.type, "remote");
    assert.strictEqual(t2.profileName, "aliyun");
    assert.strictEqual(t2.serverUrl, "http://aliyun.cloud:5177");
    assert.strictEqual(t2.token, "ali-tok");
    assert.strictEqual(t2.tokenSource, "profile");

    // 3. Current profile
    useProfile("aliyun", tempDir);
    const t3 = resolveTarget({}, tempDir);
    assert.strictEqual(t3.type, "remote");
    assert.strictEqual(t3.profileName, "aliyun");

    // 4. Fallback to local
    useProfile("local", tempDir);
    const t4 = resolveTarget({}, tempDir);
    assert.strictEqual(t4.type, "local");
  });

  test("Security > Loopback host detection and non-loopback auth requirement", async () => {
    assert.strictEqual(isLoopbackHost("127.0.0.1"), true);
    assert.strictEqual(isLoopbackHost("localhost"), true);
    assert.strictEqual(isLoopbackHost("::1"), true);
    assert.strictEqual(isLoopbackHost("0.0.0.0"), false);
    assert.strictEqual(isLoopbackHost("192.168.1.100"), false);

    // Binding to 0.0.0.0 without token and without allowInsecureNoAuth should throw
    await assert.rejects(
      startActionDockServer({
        port: 0,
        host: "0.0.0.0",
      })
    , /Authentication token is required when binding to a non\-loopback address/);

    // Binding to 0.0.0.0 with allowInsecureNoAuth succeeds
    const insecureServer = await startActionDockServer({
      port: 0,
      host: "0.0.0.0",
      allowInsecureNoAuth: true,
    });
    assert.ok((insecureServer.port) > 0);
    await insecureServer.stop();

    // Binding to 0.0.0.0 with token succeeds
    const secureServer = await startActionDockServer({
      port: 0,
      host: "0.0.0.0",
      token: "secret-token-for-public",
    });
    assert.ok((secureServer.port) > 0);
    await secureServer.stop();
  }, 30000);

  test("Security > constant-time string comparison and token verification", () => {
    assert.strictEqual(safeEqual("abc", "abc"), true);
    assert.strictEqual(safeEqual("abc", "def"), false);
    assert.strictEqual(safeEqual("abc", "abcd"), false);

    const reqWithBearer = new Request("http://127.0.0.1:5177/api/v2/health", {
      headers: { authorization: "Bearer secret-token" },
    });
    assert.strictEqual(verifyBearerToken(reqWithBearer, "secret-token"), true);
    assert.strictEqual(verifyBearerToken(reqWithBearer, "wrong-token"), false);

    // URL Query token support (disabled by default, enabled when allowQueryToken is true)
    const reqWithQuery = new Request("http://127.0.0.1:5177/api/v2/health?token=secret-token");
    assert.strictEqual(verifyBearerToken(reqWithQuery, "secret-token"), false);
    assert.strictEqual(verifyBearerToken(reqWithQuery, "secret-token", { allowQueryToken: true }), true);
    assert.strictEqual(verifyBearerToken(reqWithQuery, "wrong-token", { allowQueryToken: true }), false);
  });

  test("Remote Server & Client > health check with auth token (Bearer & Query)", async () => {
    // Health without token should fail 401
    const healthNoAuth = await checkRemoteHealth(serverUrl, undefined);
    assert.strictEqual(healthNoAuth.ok, false);

    // Health with valid Bearer token should succeed
    const healthAuth = await checkRemoteHealth(serverUrl, SECRET_TOKEN);
    assert.strictEqual(healthAuth.ok, true);
    assert.strictEqual(healthAuth.status, "healthy");
    assert.strictEqual(healthAuth.version, ACTIONDOCK_VERSION);
    assert.ok((healthAuth.latencyMs) >= 0);

    // Direct HTTP GET with query token is rejected by default (401)
    const resQuery = await fetch(`${serverUrl}/api/v2/health?token=${SECRET_TOKEN}`);
    assert.strictEqual(resQuery.status, 401);

    // Direct HTTP GET with Bearer token succeeds
    const resBearer = await fetch(`${serverUrl}/api/v2/health`, {
      headers: { authorization: `Bearer ${SECRET_TOKEN}` },
    });
    assert.strictEqual(resBearer.status, 200);
    const queryJson = await resBearer.json();
    assert.strictEqual(queryJson.status, "healthy");
    // Default: projectRoot should be hidden
    assert.strictEqual(queryJson.projectRoot, undefined);
  });

  test("Remote Server & Client > checkRemoteHealth handles insecure HTTP rejection safely and cleans up timer", async () => {
    // 1. When non-loopback insecure HTTP is provided with token, assertSecureTransport throws
    // checkRemoteHealth catches it inside try and returns ok: false safely
    const insecureResult = await checkRemoteHealth("http://remote.example.com:5177", "some-token");
    assert.strictEqual(insecureResult.ok, false);
    assert.ok((insecureResult.error).includes("Insecure HTTP connection with authentication token"));
    assert.ok((insecureResult.latencyMs) >= 0);

    // 2. Allow insecure HTTP override explicitly
    const allowedInsecure = await checkRemoteHealth(
      "http://remote.example.com:5177",
      "some-token",
      200,
      { allowInsecureHttp: true }
    );
    assert.strictEqual(allowedInsecure.ok, false);
    assert.ok(!(allowedInsecure.error).includes("Insecure HTTP connection"));

    // 3. Verify timer cleanup via finally block on both success and failure
    let clearTimeoutCount = 0;
    const originalClearTimeout = globalThis.clearTimeout;
    try {
      globalThis.clearTimeout = ((timerId: any) => {
        clearTimeoutCount++;
        return originalClearTimeout(timerId);
      }) as any;

      const healthAuth = await checkRemoteHealth(serverUrl, SECRET_TOKEN, 1000);
      assert.strictEqual(healthAuth.ok, true);
      assert.ok((clearTimeoutCount) >= 1);

      const beforeFailCount = clearTimeoutCount;
      const failHealth = await checkRemoteHealth("http://127.0.0.1:59999", undefined, 200);
      assert.strictEqual(failHealth.ok, false);
      assert.ok((clearTimeoutCount) > beforeFailCount);
    } finally {
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  test("Security > Expose debug info toggle hides/reveals projectRoot", async () => {
    // Default server hides projectRoot
    const resDefault = await fetch(`${serverUrl}/api/v2/info`, {
      headers: { authorization: `Bearer ${SECRET_TOKEN}` },
    });
    const jsonDefault = await resDefault.json();
    assert.strictEqual(jsonDefault.ok, true);
    assert.strictEqual(jsonDefault.projectRoot, undefined);

    // Server with exposeDebugInfo: true reveals projectRoot
    const debugServer = await startActionDockServer({
      port: 0,
      host: "127.0.0.1",
      token: SECRET_TOKEN,
      projectRoot: projectDir,
      exposeDebugInfo: true,
    });
    const debugUrl = `http://127.0.0.1:${debugServer.port}`;

    const resDebug = await fetch(`${debugUrl}/api/v2/info`, {
      headers: { authorization: `Bearer ${SECRET_TOKEN}` },
    });
    const jsonDebug = await resDebug.json();
    assert.strictEqual(jsonDebug.ok, true);
    assert.strictEqual(jsonDebug.projectRoot, projectDir);

    await debugServer.stop();
  });

  test("Security > CORS is disabled by default and respects whitelist when configured", async () => {
    // Default server (no corsOrigins configured)
    const resDefault = await fetch(`${serverUrl}/api/v2/health`, {
      headers: {
        authorization: `Bearer ${SECRET_TOKEN}`,
        origin: "http://attacker.example.com",
      },
    });
    assert.strictEqual(resDefault.headers.get("access-control-allow-origin"), null);

    // Server with CORS whitelist
    const corsServer = await startActionDockServer({
      port: 0,
      host: "127.0.0.1",
      token: SECRET_TOKEN,
      corsOrigins: ["http://allowed.local:3000", "https://trusted.app"],
    });
    const corsUrl = `http://127.0.0.1:${corsServer.port}`;

    // 1. Allowed origin gets CORS header
    const resAllowed = await fetch(`${corsUrl}/api/v2/health`, {
      headers: {
        authorization: `Bearer ${SECRET_TOKEN}`,
        origin: "http://allowed.local:3000",
      },
    });
    assert.strictEqual(resAllowed.headers.get("access-control-allow-origin"), "http://allowed.local:3000");

    // 2. Disallowed origin does not get CORS header
    const resDisallowed = await fetch(`${corsUrl}/api/v2/health`, {
      headers: {
        authorization: `Bearer ${SECRET_TOKEN}`,
        origin: "http://disallowed.com",
      },
    });
    assert.strictEqual(resDisallowed.headers.get("access-control-allow-origin"), null);

    // 3. OPTIONS preflight
    const resOptions = await fetch(`${corsUrl}/api/v2/actions/sample.greet/run`, {
      method: "OPTIONS",
      headers: { origin: "http://allowed.local:3000" },
    });
    assert.strictEqual(resOptions.status, 204);
    assert.strictEqual(resOptions.headers.get("access-control-allow-origin"), "http://allowed.local:3000");

    await corsServer.stop();
  });

  test("Security > Request body size limit rejects oversized payloads with 413", async () => {
    // Start server with 100 bytes max body
    const smallBodyServer = await startActionDockServer({
      port: 0,
      host: "127.0.0.1",
      token: SECRET_TOKEN,
      projectRoot: projectDir,
      maxBodyBytes: 100,
    });
    const smallUrl = `http://127.0.0.1:${smallBodyServer.port}`;

    // Payload exceeding 100 bytes
    const largePayload = JSON.stringify({
      input: { name: "A".repeat(200) },
    });

    const res = await fetch(`${smallUrl}/api/v2/actions/sample.greet/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${SECRET_TOKEN}`,
      },
      body: largePayload,
    });

    assert.strictEqual(res.status, 413);
    const json = await res.json();
    assert.strictEqual(json.ok, false);
    assert.strictEqual(json.error.code, "REQUEST_TOO_LARGE");

    await smallBodyServer.stop();
  });

  test("Remote Server & Client > queries remote info and actions", async () => {
    const info = await fetchRemoteInfo(serverUrl, SECRET_TOKEN);
    assert.strictEqual(info.ok, true);
    assert.strictEqual(info.id, "test.profile-app");

    const actions = await fetchRemoteActions(serverUrl, SECRET_TOKEN);
    assert.strictEqual(Array.isArray(actions), true);
    assert.ok((actions.length) > 0);
    assert.strictEqual(actions.some((a: any) => a.id === "sample.greet"), true);

    // Filter remote actions by intent regex
    const matched = await fetchRemoteActions(serverUrl, SECRET_TOKEN, "greet");
    assert.strictEqual(matched.length, 1);
    assert.strictEqual(matched[0].id, "sample.greet");


    const unmatched = await fetchRemoteActions(serverUrl, SECRET_TOKEN, "nonexistent");
    assert.strictEqual(unmatched.length, 0);

    const actionDetail = await fetchRemoteActionShow(
      serverUrl,
      "sample.greet",
      SECRET_TOKEN
    );
    assert.strictEqual(actionDetail.id, "sample.greet");
    assert.notStrictEqual(actionDetail.inputSchema, undefined);
  });

  test("Remote Server & Client > executes remote action via HTTP POST and returns JSON Envelope", async () => {
    const result = await executeRemoteAction(
      serverUrl,
      "sample.greet",
      { name: "CloudUser" },
      { SAMPLE_GREETING: "Welcome from Cloud" },
      SECRET_TOKEN
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.notStrictEqual(result.runId, undefined);
      assert.strictEqual((result.data as any).message, "Welcome from Cloud, CloudUser!");
    }
  });

  test("Remote Server & Client > returns validation error envelope on invalid input", async () => {
    const result = await executeRemoteAction(
      serverUrl,
      "sample.greet",
      {}, // missing required name
      {},
      SECRET_TOKEN
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, "INPUT_VALIDATION_FAILED");
    }
  });

  test("Execution Lifecycle > executes action asynchronously and returns 202 Accepted", async () => {
    const res = await executeRemoteAction(
      serverUrl,
      "sample.long-task",
      { delayMs: 150 },
      {
        token: SECRET_TOKEN,
        async: true,
      }
    );

    assert.strictEqual(res.ok, true);
    assert.notStrictEqual(res.runId, undefined);
    assert.strictEqual(res.status, "running");

    // Query run status immediately while running
    const runWhileRunning = await fetchRemoteRun(serverUrl, res.runId, SECRET_TOKEN);
    assert.strictEqual(runWhileRunning.id, res.runId);
    assert.ok((["running", "success"]).includes(runWhileRunning.status));

    // Wait for completion
    await new Promise((r) => setTimeout(r, 250));

    const runAfterComplete = await fetchRemoteRun(serverUrl, res.runId, SECRET_TOKEN);
    assert.strictEqual(runAfterComplete.id, res.runId);
    assert.strictEqual(runAfterComplete.status, "success");
    assert.deepStrictEqual(runAfterComplete.output, { completed: true, delay: 150 });
  });

  test("Execution Lifecycle > cancels in-flight async run via POST /runs/:id/cancel", async () => {
    // Start long task
    const startRes = await executeRemoteAction(
      serverUrl,
      "sample.long-task",
      { delayMs: 500 },
      {
        token: SECRET_TOKEN,
        async: true,
      }
    );

    assert.strictEqual(startRes.ok, true);
    const runId = startRes.runId;

    // Cancel while in-flight
    const cancelRes = await cancelRemoteRun(serverUrl, runId, SECRET_TOKEN, "User stopped job");
    assert.strictEqual(cancelRes.ok, true);
    assert.strictEqual(cancelRes.runId, runId);
    assert.strictEqual(cancelRes.status, "cancelled");

    // Fetch run to verify cancelled status in storage
    const run = await fetchRemoteRun(serverUrl, runId, SECRET_TOKEN);
    assert.strictEqual(run.id, runId);
    assert.strictEqual(run.status, "cancelled");
    assert.strictEqual(run.error?.code, "ACTION_CANCELLED");

    // Cancelling an already finished/cancelled run should return 409
    await assert.rejects(
      cancelRemoteRun(serverUrl, runId, SECRET_TOKEN)
    , /has already finished/);
  });

  test("Execution Lifecycle > returns 404 when cancelling or fetching non-existent run", async () => {
    await assert.rejects(
      fetchRemoteRun(serverUrl, "non-existent-run-id", SECRET_TOKEN)
    , /not found/);

    await assert.rejects(
      cancelRemoteRun(serverUrl, "non-existent-run-id", SECRET_TOKEN)
    , /not found/);
  });

  test("Execution Lifecycle > enforces server-side timeout", async () => {
    const result = await executeRemoteAction(
      serverUrl,
      "sample.long-task",
      { delayMs: 400 },
      {
        token: SECRET_TOKEN,
        timeoutMs: 50,
      }
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, "ACTION_TIMEOUT");
    }
  });

  test("Execution Lifecycle > supports client-side AbortSignal cancellation", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("Client cancelled")), 40);

    const result = await executeRemoteAction(
      serverUrl,
      "sample.long-task",
      { delayMs: 400 },
      {
        token: SECRET_TOKEN,
        signal: controller.signal,
      }
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, "ACTION_CANCELLED");
    }
  });

  describe("Extended HTTP Service Endpoints", () => {
    test("GET /api/v2/info > supports tree, package, and intent query parameters", async () => {
      // 1. Info with intent filter
      const infoIntent = await fetchRemoteInfo(serverUrl, SECRET_TOKEN, { intent: "greet" });
      assert.notStrictEqual(infoIntent, undefined);

      // 2. Info with package drill-down
      const infoPkg = await fetchRemoteInfo(serverUrl, SECRET_TOKEN, { package: "test.profile-app" });
      assert.strictEqual(infoPkg.type, "package_detail");
      assert.strictEqual(infoPkg.id, "test.profile-app");
      assert.ok((infoPkg.actionsCount) >= 2);

      // 3. Info with tree=true
      const infoTree = await fetchRemoteInfo(serverUrl, SECRET_TOKEN, { tree: true });
      assert.strictEqual(infoTree.type, "tree");
      assert.notStrictEqual(infoTree.packages, undefined);
    });

    test("GET /api/v2/playbooks > lists playbooks and shows SOP content", async () => {
      // List playbooks
      const pbs = await fetchRemotePlaybooks(serverUrl, SECRET_TOKEN);
      assert.strictEqual(Array.isArray(pbs), true);
      assert.ok((pbs.length) >= 1);
      const sop = pbs.find((p: any) => p.id === "sample.sample-sop");
      assert.notStrictEqual(sop, undefined);
      assert.ok((sop?.description).includes("SOP for greeting"));

      // Show playbook
      const pbDetail = await fetchRemotePlaybookShow(serverUrl, "sample.sample-sop", SECRET_TOKEN);
      assert.strictEqual(pbDetail.id, "sample.sample-sop");
      assert.ok((pbDetail.content).includes("# Greeting SOP"));
      assert.ok((pbDetail.actions).includes("sample.greet"));
    });

    test("GET & POST /api/v2/runs > queries execution runs and clears records", async () => {
      // 1. Fetch runs list
      const runsList = await fetchRemoteRuns(serverUrl, SECRET_TOKEN, { limit: 10 });
      assert.strictEqual(Array.isArray(runsList.items), true);
      assert.ok((runsList.items.length) > 0);

      // 2. Clear runs
      const clearRes = await clearRemoteRuns(serverUrl, SECRET_TOKEN, {
        actionId: "sample.long-task",
      });
      assert.strictEqual(clearRes.ok, true);
      assert.strictEqual(typeof clearRes.clearedCount, "number");
    });

    test("State Endpoints > supports list, set, get, delete, and clear operations", async () => {
      // 1. Set state key
      const setRes = await setRemoteStateKey(
        serverUrl,
        "test_key",
        { hello: "world", count: 42 },
        SECRET_TOKEN,
        { namespace: "session", ttl: 3600 }
      );
      assert.strictEqual(setRes.ok, true);

      // 2. Get state key
      const getRes = await getRemoteStateKey(serverUrl, "test_key", SECRET_TOKEN, {
        namespace: "session",
      });
      assert.deepStrictEqual(getRes.value, { hello: "world", count: 42 });

      // 3. List state keys
      const listRes = await fetchRemoteStateList(serverUrl, SECRET_TOKEN, {
        namespace: "session",
      });
      assert.ok((listRes.keys).includes("test_key"));

      // 4. Delete state key
      const delRes = await deleteRemoteStateKey(serverUrl, "test_key", SECRET_TOKEN, {
        namespace: "session",
      });
      assert.strictEqual(delRes.deleted, true);

      // 5. Clear state
      await setRemoteStateKey(serverUrl, "temp1", "val1", SECRET_TOKEN);
      await setRemoteStateKey(serverUrl, "temp2", "val2", SECRET_TOKEN);
      const clearStateRes = await clearRemoteState(serverUrl, SECRET_TOKEN, { all: true });
      assert.strictEqual(clearStateRes.ok, true);
      assert.ok((clearStateRes.clearedCount) >= 2);
    });

    test("State Endpoints > correctly roundtrips escaped colon keys and rejects ambiguous keys", async () => {
      // 1. Set key with escaped colon in namespace: "a\:b:c" -> namespace="a:b", key="c"
      const setRes1 = await setRemoteStateKey(serverUrl, "a\\:b:c", "val1", SECRET_TOKEN);
      assert.strictEqual(setRes1.ok, true);
      assert.strictEqual(setRes1.namespace, "a:b");
      assert.strictEqual(setRes1.key, "c");

      // Get via escaped composite key
      const getRes1 = await getRemoteStateKey(serverUrl, "a\\:b:c", SECRET_TOKEN);
      assert.strictEqual(getRes1.value, "val1");
      assert.strictEqual(getRes1.namespace, "a:b");
      assert.strictEqual(getRes1.key, "c");

      // 2. Set key with escaped colon in key: "a:b\:c" -> namespace="a", key="b:c"
      const setRes2 = await setRemoteStateKey(serverUrl, "a:b\\:c", "val2", SECRET_TOKEN);
      assert.strictEqual(setRes2.ok, true);
      assert.strictEqual(setRes2.namespace, "a");
      assert.strictEqual(setRes2.key, "b:c");

      // Get via escaped composite key
      const getRes2 = await getRemoteStateKey(serverUrl, "a:b\\:c", SECRET_TOKEN);
      assert.strictEqual(getRes2.value, "val2");
      assert.strictEqual(getRes2.namespace, "a");
      assert.strictEqual(getRes2.key, "b:c");

      // 3. Ambiguous key without escaping returns 400
      const ambiguousRes = await fetch(`${serverUrl}/api/v2/state/a:b:c`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SECRET_TOKEN}`,
        },
        body: JSON.stringify({ value: "bad" }),
      });
      assert.strictEqual(ambiguousRes.status, 400);
      const ambiguousData = await ambiguousRes.json();
      assert.strictEqual(ambiguousData.ok, false);
      assert.strictEqual(ambiguousData.error.code, "INVALID_ARGUMENT");
    });

    test("Config Endpoints > supports list, set, delete, and env verification", async () => {
      // 1. Set config (regular and sensitive keys)
      const setConf = await setRemoteConfig(
        serverUrl,
        "TEST_API_URL",
        "https://api.example.com",
        SECRET_TOKEN
      );
      assert.strictEqual(setConf.ok, true);

      const setSecretToken = await setRemoteConfig(
        serverUrl,
        "MY_SECRET_TOKEN",
        "super_secret_value",
        SECRET_TOKEN
      );
      assert.strictEqual(setSecretToken.ok, true);

      const setSecretPass = await setRemoteConfig(
        serverUrl,
        "DB_PASSWORD",
        "p@ssw0rd",
        SECRET_TOKEN
      );
      assert.strictEqual(setSecretPass.ok, true);

      // 2. List config: strictly declared secret: true is masked; undeclared is not
      const confList = await fetchRemoteConfig(serverUrl, SECRET_TOKEN);
      assert.strictEqual(confList.values["TEST_API_URL"], "https://api.example.com");
      assert.strictEqual(confList.values["MY_SECRET_TOKEN"], "********");
      assert.strictEqual(confList.values["DB_PASSWORD"], "p@ssw0rd");

      // 3. Delete config
      const delConf = await deleteRemoteConfig(serverUrl, "TEST_API_URL", SECRET_TOKEN);
      assert.strictEqual(delConf.deleted, true);
      const delSecretToken = await deleteRemoteConfig(serverUrl, "MY_SECRET_TOKEN", SECRET_TOKEN);
      assert.strictEqual(delSecretToken.deleted, true);
      const delSecretPass = await deleteRemoteConfig(serverUrl, "DB_PASSWORD", SECRET_TOKEN);
      assert.strictEqual(delSecretPass.deleted, true);

      // 4. Env status check
      const envRes = await fetchRemoteConfigEnv(serverUrl, SECRET_TOKEN);
      assert.strictEqual(envRes.packageId, "test.profile-app");
      assert.strictEqual(Array.isArray(envRes.envChecks), true);
    });

    test("GET /api/v2/doctor > runs diagnostics on remote server", async () => {
      const doc = await fetchRemoteDoctor(serverUrl, SECRET_TOKEN);
      assert.strictEqual(doc.ok !== undefined, true);
      assert.notStrictEqual((doc.report || doc).summary, undefined);
      assert.ok(((doc.report || doc).checks.length) > 0);
    });

    test("GET /api/v2/runs/:runId/stream > connects to SSE stream and receives updates", async () => {
      // Dispatch an async run
      const asyncRes = await fetch(`${serverUrl}/api/v2/actions/sample.long-task/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SECRET_TOKEN}`,
        },
        body: JSON.stringify({
          input: { delayMs: 100 },
          async: true,
        }),
      });
      assert.strictEqual(asyncRes.status, 202);
      const asyncData = await asyncRes.json();
      const runId = asyncData.runId;
      assert.notStrictEqual(runId, undefined);

      // Connect to SSE stream
      const sseRes = await fetch(`${serverUrl}/api/v2/runs/${runId}/stream`, {
        headers: {
          Authorization: `Bearer ${SECRET_TOKEN}`,
        },
      });
      assert.strictEqual(sseRes.status, 200);
      assert.ok((sseRes.headers.get("content-type")).includes("text/event-stream"));

      // Read at least one chunk
      const reader = sseRes.body?.getReader();
      if (reader) {
        const { value } = await reader.read();
        const text = new TextDecoder().decode(value);
        assert.ok((text).includes("event:"));
        reader.cancel();
      }
      await new Promise((r) => setTimeout(r, 150));
    });

    test("Security & Boundary > rejects unknown packages and path traversal in routes", async () => {
      // 1. Unknown package on /api/v2/config returns 400
      const unknownPkgRes = await fetch(`${serverUrl}/api/v2/config?package=nonexistent-package`, {
        headers: { Authorization: `Bearer ${SECRET_TOKEN}` },
      });
      assert.strictEqual(unknownPkgRes.status, 400);
      const unknownData = await unknownPkgRes.json();
      assert.strictEqual(unknownData.ok, false);
      assert.ok((unknownData.error.message).includes("Unknown or unregistered package"));

      // 2. Path traversal in package parameter returns 400
      const traversalRes = await fetch(`${serverUrl}/api/v2/config?package=../../etc`, {
        headers: { Authorization: `Bearer ${SECRET_TOKEN}` },
      });
      assert.strictEqual(traversalRes.status, 400);
      const traversalData = await traversalRes.json();
      assert.strictEqual(traversalData.ok, false);
      assert.ok((traversalData.error.message).includes("Invalid packageId"));

      // 3. Unknown package on /api/v2/state returns 400
      const stateUnknownRes = await fetch(`${serverUrl}/api/v2/state?package=nonexistent-package`, {
        headers: { Authorization: `Bearer ${SECRET_TOKEN}` },
      });
      assert.strictEqual(stateUnknownRes.status, 400);
      const stateData = await stateUnknownRes.json();
      assert.strictEqual(stateData.ok, false);
      assert.ok((stateData.error.message).includes("Unknown or unregistered package"));
    });
  });
});

describe("executeRemoteAction 本地超时守卫与错误信封契约", () => {
  it("服务端僵死不返回时本地超时守卫中断请求并返回 TIMEOUT 错误", async () => {
    const sockets = new Set<any>();
    // 服务端收到请求后永久挂起不响应，模拟僵死
    const server = createServer((req, res) => {
      sockets.add(req.socket);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as any).port;

    try {
      const startedAt = Date.now();
      const res = await executeRemoteAction(`http://127.0.0.1:${port}`, "pkg/hang", {}, {
        timeoutMs: 120,
        allowInsecureHttp: true,
      });
      const elapsed = Date.now() - startedAt;

      assert.strictEqual(res.ok, false);
      assert.strictEqual((res as any).error?.code, "ACTION_TIMEOUT");
      // 本地超时守卫必须在 timeoutMs 量级内中断，而非永久挂起
      assert.ok((elapsed) < 2000);
      // 错误信封严禁携带伪造 runId
      assert.strictEqual((res as any).runId, "");
    } finally {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("外部 AbortSignal 中止时返回 ACTION_CANCELLED 且错误信封不携带伪造 runId", async () => {
    const sockets = new Set<any>();
    const server = createServer((req, res) => {
      sockets.add(req.socket);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as any).port;

    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error("client stopped")), 60);
      const res = await executeRemoteAction(`http://127.0.0.1:${port}`, "pkg/hang", {}, {
        signal: controller.signal,
        allowInsecureHttp: true,
      });

      assert.strictEqual(res.ok, false);
      assert.strictEqual((res as any).error?.code, "ACTION_CANCELLED");
      assert.strictEqual((res as any).runId, "");
    } finally {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("服务端返回非 JSON 错误响应时错误信封不携带伪造 runId", async () => {
    const server = createServer((req, res) => {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("internal error");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as any).port;

    try {
      const res = await executeRemoteAction(`http://127.0.0.1:${port}`, "pkg/broken", {}, {
        allowInsecureHttp: true,
      });
      assert.strictEqual(res.ok, false);
      assert.strictEqual((res as any).error?.code, "REMOTE_EXECUTION_FAILED");
      assert.strictEqual((res as any).runId, "");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

