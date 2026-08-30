import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
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
  listProfiles,
  loadProfiles,
  removeProfile,
  resolveTarget,
  startActionDockServer,
  useProfile,
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

    // Add profile
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

  test("Profile Manager > resolves target priority correctly", () => {
    // 1. Explicit --server flag has highest priority
    const t1 = resolveTarget({ server: "http://direct-server:5177", token: "direct-tok" }, tempDir);
    expect(t1.type).toBe("remote");
    expect(t1.serverUrl).toBe("http://direct-server:5177");
    expect(t1.token).toBe("direct-tok");

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

  test("Remote Server & Client > health check with auth token", async () => {
    // Health without token should fail 401
    const healthNoAuth = await checkRemoteHealth(serverUrl, undefined);
    expect(healthNoAuth.ok).toBe(false);

    // Health with valid token should succeed
    const healthAuth = await checkRemoteHealth(serverUrl, SECRET_TOKEN);
    expect(healthAuth.ok).toBe(true);
    expect(healthAuth.status).toBe("ok");
    expect(healthAuth.version).toBe("2.0.0");
    expect(healthAuth.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("Remote Server & Client > queries remote info and actions", async () => {
    const info = await fetchRemoteInfo(serverUrl, SECRET_TOKEN);
    expect(info.ok).toBe(true);
    expect(info.id).toBe("test.profile-app");

    const actions = await fetchRemoteActions(serverUrl, SECRET_TOKEN);
    expect(Array.isArray(actions)).toBe(true);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].id).toBe("sample.greet");

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
