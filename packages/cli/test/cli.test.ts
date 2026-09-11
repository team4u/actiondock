import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
// Windows 下端到端流程会多次冷启动 Bun 子进程，默认 5s 超时不够
setDefaultTimeout(120000);
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pkg from "../package.json";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");

let tempHome: string | undefined;

function runCli(args: string[], cwd?: string, env?: Record<string, string>) {
  return Bun.spawnSync(["bun", cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("CLI End-to-End", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-cli-e2e-"));
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-cli-e2e-home-"));
    // Link root node_modules so @actiondock/sdk is available
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "dir");
    }
  });

  afterEach(async () => {
    if (tempHome && existsSync(tempHome)) {
      try {
        rmSync(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {}
      tempHome = undefined;
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

  it("manages execution profiles and dispatches remote runs via ad serve", async () => {
    // 1. Initialize project in tempDir
    runCli(["init", "--id", "cloud.remote-node", "."], tempDir);

    // 2. Start HTTP server process via 'ad serve'
    const SECRET = "auth-token-xyz-987";
    const port = 5199;
    const serverUrl = `http://127.0.0.1:${port}`;
    const serverHome = mkdtempSync(join(tmpdir(), "actiondock-server-home-"));

    const serveProc = Bun.spawn(
      ["bun", cliPath, "serve", "--port", String(port), "--host", "127.0.0.1", "--token", SECRET],
      {
        cwd: tempDir,
        env: {
          ...process.env,
          ACTIONDOCK_HOME: serverHome,
        },
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    // Give server 150ms to bind port
    await new Promise((r) => setTimeout(r, 150));

    const clientHome = mkdtempSync(join(tmpdir(), "actiondock-client-home-"));
    const env = { ACTIONDOCK_HOME: clientHome };

    try {
      // 3. Profile management commands
      const addProfileProc = runCli(
        ["profile", "add", "cloud-aliyun", "--server", serverUrl, "--token", SECRET, "--desc", "Aliyun Node 1"],
        tmpdir(),
        env
      );
      expect(addProfileProc.exitCode).toBe(0);
      expect(addProfileProc.stdout.toString()).toContain("[OK] Profile 'cloud-aliyun' configured");

      // Add profile with --token-env
      const addTokenEnvProc = runCli(
        ["profile", "add", "cloud-token-env", "--server", serverUrl, "--token-env", "REMOTE_TEST_TOKEN", "--desc", "Token Env Node"],
        tmpdir(),
        env
      );
      expect(addTokenEnvProc.exitCode).toBe(0);
      expect(addTokenEnvProc.stdout.toString()).toContain("[OK] Profile 'cloud-token-env' configured");

      const showProfileProc = runCli(["profile", "show", "cloud-aliyun", "--json"], tmpdir(), env);
      expect(showProfileProc.exitCode).toBe(0);
      const profileData = JSON.parse(showProfileProc.stdout.toString());
      expect(profileData.name).toBe("cloud-aliyun");
      expect(profileData.serverUrl).toBe(serverUrl);
      expect(profileData.tokenConfigured).toBe(true);
      expect(profileData.tokenSource).toBe("profile");
      expect(profileData.token).toBe("********");

      const showRevealProc = runCli(["profile", "show", "cloud-aliyun", "--reveal", "--json"], tmpdir(), env);
      expect(showRevealProc.exitCode).toBe(0);
      const revealData = JSON.parse(showRevealProc.stdout.toString());
      expect(revealData.token).toBe(SECRET);

      const showTokenEnvProc = runCli(
        ["profile", "show", "cloud-token-env", "--reveal", "--json"],
        tmpdir(),
        { ...env, REMOTE_TEST_TOKEN: SECRET }
      );
      expect(showTokenEnvProc.exitCode).toBe(0);
      const tokenEnvData = JSON.parse(showTokenEnvProc.stdout.toString());
      expect(tokenEnvData.tokenSource).toBe("tokenEnv");
      expect(tokenEnvData.token).toBe(SECRET);

      const listProfileProc = runCli(["profile", "list", "--json"], tmpdir(), env);
      expect(listProfileProc.exitCode).toBe(0);
      const listProfilesData = JSON.parse(listProfileProc.stdout.toString());
      expect(listProfilesData.some((p: any) => p.name === "cloud-aliyun")).toBe(true);
      expect(listProfilesData.some((p: any) => p.name === "cloud-token-env")).toBe(true);

      const listProfileIntent = runCli(["profile", "list", "--intent", "aliyun|tencent", "--json"], tmpdir(), env);
      expect(listProfileIntent.exitCode).toBe(0);
      expect(JSON.parse(listProfileIntent.stdout.toString()).some((p: any) => p.name === "cloud-aliyun")).toBe(true);

      // 4. Test connection via ad profile test
      const testProc = runCli(["profile", "test", "cloud-aliyun", "--json"], tmpdir(), env);
      expect(testProc.exitCode).toBe(0);
      const testResult = JSON.parse(testProc.stdout.toString());
      expect(testResult.ok).toBe(true);
      expect(["ok", "healthy"]).toContain(testResult.status);

      // 5. Query remote actions and info via --profile
      const remoteInfoProc = runCli(["info", "--profile", "cloud-aliyun", "--json"], tmpdir(), env);
      expect(remoteInfoProc.exitCode).toBe(0);
      const remoteInfo = JSON.parse(remoteInfoProc.stdout.toString());
      expect(remoteInfo.id).toBe("cloud.remote-node");

      const remoteListProc = runCli(["list", "--profile", "cloud-aliyun", "--json"], tmpdir(), env);
      expect(remoteListProc.exitCode).toBe(0);
      const remoteActions = JSON.parse(remoteListProc.stdout.toString());
      expect(remoteActions.some((a: any) => a.id === "sample.greet")).toBe(true);

      const remoteListIntentProc = runCli(
        ["list", "--profile", "cloud-aliyun", "--intent", "sample\\.greet", "--json"],
        tmpdir(),
        env
      );
      expect(remoteListIntentProc.exitCode).toBe(0);
      expect(JSON.parse(remoteListIntentProc.stdout.toString()).length).toBe(1);

      // 6. Execute action on remote server via ad run --profile
      const remoteRunProc = runCli(
        [
          "run",
          "sample.greet",
          "--profile",
          "cloud-aliyun",
          "--input",
          '{"name": "RemoteAgent"}',
          "--config",
          "SAMPLE_GREETING=Greetings from Cloud",
        ],
        tmpdir(),
        env
      );
      expect(remoteRunProc.exitCode).toBe(0);
      const runResult = JSON.parse(remoteRunProc.stdout.toString());
      expect(runResult.ok).toBe(true);
      expect(runResult.runId).toBeDefined();
      expect(runResult.data.message).toBe("Greetings from Cloud, RemoteAgent!");

      // 6b. Remote Async Run & Remote Runs Show & Remote Runs Cancel
      const remoteAsyncProc = runCli(
        [
          "run",
          "sample.greet",
          "--profile",
          "cloud-aliyun",
          "--input",
          '{"name": "AsyncAgent"}',
          "--async",
        ],
        tmpdir(),
        env
      );
      expect(remoteAsyncProc.exitCode).toBe(0);
      const asyncRunResult = JSON.parse(remoteAsyncProc.stdout.toString());
      expect(asyncRunResult.ok).toBe(true);
      expect(asyncRunResult.runId).toBeDefined();
      expect(asyncRunResult.status).toBe("running");

      // Query remote run via ad runs show --profile
      const remoteShowProc = runCli(
        ["runs", "show", asyncRunResult.runId, "--profile", "cloud-aliyun", "--json"],
        tmpdir(),
        env
      );
      expect(remoteShowProc.exitCode).toBe(0);
      const remoteRunRecord = JSON.parse(remoteShowProc.stdout.toString());
      expect(remoteRunRecord.id).toBe(asyncRunResult.runId);

      // Cancel remote run via ad runs cancel --profile
      const remoteCancelProc = runCli(
        ["runs", "cancel", asyncRunResult.runId, "--profile", "cloud-aliyun", "--json"],
        tmpdir(),
        env
      );
      // It might be 0 if cancelled or 1 if already finished by the time CLI ran
      expect([0, 1]).toContain(remoteCancelProc.exitCode);

      // 7. Remove profile
      const rmProc = runCli(["profile", "rm", "cloud-aliyun"], tmpdir(), env);
      expect(rmProc.exitCode).toBe(0);
      expect(rmProc.stdout.toString()).toContain("[OK] Profile 'cloud-aliyun' removed");

    } finally {
      try {
        serveProc.kill("SIGKILL");
      } catch {}
      await serveProc.exited.catch(() => {});
      if (existsSync(serverHome)) {
        try {
          rmSync(serverHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch {
          // Ignore
        }
      }
      if (existsSync(clientHome)) {
        try {
          rmSync(clientHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch {
          // Ignore
        }
      }
    }
  }, 120000);

  it("links workspace directory and unlinks via CLI", () => {
    const wsHome = mkdtempSync(join(tmpdir(), "actiondock-link-home-"));
    const wsDir = mkdtempSync(join(tmpdir(), "actiondock-ws-"));
    const env = { ACTIONDOCK_HOME: wsHome, HOME: wsHome };
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");

    try {
      const sub1 = join(wsDir, "packages", "pkg1");
      const sub2 = join(wsDir, "packages", "pkg2");

      const init1 = runCli(["init", "--id", "team.link-sub1", "--name", "Sub 1", sub1], wsDir, env);
      expect(init1.exitCode).toBe(0);
      const init2 = runCli(["init", "--id", "team.link-sub2", "--name", "Sub 2", sub2], wsDir, env);
      expect(init2.exitCode).toBe(0);

      if (existsSync(rootNodeModules)) {
        symlinkSync(rootNodeModules, join(sub1, "node_modules"), "dir");
        symlinkSync(rootNodeModules, join(sub2, "node_modules"), "dir");
      }

      // Link the workspace root
      const linkProc = runCli(["link", wsDir], tmpdir(), env);
      expect(linkProc.exitCode).toBe(0);
      const linkOut = linkProc.stdout.toString();
      expect(linkOut).toContain("Linked workspace");
      expect(linkOut).toContain("team.link-sub1");
      expect(linkOut).toContain("team.link-sub2");

      // Test ad info (default behavior maintains summary list)
      const infoProc = runCli(["info"], tmpdir(), env);
      expect(infoProc.exitCode).toBe(0);
      expect(infoProc.stdout.toString()).toContain("ActionDock Linked Packages");
      expect(infoProc.stdout.toString()).toContain("team.link-sub1");

      // Test ad info --tree (hierarchical tree view)
      const treeProc = runCli(["info", "--tree"], tmpdir(), env);
      expect(treeProc.exitCode).toBe(0);
      expect(treeProc.stdout.toString()).toContain("ActionDock Workspace & Package Tree");
      expect(treeProc.stdout.toString()).toContain("team.link-sub1");
      expect(treeProc.stdout.toString()).toContain("Workspaces:");

      // Test ad info --tree --json
      const treeJsonProc = runCli(["info", "--tree", "--json"], tmpdir(), env);
      expect(treeJsonProc.exitCode).toBe(0);
      const treeJson = JSON.parse(treeJsonProc.stdout.toString());
      expect(treeJson.workspaces.length).toBe(1);
      expect(treeJson.totalPackagesCount).toBe(2);

      // Test ad doctor --json
      const doctorProc = runCli(["doctor", "--json"], sub1, env);
      expect(doctorProc.exitCode).toBe(0);
      const doctorData = JSON.parse(doctorProc.stdout.toString());
      expect(doctorData.ok).toBe(true);
      expect(doctorData.hasProject).toBe(true);
      expect(doctorData.packageId).toBe("team.link-sub1");

      // Delete sub2 directory to simulate stale link and test prune
      rmSync(sub2, { recursive: true, force: true });
      const pruneProc = runCli(["unlink", "--prune"], tmpdir(), env);
      expect(pruneProc.exitCode).toBe(0);
      expect(pruneProc.stdout.toString()).toContain("[OK]");

      // Unlink workspace
      const unlinkProc = runCli(["unlink", wsDir], tmpdir(), env);
      expect(unlinkProc.exitCode).toBe(0);
      expect(unlinkProc.stdout.toString()).toContain("Unlinked workspace");

    } finally {
      if (existsSync(wsHome)) {
        rmSync(wsHome, { recursive: true, force: true });
      }
      if (existsSync(wsDir)) {
        rmSync(wsDir, { recursive: true, force: true });
      }
    }
  });

  it("info does not auto install dependencies and does not import actions when manifest is absent", () => {
    const noManifestDir = join(tmpdir(), `ad-cli-no-manifest-${Date.now()}`);
    mkdirSync(join(noManifestDir, "actions"), { recursive: true });

    try {
      writeFileSync(
        join(noManifestDir, "actiondock.json"),
        JSON.stringify({
          id: "team.no-manifest",
          name: "No Manifest",
          version: "1.0.0",
          actionsDir: "actions",
        }),
        "utf-8"
      );

      writeFileSync(
        join(noManifestDir, "package.json"),
        JSON.stringify({
          name: "team.no-manifest",
          version: "1.0.0",
          dependencies: {
            "non-existent-pkg-xyz": "^1.0.0",
          },
        }),
        "utf-8"
      );

      writeFileSync(
        join(noManifestDir, "actions", "foo.ts"),
        `import { defineAction } from "@actiondock/sdk";\nexport default defineAction({ id: "team.foo", run: async () => ({}) });\n`,
        "utf-8"
      );

      const infoProc = runCli(["info", "--json"], noManifestDir);
      expect(infoProc.exitCode).toBe(0);
      const info = JSON.parse(infoProc.stdout.toString());
      expect(info.id).toBe("team.no-manifest");
      expect(info.actionsCount).toBe(0);
      expect(info.actions.length).toBe(0);
      expect(existsSync(join(noManifestDir, "node_modules"))).toBe(false);

      const actionListProc = runCli(["list", "--json"], noManifestDir);
      expect(actionListProc.exitCode).toBe(0);
      const actionList = JSON.parse(actionListProc.stdout.toString());
      expect(actionList.length).toBe(0);
      expect(existsSync(join(noManifestDir, "node_modules"))).toBe(false);

      const doctorProc = runCli(["doctor", "--json"], noManifestDir);
      expect(doctorProc.exitCode).toBe(0);
      expect(existsSync(join(noManifestDir, "node_modules"))).toBe(false);

      writeFileSync(
        join(noManifestDir, "actiondock.json"),
        JSON.stringify({
          $schema: "https://actiondock.dev/schema/v2/actiondock.json",
          id: "team.no-manifest",
          name: "No Manifest",
          version: "1.0.0",
          actionsDir: "actions",
          actions: {
            "team.foo": {
              entry: "actions/foo.ts",
              description: "Test action foo",
              inputSchema: { type: "object" },
              outputSchema: { type: "object" },
            },
          },
        }),
        "utf-8"
      );

      const infoWithManifestProc = runCli(["info", "--json"], noManifestDir);
      expect(infoWithManifestProc.exitCode).toBe(0);
      const infoWithManifest = JSON.parse(infoWithManifestProc.stdout.toString());
      expect(infoWithManifest.actionsCount).toBe(1);
      expect(infoWithManifest.actions).toEqual(["team.foo"]);
      expect(existsSync(join(noManifestDir, "node_modules"))).toBe(false);

      const actionListWithManifestProc = runCli(["list", "--json"], noManifestDir);
      expect(actionListWithManifestProc.exitCode).toBe(0);
      const actionListWithManifest = JSON.parse(actionListWithManifestProc.stdout.toString());
      expect(actionListWithManifest.length).toBe(1);
      expect(actionListWithManifest[0].id).toBe("team.foo");
      expect(existsSync(join(noManifestDir, "node_modules"))).toBe(false);

      const actionShowProc = runCli(["describe", "team.foo", "--json"], noManifestDir);
      expect(actionShowProc.exitCode).toBe(0);
      const actionShow = JSON.parse(actionShowProc.stdout.toString());
      expect(actionShow.id).toBe("team.foo");
      expect(actionShow.description).toBe("Test action foo");
      expect(existsSync(join(noManifestDir, "node_modules"))).toBe(false);

      const doctorWithManifestProc = runCli(["doctor", "--json"], noManifestDir);
      expect(doctorWithManifestProc.exitCode).toBe(0);
      expect(existsSync(join(noManifestDir, "node_modules"))).toBe(false);
    } finally {
      if (existsSync(noManifestDir)) {
        rmSync(noManifestDir, { recursive: true, force: true });
      }
    }
  });
});
