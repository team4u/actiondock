import { runCommandSync, startCommand } from "../../../scripts/lib/spawn-helper.mjs";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
// Windows 下端到端流程会多次冷启动 Bun 子进程，默认 5s 超时不够

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pkg from "../package.json";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");

let tempHome: string | undefined;

function runCli(args: string[], cwd?: string, env?: Record<string, string>) {
  return runCommandSync(["bun", cliPath, ...args], {
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
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
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

  it("manages execution profiles and dispatches remote runs via ad serve", { timeout: 120000 }, async () => {
    // 1. Initialize project in tempDir
    runCli(["init", "--id", "cloud.remote-node", "."], tempDir);

    // 2. Start HTTP server process via 'ad serve'
    const SECRET = "auth-token-xyz-987";
    const port = 5199;
    const serverUrl = `http://127.0.0.1:${port}`;
    const serverHome = mkdtempSync(join(tmpdir(), "actiondock-server-home-"));

    const serveProc = startCommand(
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
      assert.strictEqual(addProfileProc.exitCode, 0);
      assert.ok((addProfileProc.stdout.toString()).includes("[OK] Profile 'cloud-aliyun' configured"));

      // Add profile with --token-env
      const addTokenEnvProc = runCli(
        ["profile", "add", "cloud-token-env", "--server", serverUrl, "--token-env", "REMOTE_TEST_TOKEN", "--desc", "Token Env Node"],
        tmpdir(),
        env
      );
      assert.strictEqual(addTokenEnvProc.exitCode, 0);
      assert.ok((addTokenEnvProc.stdout.toString()).includes("[OK] Profile 'cloud-token-env' configured"));

      const showProfileProc = runCli(["profile", "show", "cloud-aliyun", "--json"], tmpdir(), env);
      assert.strictEqual(showProfileProc.exitCode, 0);
      const profileData = JSON.parse(showProfileProc.stdout.toString());
      assert.strictEqual(profileData.name, "cloud-aliyun");
      assert.strictEqual(profileData.serverUrl, serverUrl);
      assert.strictEqual(profileData.tokenConfigured, true);
      assert.strictEqual(profileData.tokenSource, "profile");
      assert.strictEqual(profileData.token, "********");

      const showRevealProc = runCli(["profile", "show", "cloud-aliyun", "--reveal", "--json"], tmpdir(), env);
      assert.strictEqual(showRevealProc.exitCode, 0);
      const revealData = JSON.parse(showRevealProc.stdout.toString());
      assert.strictEqual(revealData.token, SECRET);

      const showTokenEnvProc = runCli(
        ["profile", "show", "cloud-token-env", "--reveal", "--json"],
        tmpdir(),
        { ...env, REMOTE_TEST_TOKEN: SECRET }
      );
      assert.strictEqual(showTokenEnvProc.exitCode, 0);
      const tokenEnvData = JSON.parse(showTokenEnvProc.stdout.toString());
      assert.strictEqual(tokenEnvData.tokenSource, "tokenEnv");
      assert.strictEqual(tokenEnvData.token, SECRET);

      const listProfileProc = runCli(["profile", "list", "--json"], tmpdir(), env);
      assert.strictEqual(listProfileProc.exitCode, 0);
      const listProfilesData = JSON.parse(listProfileProc.stdout.toString());
      assert.strictEqual(listProfilesData.some((p: any) => p.name === "cloud-aliyun"), true);
      assert.strictEqual(listProfilesData.some((p: any) => p.name === "cloud-token-env"), true);

      const listProfileIntent = runCli(["profile", "list", "--intent", "aliyun|tencent", "--json"], tmpdir(), env);
      assert.strictEqual(listProfileIntent.exitCode, 0);
      assert.strictEqual(JSON.parse(listProfileIntent.stdout.toString()).some((p: any) => p.name === "cloud-aliyun"), true);

      // 4. Test connection via ad profile test
      const testProc = runCli(["profile", "test", "cloud-aliyun", "--json"], tmpdir(), env);
      assert.strictEqual(testProc.exitCode, 0);
      const testResult = JSON.parse(testProc.stdout.toString());
      assert.strictEqual(testResult.ok, true);
      assert.ok((["ok", "healthy"]).includes(testResult.status));

      // 5. Query remote actions and info via --profile
      const remoteInfoProc = runCli(["info", "--profile", "cloud-aliyun", "--json"], tmpdir(), env);
      assert.strictEqual(remoteInfoProc.exitCode, 0);
      const remoteInfo = JSON.parse(remoteInfoProc.stdout.toString());
      assert.strictEqual(remoteInfo.id, "cloud.remote-node");

      const remoteListProc = runCli(["list", "--profile", "cloud-aliyun", "--json"], tmpdir(), env);
      assert.strictEqual(remoteListProc.exitCode, 0);
      const remoteActions = JSON.parse(remoteListProc.stdout.toString());
      assert.strictEqual(remoteActions.items.some((a: any) => a.id === "sample.greet"), true);

      const remoteListIntentProc = runCli(
        ["list", "--profile", "cloud-aliyun", "--intent", "sample.greet", "--json"],
        tmpdir(),
        env
      );
      assert.strictEqual(remoteListIntentProc.exitCode, 0);
      assert.strictEqual(JSON.parse(remoteListIntentProc.stdout.toString()).items.length, 1);

      // 机器模式（--json）无匹配且未显式 --fallback 时不回退：返回空集
      const remoteListNoMatchProc = runCli(
        ["list", "--profile", "cloud-aliyun", "--intent", "nomatch-xyz", "--json"],
        tmpdir(),
        env
      );
      assert.strictEqual(remoteListNoMatchProc.exitCode, 0);
      assert.deepStrictEqual(JSON.parse(remoteListNoMatchProc.stdout.toString()).items, []);

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
          "--json",
        ],
        tmpdir(),
        env
      );
      assert.strictEqual(remoteRunProc.exitCode, 0);
      const runResult = JSON.parse(remoteRunProc.stdout.toString());
      assert.strictEqual(runResult.ok, true);
      assert.notStrictEqual(runResult.runId, undefined);
      assert.strictEqual(runResult.data.message, "Greetings from Cloud, RemoteAgent!");

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
          "--json",
        ],
        tmpdir(),
        env
      );
      assert.strictEqual(remoteAsyncProc.exitCode, 0);
      const asyncRunResult = JSON.parse(remoteAsyncProc.stdout.toString());
      assert.strictEqual(asyncRunResult.ok, true);
      assert.notStrictEqual(asyncRunResult.runId, undefined);
      assert.strictEqual(asyncRunResult.status, "running");

      // Query remote run via ad runs show --profile
      const remoteShowProc = runCli(
        ["runs", "show", asyncRunResult.runId, "--profile", "cloud-aliyun", "--json"],
        tmpdir(),
        env
      );
      assert.strictEqual(remoteShowProc.exitCode, 0);
      const remoteRunRecord = JSON.parse(remoteShowProc.stdout.toString());
      assert.strictEqual(remoteRunRecord.id, asyncRunResult.runId);

      // Cancel remote run via ad runs cancel --profile
      const remoteCancelProc = runCli(
        ["runs", "cancel", asyncRunResult.runId, "--profile", "cloud-aliyun", "--json"],
        tmpdir(),
        env
      );
      // It might be 0 if cancelled or 1 if already finished by the time CLI ran
      assert.ok(([0, 1]).includes(remoteCancelProc.exitCode));

      // 7. Remove profile
      const rmProc = runCli(["profile", "rm", "cloud-aliyun"], tmpdir(), env);
      assert.strictEqual(rmProc.exitCode, 0);
      assert.ok((rmProc.stdout.toString()).includes("[OK] Profile 'cloud-aliyun' removed"));

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
  });

  it("links workspace directory and unlinks via CLI", () => {
    const wsHome = mkdtempSync(join(tmpdir(), "actiondock-link-home-"));
    const wsDir = mkdtempSync(join(tmpdir(), "actiondock-ws-"));
    const env = { ACTIONDOCK_HOME: wsHome, HOME: wsHome };
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");

    try {
      const sub1 = join(wsDir, "packages", "pkg1");
      const sub2 = join(wsDir, "packages", "pkg2");

      const init1 = runCli(["init", "--id", "team.link-sub1", "--name", "Sub 1", sub1], wsDir, env);
      assert.strictEqual(init1.exitCode, 0);
      const init2 = runCli(["init", "--id", "team.link-sub2", "--name", "Sub 2", sub2], wsDir, env);
      assert.strictEqual(init2.exitCode, 0);

      if (existsSync(rootNodeModules)) {
        symlinkSync(rootNodeModules, join(sub1, "node_modules"), "junction");
        symlinkSync(rootNodeModules, join(sub2, "node_modules"), "junction");
      }

      // Link the workspace root
      const linkProc = runCli(["link", wsDir], tmpdir(), env);
      assert.strictEqual(linkProc.exitCode, 0);
      const linkOut = linkProc.stdout.toString();
      assert.ok((linkOut).includes("Linked workspace"));
      assert.ok((linkOut).includes("team.link-sub1"));
      assert.ok((linkOut).includes("team.link-sub2"));

      // Test ad info (default behavior maintains summary list)
      const infoProc = runCli(["info"], tmpdir(), env);
      assert.strictEqual(infoProc.exitCode, 0);
      assert.ok((infoProc.stdout.toString()).includes("ActionDock Linked Packages"));
      assert.ok((infoProc.stdout.toString()).includes("team.link-sub1"));

      // Test ad info --tree (hierarchical tree view)
      const treeProc = runCli(["info", "--tree"], tmpdir(), env);
      assert.strictEqual(treeProc.exitCode, 0);
      assert.ok((treeProc.stdout.toString()).includes("ActionDock Workspace & Package Tree"));
      assert.ok((treeProc.stdout.toString()).includes("team.link-sub1"));
      assert.ok((treeProc.stdout.toString()).includes("Workspaces:"));

      // Test ad info --tree --json
      const treeJsonProc = runCli(["info", "--tree", "--json"], tmpdir(), env);
      assert.strictEqual(treeJsonProc.exitCode, 0);
      const treeJson = JSON.parse(treeJsonProc.stdout.toString());
      assert.strictEqual(treeJson.workspaces.length, 1);
      assert.strictEqual(treeJson.totalPackagesCount, 2);

      // Test ad doctor --json
      const doctorProc = runCli(["doctor", "--json"], sub1, env);
      assert.strictEqual(doctorProc.exitCode, 0);
      const doctorData = JSON.parse(doctorProc.stdout.toString());
      assert.strictEqual(doctorData.ok, true);
      assert.strictEqual(doctorData.hasProject, true);
      assert.strictEqual(doctorData.packageId, "team.link-sub1");

      // Delete sub2 directory to simulate stale link and test prune
      rmSync(sub2, { recursive: true, force: true });
      const pruneProc = runCli(["unlink", "--prune"], tmpdir(), env);
      assert.strictEqual(pruneProc.exitCode, 0);
      assert.ok((pruneProc.stdout.toString()).includes("[OK]"));

      // Unlink workspace
      const unlinkProc = runCli(["unlink", wsDir], tmpdir(), env);
      assert.strictEqual(unlinkProc.exitCode, 0);
      assert.ok((unlinkProc.stdout.toString()).includes("Unlinked workspace"));

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
      assert.strictEqual(infoProc.exitCode, 0);
      const info = JSON.parse(infoProc.stdout.toString());
      assert.strictEqual(info.id, "team.no-manifest");
      assert.strictEqual(info.actions.length, 0);
      assert.strictEqual(existsSync(join(noManifestDir, "node_modules")), false);

      const actionListProc = runCli(["list", "--json"], noManifestDir);
      assert.strictEqual(actionListProc.exitCode, 0);
      const actionList = JSON.parse(actionListProc.stdout.toString());
      assert.strictEqual(actionList.items.length, 0);
      assert.strictEqual(existsSync(join(noManifestDir, "node_modules")), false);

      const doctorProc = runCli(["doctor", "--json"], noManifestDir);
      assert.strictEqual(doctorProc.exitCode, 0);
      assert.strictEqual(existsSync(join(noManifestDir, "node_modules")), false);

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
      assert.strictEqual(infoWithManifestProc.exitCode, 0);
      const infoWithManifest = JSON.parse(infoWithManifestProc.stdout.toString());
      assert.strictEqual(infoWithManifest.actions.length, 1);
      assert.strictEqual(infoWithManifest.actions[0].id, "team.foo");
      assert.strictEqual(existsSync(join(noManifestDir, "node_modules")), false);

      const actionListWithManifestProc = runCli(["list", "--json"], noManifestDir);
      assert.strictEqual(actionListWithManifestProc.exitCode, 0);
      const actionListWithManifest = JSON.parse(actionListWithManifestProc.stdout.toString());
      assert.strictEqual(actionListWithManifest.items.length, 1);
      assert.strictEqual(actionListWithManifest.items[0].id, "team.foo");
      assert.strictEqual(existsSync(join(noManifestDir, "node_modules")), false);

      const actionShowProc = runCli(["describe", "team.foo", "--json"], noManifestDir);
      assert.strictEqual(actionShowProc.exitCode, 0);
      const actionShow = JSON.parse(actionShowProc.stdout.toString());
      assert.strictEqual(actionShow.id, "team.foo");
      assert.strictEqual(actionShow.description, "Test action foo");
      assert.strictEqual(existsSync(join(noManifestDir, "node_modules")), false);

      const doctorWithManifestProc = runCli(["doctor", "--json"], noManifestDir);
      assert.strictEqual(doctorWithManifestProc.exitCode, 0);
      assert.strictEqual(existsSync(join(noManifestDir, "node_modules")), false);
    } finally {
      if (existsSync(noManifestDir)) {
        rmSync(noManifestDir, { recursive: true, force: true });
      }
    }
  });
});
