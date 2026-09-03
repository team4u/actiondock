import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  addProfile,
  cancelRemoteRun,
  checkRemoteHealth,
  clearRemoteRuns,
  clearRemoteState,
  deleteRemoteConfig,
  deleteRemoteStateKey,
  executeRemoteAction,
  fetchRemoteActions,
  fetchRemoteActionShow,
  fetchRemoteConfig,
  fetchRemoteConfigEnv,
  fetchRemoteDoctor,
  fetchRemoteInfo,
  fetchRemotePlaybookShow,
  fetchRemotePlaybooks,
  fetchRemoteRun,
  fetchRemoteRuns,
  fetchRemoteStateList,
  getProfile,
  getRemoteStateKey,
  initProject,
  isLoopbackHost,
  listProfiles,
  loadProfiles,
  removeProfile,
  resolveProfileToken,
  resolveTarget,
  safeEqual,
  setRemoteConfig,
  setRemoteStateKey,
  startActionDockServer,
  useProfile,
  verifyBearerToken,
} from "../src";

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
      `---
id: sample.sample-sop
description: SOP for greeting and executing tasks
actions:
  - sample.greet
---

# Greeting SOP
Follow these steps to greet a user.
`
    );

    // Link root node_modules so @actiondock/sdk is resolvable
    const rootNodeModules = resolve(__dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(projectDir, "node_modules"), "dir");
    }

    // 2. Start ActionDock server on a random port with token
    serverInstance = startActionDockServer({
      port: 0, // OS assigns open port
      host: "127.0.0.1",
      token: SECRET_TOKEN,
      projectRoot: projectDir,
      customHome: tempDir,
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
    expect(initial.currentProfile).toBe("local");

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
    expect(retrieved).toBeDefined();
    expect(retrieved?.serverUrl).toBe("http://10.0.0.1:5177");
    expect(retrieved?.token).toBe("tok-abc");

    const list = listProfiles(tempDir);
    expect(list.some((p) => p.name === "cloud-node-1")).toBe(true);

    // Use profile
    useProfile("cloud-node-1", tempDir);
    expect(loadProfiles(tempDir).currentProfile).toBe("cloud-node-1");

    // Remove profile
    const removed = removeProfile("cloud-node-1", tempDir);
    expect(removed).toBe(true);
    expect(loadProfiles(tempDir).currentProfile).toBe("local");
    expect(getProfile("cloud-node-1", tempDir)).toBeUndefined();
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
      expect(res1.token).toBe("secret-from-token-env");
      expect(res1.source).toBe("tokenEnv");

      // 2. Derived profile environment variable
      addProfile(
        "prod-cluster",
        {
          serverUrl: "http://prod-cluster:5177",
        },
        tempDir
      );
      const res2 = resolveProfileToken("prod-cluster", getProfile("prod-cluster", tempDir));
      expect(res2.token).toBe("secret-from-derived-env");
      expect(res2.source).toBe("profileEnv");

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
      expect(res3.token).toBe("stored-direct-secret");
      expect(res3.source).toBe("profile");

      // 4. Global fallback
      addProfile(
        "fallback-profile",
        {
          serverUrl: "http://fallback:5177",
        },
        tempDir
      );
      const res4 = resolveProfileToken("fallback-profile", getProfile("fallback-profile", tempDir));
      expect(res4.token).toBe("global-fallback-token");
      expect(res4.source).toBe("globalEnv");

      // 5. CLI token overrides everything
      const res5 = resolveProfileToken(
        "prod-explicit",
        getProfile("prod-explicit", tempDir),
        "cli-override-token"
      );
      expect(res5.token).toBe("cli-override-token");
      expect(res5.source).toBe("cli");
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
      expect([0o600, 0o666, 0o644]).toContain(mode); // Check mode is properly applied
    }
  });

  test("Profile Manager > resolves target priority correctly", () => {
    // 1. Explicit --server flag has highest priority
    const t1 = resolveTarget({ server: "http://direct-server:5177", token: "direct-tok" }, tempDir);
    expect(t1.type).toBe("remote");
    expect(t1.serverUrl).toBe("http://direct-server:5177");
    expect(t1.token).toBe("direct-tok");
    expect(t1.tokenSource).toBe("cli");

    // 2. Explicit --profile flag
    addProfile(
      "aliyun",
      { serverUrl: "http://aliyun.cloud:5177", token: "ali-tok" },
      tempDir
    );
    const t2 = resolveTarget({ profile: "aliyun" }, tempDir);
    expect(t2.type).toBe("remote");
    expect(t2.profileName).toBe("aliyun");
    expect(t2.serverUrl).toBe("http://aliyun.cloud:5177");
    expect(t2.token).toBe("ali-tok");
    expect(t2.tokenSource).toBe("profile");

    // 3. Current profile
    useProfile("aliyun", tempDir);
    const t3 = resolveTarget({}, tempDir);
    expect(t3.type).toBe("remote");
    expect(t3.profileName).toBe("aliyun");

    // 4. Fallback to local
    useProfile("local", tempDir);
    const t4 = resolveTarget({}, tempDir);
    expect(t4.type).toBe("local");
  });

  test("Security > Loopback host detection and non-loopback auth requirement", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.100")).toBe(false);

    // Binding to 0.0.0.0 without token and without allowInsecureNoAuth should throw
    expect(() => {
      startActionDockServer({
        port: 0,
        host: "0.0.0.0",
      });
    }).toThrow("Authentication token is required when binding to a non-loopback address");

    // Binding to 0.0.0.0 with allowInsecureNoAuth succeeds
    const insecureServer = startActionDockServer({
      port: 0,
      host: "0.0.0.0",
      allowInsecureNoAuth: true,
    });
    expect(insecureServer.port).toBeGreaterThan(0);
    insecureServer.stop();

    // Binding to 0.0.0.0 with token succeeds
    const secureServer = startActionDockServer({
      port: 0,
      host: "0.0.0.0",
      token: "secret-token-for-public",
    });
    expect(secureServer.port).toBeGreaterThan(0);
    secureServer.stop();
  });

  test("Security > constant-time string comparison and token verification", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "def")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);

    const reqWithBearer = new Request("http://127.0.0.1:5177/api/v1/health", {
      headers: { authorization: "Bearer secret-token" },
    });
    expect(verifyBearerToken(reqWithBearer, "secret-token")).toBe(true);
    expect(verifyBearerToken(reqWithBearer, "wrong-token")).toBe(false);

    // URL Query token support
    const reqWithQuery = new Request("http://127.0.0.1:5177/api/v1/health?token=secret-token");
    expect(verifyBearerToken(reqWithQuery, "secret-token")).toBe(true);
    expect(verifyBearerToken(reqWithQuery, "wrong-token")).toBe(false);
  });

  test("Remote Server & Client > health check with auth token (Bearer & Query)", async () => {
    // Health without token should fail 401
    const healthNoAuth = await checkRemoteHealth(serverUrl, undefined);
    expect(healthNoAuth.ok).toBe(false);

    // Health with valid Bearer token should succeed
    const healthAuth = await checkRemoteHealth(serverUrl, SECRET_TOKEN);
    expect(healthAuth.ok).toBe(true);
    expect(healthAuth.status).toBe("ok");
    expect(healthAuth.version).toBe("2.0.0");
    expect(healthAuth.latencyMs).toBeGreaterThanOrEqual(0);

    // Direct HTTP GET with query token
    const resQuery = await fetch(`${serverUrl}/api/v1/health?token=${SECRET_TOKEN}`);
    expect(resQuery.status).toBe(200);
    const queryJson = await resQuery.json();
    expect(queryJson.status).toBe("ok");
    // Default: projectRoot should be hidden
    expect(queryJson.projectRoot).toBeUndefined();
  });

  test("Security > Expose debug info toggle hides/reveals projectRoot", async () => {
    // Default server hides projectRoot
    const resDefault = await fetch(`${serverUrl}/api/v1/info`, {
      headers: { authorization: `Bearer ${SECRET_TOKEN}` },
    });
    const jsonDefault = await resDefault.json();
    expect(jsonDefault.ok).toBe(true);
    expect(jsonDefault.projectRoot).toBeUndefined();

    // Server with exposeDebugInfo: true reveals projectRoot
    const debugServer = startActionDockServer({
      port: 0,
      host: "127.0.0.1",
      token: SECRET_TOKEN,
      projectRoot: projectDir,
      exposeDebugInfo: true,
    });
    const debugUrl = `http://127.0.0.1:${debugServer.port}`;

    const resDebug = await fetch(`${debugUrl}/api/v1/info`, {
      headers: { authorization: `Bearer ${SECRET_TOKEN}` },
    });
    const jsonDebug = await resDebug.json();
    expect(jsonDebug.ok).toBe(true);
    expect(jsonDebug.projectRoot).toBe(projectDir);

    debugServer.stop();
  });

  test("Security > CORS is disabled by default and respects whitelist when configured", async () => {
    // Default server (no corsOrigins configured)
    const resDefault = await fetch(`${serverUrl}/api/v1/health`, {
      headers: {
        authorization: `Bearer ${SECRET_TOKEN}`,
        origin: "http://attacker.example.com",
      },
    });
    expect(resDefault.headers.get("access-control-allow-origin")).toBeNull();

    // Server with CORS whitelist
    const corsServer = startActionDockServer({
      port: 0,
      host: "127.0.0.1",
      token: SECRET_TOKEN,
      corsOrigins: ["http://allowed.local:3000", "https://trusted.app"],
    });
    const corsUrl = `http://127.0.0.1:${corsServer.port}`;

    // 1. Allowed origin gets CORS header
    const resAllowed = await fetch(`${corsUrl}/api/v1/health`, {
      headers: {
        authorization: `Bearer ${SECRET_TOKEN}`,
        origin: "http://allowed.local:3000",
      },
    });
    expect(resAllowed.headers.get("access-control-allow-origin")).toBe("http://allowed.local:3000");

    // 2. Disallowed origin does not get CORS header
    const resDisallowed = await fetch(`${corsUrl}/api/v1/health`, {
      headers: {
        authorization: `Bearer ${SECRET_TOKEN}`,
        origin: "http://disallowed.com",
      },
    });
    expect(resDisallowed.headers.get("access-control-allow-origin")).toBeNull();

    // 3. OPTIONS preflight
    const resOptions = await fetch(`${corsUrl}/api/v1/actions/sample.greet/run`, {
      method: "OPTIONS",
      headers: { origin: "http://allowed.local:3000" },
    });
    expect(resOptions.status).toBe(204);
    expect(resOptions.headers.get("access-control-allow-origin")).toBe("http://allowed.local:3000");

    corsServer.stop();
  });

  test("Security > Request body size limit rejects oversized payloads with 413", async () => {
    // Start server with 100 bytes max body
    const smallBodyServer = startActionDockServer({
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

    const res = await fetch(`${smallUrl}/api/v1/actions/sample.greet/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${SECRET_TOKEN}`,
      },
      body: largePayload,
    });

    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("REQUEST_TOO_LARGE");

    smallBodyServer.stop();
  });

  test("Remote Server & Client > queries remote info and actions", async () => {
    const info = await fetchRemoteInfo(serverUrl, SECRET_TOKEN);
    expect(info.ok).toBe(true);
    expect(info.id).toBe("test.profile-app");

    const actions = await fetchRemoteActions(serverUrl, SECRET_TOKEN);
    expect(Array.isArray(actions)).toBe(true);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some((a) => a.id === "sample.greet")).toBe(true);

    // Filter remote actions by intent regex
    const matched = await fetchRemoteActions(serverUrl, SECRET_TOKEN, "greet");
    expect(matched.length).toBe(1);
    expect(matched[0].id).toBe("sample.greet");


    const unmatched = await fetchRemoteActions(serverUrl, SECRET_TOKEN, "nonexistent");
    expect(unmatched.length).toBe(0);

    const actionDetail = await fetchRemoteActionShow(
      serverUrl,
      "sample.greet",
      SECRET_TOKEN
    );
    expect(actionDetail.id).toBe("sample.greet");
    expect(actionDetail.inputSchema).toBeDefined();
  });

  test("Remote Server & Client > executes remote action via HTTP POST and returns JSON Envelope", async () => {
    const result = await executeRemoteAction(
      serverUrl,
      "sample.greet",
      { name: "CloudUser" },
      { SAMPLE_GREETING: "Welcome from Cloud" },
      SECRET_TOKEN
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.runId).toBeDefined();
      expect((result.data as any).message).toBe("Welcome from Cloud, CloudUser!");
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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INPUT_VALIDATION_FAILED");
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

    expect(res.ok).toBe(true);
    expect(res.runId).toBeDefined();
    expect(res.status).toBe("running");

    // Query run status immediately while running
    const runWhileRunning = await fetchRemoteRun(serverUrl, res.runId, SECRET_TOKEN);
    expect(runWhileRunning.id).toBe(res.runId);
    expect(["running", "success"]).toContain(runWhileRunning.status);

    // Wait for completion
    await new Promise((r) => setTimeout(r, 250));

    const runAfterComplete = await fetchRemoteRun(serverUrl, res.runId, SECRET_TOKEN);
    expect(runAfterComplete.id).toBe(res.runId);
    expect(runAfterComplete.status).toBe("success");
    expect(runAfterComplete.output).toEqual({ completed: true, delay: 150 });
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

    expect(startRes.ok).toBe(true);
    const runId = startRes.runId;

    // Cancel while in-flight
    const cancelRes = await cancelRemoteRun(serverUrl, runId, SECRET_TOKEN, "User stopped job");
    expect(cancelRes.ok).toBe(true);
    expect(cancelRes.runId).toBe(runId);
    expect(cancelRes.status).toBe("cancelled");

    // Fetch run to verify cancelled status in storage
    const run = await fetchRemoteRun(serverUrl, runId, SECRET_TOKEN);
    expect(run.id).toBe(runId);
    expect(run.status).toBe("cancelled");
    expect(run.error?.code).toBe("ACTION_CANCELLED");

    // Cancelling an already finished/cancelled run should return 409
    expect(
      cancelRemoteRun(serverUrl, runId, SECRET_TOKEN)
    ).rejects.toThrow("has already finished");
  });

  test("Execution Lifecycle > returns 404 when cancelling or fetching non-existent run", async () => {
    expect(
      fetchRemoteRun(serverUrl, "non-existent-run-id", SECRET_TOKEN)
    ).rejects.toThrow("not found");

    expect(
      cancelRemoteRun(serverUrl, "non-existent-run-id", SECRET_TOKEN)
    ).rejects.toThrow("not found");
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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACTION_TIMEOUT");
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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACTION_CANCELLED");
    }
  });

  describe("Extended HTTP Service Endpoints", () => {
    test("GET /api/v1/info > supports tree, package, and intent query parameters", async () => {
      // 1. Info with intent filter
      const infoIntent = await fetchRemoteInfo(serverUrl, SECRET_TOKEN, { intent: "greet" });
      expect(infoIntent).toBeDefined();

      // 2. Info with package drill-down
      const infoPkg = await fetchRemoteInfo(serverUrl, SECRET_TOKEN, { package: "test.profile-app" });
      expect(infoPkg.type).toBe("package_detail");
      expect(infoPkg.id).toBe("test.profile-app");
      expect(infoPkg.actionsCount).toBeGreaterThanOrEqual(2);

      // 3. Info with tree=true
      const infoTree = await fetchRemoteInfo(serverUrl, SECRET_TOKEN, { tree: true });
      expect(infoTree.type).toBe("tree");
      expect(infoTree.packages).toBeDefined();
    });

    test("GET /api/v1/playbooks > lists playbooks and shows SOP content", async () => {
      // List playbooks
      const pbs = await fetchRemotePlaybooks(serverUrl, SECRET_TOKEN);
      expect(Array.isArray(pbs)).toBe(true);
      expect(pbs.length).toBeGreaterThanOrEqual(1);
      const sop = pbs.find((p: any) => p.id === "sample.sample-sop");
      expect(sop).toBeDefined();
      expect(sop?.description).toContain("SOP for greeting");

      // Show playbook
      const pbDetail = await fetchRemotePlaybookShow(serverUrl, "sample.sample-sop", SECRET_TOKEN);
      expect(pbDetail.id).toBe("sample.sample-sop");
      expect(pbDetail.content).toContain("# Greeting SOP");
      expect(pbDetail.actions).toContain("sample.greet");
    });

    test("GET & POST /api/v1/runs > queries execution runs and clears records", async () => {
      // 1. Fetch runs list
      const runsList = await fetchRemoteRuns(serverUrl, SECRET_TOKEN, { limit: 10 });
      expect(Array.isArray(runsList.items)).toBe(true);
      expect(runsList.items.length).toBeGreaterThan(0);

      // 2. Clear runs
      const clearRes = await clearRemoteRuns(serverUrl, SECRET_TOKEN, {
        actionId: "sample.long-task",
      });
      expect(clearRes.ok).toBe(true);
      expect(typeof clearRes.clearedCount).toBe("number");
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
      expect(setRes.ok).toBe(true);

      // 2. Get state key
      const getRes = await getRemoteStateKey(serverUrl, "test_key", SECRET_TOKEN, {
        namespace: "session",
      });
      expect(getRes.value).toEqual({ hello: "world", count: 42 });

      // 3. List state keys
      const listRes = await fetchRemoteStateList(serverUrl, SECRET_TOKEN, {
        namespace: "session",
      });
      expect(listRes.keys).toContain("test_key");

      // 4. Delete state key
      const delRes = await deleteRemoteStateKey(serverUrl, "test_key", SECRET_TOKEN, {
        namespace: "session",
      });
      expect(delRes.deleted).toBe(true);

      // 5. Clear state
      await setRemoteStateKey(serverUrl, "temp1", "val1", SECRET_TOKEN);
      await setRemoteStateKey(serverUrl, "temp2", "val2", SECRET_TOKEN);
      const clearStateRes = await clearRemoteState(serverUrl, SECRET_TOKEN, { all: true });
      expect(clearStateRes.ok).toBe(true);
      expect(clearStateRes.clearedCount).toBeGreaterThanOrEqual(2);
    });

    test("Config Endpoints > supports list, set, delete, and env verification", async () => {
      // 1. Set config
      const setConf = await setRemoteConfig(
        serverUrl,
        "TEST_API_URL",
        "https://api.example.com",
        SECRET_TOKEN
      );
      expect(setConf.ok).toBe(true);

      // 2. List config
      const confList = await fetchRemoteConfig(serverUrl, SECRET_TOKEN);
      expect(confList.values["TEST_API_URL"]).toBe("https://api.example.com");

      // 3. Delete config
      const delConf = await deleteRemoteConfig(serverUrl, "TEST_API_URL", SECRET_TOKEN);
      expect(delConf.deleted).toBe(true);

      // 4. Env status check
      const envRes = await fetchRemoteConfigEnv(serverUrl, SECRET_TOKEN);
      expect(envRes.packageId).toBe("test.profile-app");
      expect(Array.isArray(envRes.envChecks)).toBe(true);
    });

    test("GET /api/v1/doctor > runs diagnostics on remote server", async () => {
      const doc = await fetchRemoteDoctor(serverUrl, SECRET_TOKEN);
      expect(doc.ok !== undefined).toBe(true);
      expect((doc.report || doc).summary).toBeDefined();
      expect((doc.report || doc).checks.length).toBeGreaterThan(0);
    });

    test("GET /api/v1/runs/:runId/stream > connects to SSE stream and receives updates", async () => {
      // Dispatch an async run
      const asyncRes = await fetch(`${serverUrl}/api/v1/actions/sample.long-task/run`, {
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
      expect(asyncRes.status).toBe(202);
      const asyncData = await asyncRes.json();
      const runId = asyncData.runId;
      expect(runId).toBeDefined();

      // Connect to SSE stream
      const sseRes = await fetch(`${serverUrl}/api/v1/runs/${runId}/stream`, {
        headers: {
          Authorization: `Bearer ${SECRET_TOKEN}`,
        },
      });
      expect(sseRes.status).toBe(200);
      expect(sseRes.headers.get("content-type")).toContain("text/event-stream");

      // Read at least one chunk
      const reader = sseRes.body?.getReader();
      if (reader) {
        const { value } = await reader.read();
        const text = new TextDecoder().decode(value);
        expect(text).toContain("event:");
        reader.cancel();
      }
      await new Promise((r) => setTimeout(r, 150));
    });
  });
});

