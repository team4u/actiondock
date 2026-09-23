import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
setDefaultTimeout(120000);
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "@actiondock/core";
import { runCliAsync } from "./helpers/run-cli";

let tempHome: string | undefined;

describe("CLI Workflow - Config Management", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-cli-cfg-"));
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-cli-cfg-home-"));
    process.env.ACTIONDOCK_HOME = tempHome;
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
    }
    initProject(tempDir, { id: "team.github-ops", name: "GitHub Ops" });
  });

  afterEach(async () => {
    delete process.env.ACTIONDOCK_HOME;
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
        } catch {}
      }
    }
  });

  it("manages configuration lifecycle: set, get, list, delete, schema, and environment variables", async () => {
    // 6. config set/get/list/delete
    const confSet = await runCliAsync(["config", "set", "SAMPLE_GREETING", "Howdy"], tempDir);
    expect(confSet.exitCode).toBe(0);

    const confGet = await runCliAsync(["config", "get", "SAMPLE_GREETING", "--json"], tempDir);
    expect(confGet.exitCode).toBe(0);
    const confObj = JSON.parse(confGet.stdout.toString());
    expect(confObj.value).toBe("Howdy");

    const confListIntent = await runCliAsync(["config", "list", "--intent", "SAMPLE.*GREETING", "--json"], tempDir);
    expect(confListIntent.exitCode).toBe(0);
    expect(JSON.parse(confListIntent.stdout.toString()).some((c: any) => c.key === "SAMPLE_GREETING")).toBe(true);

    const runWithNewConf = await runCliAsync(
      ["run", "sample.greet", "--input", '{"name": "Cowboy"}', "--json"],
      tempDir
    );
    expect(runWithNewConf.exitCode).toBe(0);
    const runWithNewConfRes = JSON.parse(runWithNewConf.stdout.toString());
    expect(runWithNewConfRes.data.message).toBe("Howdy, Cowboy!");

    // 6b. config from environment variables
    const confDel = await runCliAsync(["config", "delete", "SAMPLE_GREETING"], tempDir);
    expect(confDel.exitCode).toBe(0);

    const confGetEnv = await runCliAsync(
      ["config", "get", "SAMPLE_GREETING", "--json"],
      tempDir,
      { SAMPLE_GREETING: "Bonjour" }
    );
    expect(confGetEnv.exitCode).toBe(0);
    const confEnvObj = JSON.parse(confGetEnv.stdout.toString());
    expect(confEnvObj.value).toBe("Bonjour");
    expect(confEnvObj.source).toBe("env");

    const confSchemaEnv = await runCliAsync(
      ["config", "schema", "--json"],
      tempDir,
      { SAMPLE_GREETING: "Bonjour" }
    );
    expect(confSchemaEnv.exitCode).toBe(0);
    const schemaObj = JSON.parse(confSchemaEnv.stdout.toString());
    const greetingItem = schemaObj.configs.find((c: any) => c.key === "SAMPLE_GREETING");
    expect(greetingItem.source).toBe("env");
    expect(greetingItem.status).toBe("SET");

    // config env --json verification
    const confEnvCheck = await runCliAsync(
      ["config", "env", "--json"],
      tempDir,
      { SAMPLE_GREETING: "Bonjour" }
    );
    expect(confEnvCheck.exitCode).toBe(0);
    const envCheckObj = JSON.parse(confEnvCheck.stdout.toString());
    expect(envCheckObj.ok).toBe(true);
    const greetingEnvItem = envCheckObj.envChecks.find((c: any) => c.key === "SAMPLE_GREETING");
    expect(greetingEnvItem.satisfied).toBe(true);
    expect(greetingEnvItem.matchedEnv).toBe("SAMPLE_GREETING");

    const runWithEnv = await runCliAsync(
      ["run", "sample.greet", "--input", '{"name": "Jean"}', "--json"],
      tempDir,
      { SAMPLE_GREETING: "Bonjour" }
    );
    expect(runWithEnv.exitCode).toBe(0);
    const runWithEnvRes = JSON.parse(runWithEnv.stdout.toString());
    expect(runWithEnvRes.data.message).toBe("Bonjour, Jean!");

    // Restore SQLite config
    const confRestore = await runCliAsync(["config", "set", "SAMPLE_GREETING", "Howdy"], tempDir);
    expect(confRestore.exitCode).toBe(0);
  });
});
