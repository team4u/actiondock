import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
setDefaultTimeout(120000);
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");

const deferredCleanupDirs = new Set<string>();

/** 快速非阻塞清理目录，遇到 Windows 短暂句柄占用时安全捕获并推迟回收，杜绝用例生命周期中的阻塞延迟 */
function safeCleanDir(targetDir?: string): void {
  if (!targetDir || !existsSync(targetDir)) return;
  try {
    rmSync(targetDir, { recursive: true, force: true, maxRetries: 1, retryDelay: 10 });
  } catch {
    deferredCleanupDirs.add(targetDir);
  }
}

function flushDeferredCleanup(): void {
  for (const dir of deferredCleanupDirs) {
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 1, retryDelay: 10 });
      } catch {}
    }
  }
  deferredCleanupDirs.clear();
}

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

describe("CLI Workflow - Core Lifecycle", () => {
  let suiteBaseDir: string;
  let tempDir: string;
  let caseIndex = 0;

  beforeAll(() => {
    suiteBaseDir = mkdtempSync(join(tmpdir(), "actiondock-cli-core-suite-"));
  });

  afterAll(() => {
    safeCleanDir(suiteBaseDir);
    flushDeferredCleanup();
  });

  beforeEach(() => {
    caseIndex++;
    tempDir = join(suiteBaseDir, `case-${caseIndex}`);
    mkdirSync(tempDir, { recursive: true });
    tempHome = join(suiteBaseDir, `home-${caseIndex}`);
    mkdirSync(tempHome, { recursive: true });
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
    }
  });

  afterEach(() => {
    if (tempHome) {
      safeCleanDir(tempHome);
      tempHome = undefined;
    }
    safeCleanDir(tempDir);
  });

  it("covers project initial lifecycle: init, info, list, describe, validate, run, and playbook", async () => {
    // 1. init
    const initProc = runCli(
      ["init", "--id", "team.github-ops", "--name", "GitHub Ops", "."],
      tempDir
    );
    expect(initProc.exitCode).toBe(0);

    // 2. info
    const infoProc = runCli(["info", "--json"], tempDir);
    expect(infoProc.exitCode).toBe(0);
    const info = JSON.parse(infoProc.stdout.toString());
    expect(info.id).toBe("team.github-ops");
    expect(info.actions).toContain("sample.greet");

    // 3. list & describe & validate (including intent fuzzy search and fallback)
    const listProc = runCli(["list", "--json"], tempDir);
    expect(listProc.exitCode).toBe(0);
    const actionsList = JSON.parse(listProc.stdout.toString());
    expect(actionsList.length).toBe(1);
    expect(actionsList[0].id).toBe("sample.greet");

    // 3b. Test list with --intent and positional fuzzy search
    const listIntentProc = runCli(["list", "--intent", "greet|hello", "--json"], tempDir);
    expect(listIntentProc.exitCode).toBe(0);
    expect(JSON.parse(listIntentProc.stdout.toString()).length).toBe(1);

    const listPositionalProc = runCli(["list", "greet", "--json"], tempDir);
    expect(listPositionalProc.exitCode).toBe(0);
    expect(JSON.parse(listPositionalProc.stdout.toString()).length).toBe(1);

    // In machine mode (--json), no fallback by default when no match: returns empty array
    const listNoMatchProc = runCli(["list", "--intent", "nomatch", "--json"], tempDir);
    expect(listNoMatchProc.exitCode).toBe(0);
    expect(JSON.parse(listNoMatchProc.stdout.toString()).length).toBe(0);

    // Fallback only when explicitly requested via --fallback in machine mode
    const listFallbackProc = runCli(
      ["list", "--intent", "nomatch", "--fallback", "--json"],
      tempDir
    );
    expect(listFallbackProc.exitCode).toBe(0);
    const fallbackRes = JSON.parse(listFallbackProc.stdout.toString());
    expect(fallbackRes.isFallback).toBe(true);
    expect(fallbackRes.items.length).toBe(1);

    // No fallback when --no-fallback is specified
    const listNoFallbackProc = runCli(
      ["list", "--intent", "nomatch", "--no-fallback", "--json"],
      tempDir
    );
    expect(listNoFallbackProc.exitCode).toBe(0);
    expect(JSON.parse(listNoFallbackProc.stdout.toString()).length).toBe(0);

    const showProc = runCli(["describe", "sample.greet", "--json"], tempDir);
    expect(showProc.exitCode).toBe(0);
    const show = JSON.parse(showProc.stdout.toString());
    expect(show.id).toBe("sample.greet");
    expect(show.inputSchema).toBeDefined();

    const valProc = runCli(["validate", "--json"], tempDir);
    expect(valProc.exitCode).toBe(0);
    const val = JSON.parse(valProc.stdout.toString());
    expect(val.valid).toBe(true);

    // 4. run
    const runProc = runCli(
      ["run", "sample.greet", "--input", '{"name": "Developer"}', "--timeout", "5s", "--json"],
      tempDir
    );
    expect(runProc.exitCode).toBe(0);
    const runRes = JSON.parse(runProc.stdout.toString());
    expect(runRes.ok).toBe(true);
    expect(runRes.data.message).toBe("Hello, Developer!");

    // Local async is rejected
    const localAsyncProc = runCli(
      ["run", "sample.greet", "--input", '{"name": "Developer"}', "--async"],
      tempDir
    );
    expect(localAsyncProc.exitCode).toBe(1);
    expect(localAsyncProc.stderr.toString()).toContain("Async execution requires a long-running ActionDock server");

    // 5. playbook list & show & validate
    const pbListProc = runCli(["playbook", "list", "--json"], tempDir);
    expect(pbListProc.exitCode).toBe(0);
    const pbList = JSON.parse(pbListProc.stdout.toString());
    expect(pbList.length).toBe(1);

    const pbListIntent = runCli(["playbook", "list", "greet", "--json"], tempDir);
    expect(pbListIntent.exitCode).toBe(0);
    expect(JSON.parse(pbListIntent.stdout.toString()).length).toBe(1);

    const pbListStrict = runCli(["playbook", "list", "nomatch", "--no-fallback", "--json"], tempDir);
    expect(pbListStrict.exitCode).toBe(0);
    expect(JSON.parse(pbListStrict.stdout.toString()).length).toBe(0);

    const pbShowProc = runCli(["playbook", "show", "greet-user", "--json"], tempDir);
    expect(pbShowProc.exitCode).toBe(0);
    const pbShow = JSON.parse(pbShowProc.stdout.toString());
    expect(pbShow.id).toBe("greet-user");

    const pbValProc = runCli(["playbook", "validate", "--json"], tempDir);
    expect(pbValProc.exitCode).toBe(0);
  }, 120000);
});
