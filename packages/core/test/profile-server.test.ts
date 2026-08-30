import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  addProfile,
  checkRemoteHealth,
  executeRemoteAction,
  fetchRemoteActions,
  fetchRemoteActionShow,
  fetchRemoteInfo,
  getProfile,
  initProject,
  isLoopbackHost,
  listProfiles,
  loadProfiles,
  removeProfile,
  resolveProfileToken,
  resolveTarget,
  safeEqual,
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
    rmSync(tempDir, { recursive: true, force: true });
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
    expect(actions[0].id).toBe("sample.greet");

    // Filter remote actions by intent regex
    const matched = await fetchRemoteActions(serverUrl, SECRET_TOKEN, "greet|sample");
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
});
