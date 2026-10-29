import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "@actiondock/core";
import { runCliAsync } from "./helpers/run-cli";
import "node:sqlite";

describe("CLI Package ID Conflict Regressions", () => {
  let fakeHome: string;
  let testBaseDir: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "ad-cli-conflict-home-"));
    testBaseDir = mkdtempSync(join(tmpdir(), "ad-cli-conflict-test-"));
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(testBaseDir, { recursive: true, force: true });
  });

  function createPkg(dir: string, id: string, name?: string): void {
    initProject(dir, { id, name: name || id });
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(dir, "node_modules"), "junction");
      } catch {}
    }
  }

  function addAction(dir: string, actId: string): void {
    const actDir = join(dir, "actions");
    mkdirSync(actDir, { recursive: true });
    writeFileSync(
      join(actDir, `${actId}.ts`),
      `import { defineAction } from "@actiondock/sdk";\nexport default defineAction({ id: "${actId}", run: () => ({ ok: true }) });\n`
    );
    const cfgPath = join(dir, "actiondock.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    cfg.actions = cfg.actions || {};
    cfg.actions[actId] = { entry: `actions/${actId}.ts`, description: "Test Action" };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  }

  function addPlaybook(dir: string, pbId: string): void {
    const pbDir = join(dir, "playbooks");
    mkdirSync(pbDir, { recursive: true });
    writeFileSync(join(pbDir, `${pbId}.md`), `# Playbook ${pbId}\n\n- Step 1\n`);
    const cfgPath = join(dir, "actiondock.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    cfg.playbooks = cfg.playbooks || {};
    cfg.playbooks[pbId] = { entry: `playbooks/${pbId}.md`, description: "Test Playbook" };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  }

  it("ad link: fails with exit code 1 and hint when package ID conflicts", async () => {
    const pkg1 = join(testBaseDir, "pkg-1");
    const pkg2 = join(testBaseDir, "pkg-2");
    mkdirSync(pkg1, { recursive: true });
    mkdirSync(pkg2, { recursive: true });
    createPkg(pkg1, "cli.conflict", "Pkg 1");
    createPkg(pkg2, "cli.conflict", "Pkg 2");

    // Link pkg1
    const res1 = await runCliAsync(["link", pkg1], pkg1, { ACTIONDOCK_HOME: fakeHome });
    assert.strictEqual(res1.exitCode, 0);

    // Link pkg2 (conflicts with pkg1)
    const res2 = await runCliAsync(["link", pkg2], pkg2, { ACTIONDOCK_HOME: fakeHome });
    assert.strictEqual(res2.exitCode, 1);
    const stderr = res2.stderr.toString();
    assert.ok(stderr.includes("PACKAGE_ID_CONFLICT"));
    assert.ok(stderr.includes("ad unlink"));

    // JSON envelope check
    const resJson = await runCliAsync(["link", pkg2, "--json"], pkg2, { ACTIONDOCK_HOME: fakeHome });
    assert.strictEqual(resJson.exitCode, 1);
    const rawOut = resJson.stderr.toString().trim() || resJson.stdout.toString().trim();
    const parsed = JSON.parse(rawOut);
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.error.code, "PACKAGE_ID_CONFLICT");
    const hint = parsed.hint || parsed.error?.details?.hint;
    assert.ok(hint && hint.includes("ad unlink"));
  });

  it("ad playbook show: exits with code 1 and retains PACKAGE_ID_CONFLICT on graph conflict", async () => {
    const installed = join(testBaseDir, "installed-pkg");
    const dev = join(testBaseDir, "dev-pkg");
    mkdirSync(installed, { recursive: true });
    mkdirSync(dev, { recursive: true });

    createPkg(installed, "pb.conflict", "Installed");
    createPkg(dev, "pb.conflict", "Dev");
    addPlaybook(installed, "sop");
    addPlaybook(dev, "sop");

    // Link installed
    const resLink = await runCliAsync(["link", installed], installed, { ACTIONDOCK_HOME: fakeHome });
    assert.strictEqual(resLink.exitCode, 0);

    // Run playbook show inside dev (dev and installed have same ID)
    const resShow = await runCliAsync(["playbook", "show", "sop"], dev, { ACTIONDOCK_HOME: fakeHome });
    assert.strictEqual(resShow.exitCode, 1);
    const stderr = resShow.stderr.toString();
    assert.ok(stderr.includes("PACKAGE_ID_CONFLICT"));
  });

  it("ad info: exits with code 1 and retains PACKAGE_ID_CONFLICT on ID resolution conflict", async () => {
    const installed = join(testBaseDir, "info-installed");
    const dev = join(testBaseDir, "info-dev");
    mkdirSync(installed, { recursive: true });
    mkdirSync(dev, { recursive: true });

    createPkg(installed, "info.conflict", "Installed");
    createPkg(dev, "info.conflict", "Dev");

    await runCliAsync(["link", installed], installed, { ACTIONDOCK_HOME: fakeHome });

    // ad info info.conflict inside dev
    const resInfo = await runCliAsync(["info", "info.conflict"], dev, { ACTIONDOCK_HOME: fakeHome });
    assert.strictEqual(resInfo.exitCode, 1);
    const stderr = resInfo.stderr.toString();
    assert.ok(stderr.includes("PACKAGE_ID_CONFLICT"));
  });

  it("ad run: fails with exit code 1 and PACKAGE_ID_CONFLICT when conflict exists in loaded scope", async () => {
    const installed = join(testBaseDir, "run-installed");
    const dev = join(testBaseDir, "run-dev");
    mkdirSync(installed, { recursive: true });
    mkdirSync(dev, { recursive: true });

    createPkg(installed, "run.conflict", "Installed");
    createPkg(dev, "run.conflict", "Dev");
    addAction(installed, "act");
    addAction(dev, "act");

    await runCliAsync(["link", installed], installed, { ACTIONDOCK_HOME: fakeHome });

    // ad run act inside dev
    const resRun = await runCliAsync(["run", "act", "--json"], dev, { ACTIONDOCK_HOME: fakeHome });
    assert.strictEqual(resRun.exitCode, 1);
    const out = resRun.stdout.toString() || resRun.stderr.toString();
    assert.ok(out.includes("PACKAGE_ID_CONFLICT"));
  });

  it("ad unlink: directly removes conflicting source and restores normal operations", async () => {
    const pkg1 = join(testBaseDir, "un-1");
    const pkg2 = join(testBaseDir, "un-2");
    mkdirSync(pkg1, { recursive: true });
    mkdirSync(pkg2, { recursive: true });
    createPkg(pkg1, "un.pkg", "Un 1");
    createPkg(pkg2, "un.pkg", "Un 2");

    await runCliAsync(["link", pkg1], pkg1, { ACTIONDOCK_HOME: fakeHome });

    // Unlink directly
    const resUnlink = await runCliAsync(["unlink", pkg1], pkg1, { ACTIONDOCK_HOME: fakeHome });
    assert.strictEqual(resUnlink.exitCode, 0);

    // Now linking pkg2 succeeds
    const resLink2 = await runCliAsync(["link", pkg2], pkg2, { ACTIONDOCK_HOME: fakeHome });
    assert.strictEqual(resLink2.exitCode, 0);
  });

  it("ad unlink: unlinks renamed package by new ID and old ID does not resurrect", async () => {
    const pkg = join(testBaseDir, "rename-cli-pkg");
    mkdirSync(pkg, { recursive: true });
    createPkg(pkg, "cli.old.id", "Rename Cli Pkg");

    const resLink = await runCliAsync(["link", pkg], pkg, { ACTIONDOCK_HOME: fakeHome });
    assert.strictEqual(resLink.exitCode, 0);

    // 修改清单为 new ID
    const cfgPath = join(pkg, "actiondock.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    cfg.id = "cli.new.id";
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");

    // 从 fakeHome 执行 unlink
    const resUnlink = await runCliAsync(["unlink", "cli.new.id"], fakeHome, { ACTIONDOCK_HOME: fakeHome });
    assert.strictEqual(resUnlink.exitCode, 0);

    // 解析真实持久化 packages，断言所有条目均不指向 pkg，且 Object.keys(packages) 为空
    const regPath = join(fakeHome, ".actiondock", "registry.json");
    const regRaw = JSON.parse(readFileSync(regPath, "utf-8"));
    const packages = regRaw.packages || {};
    assert.strictEqual(Object.keys(packages).length, 0);
    assert.ok(!Object.values(packages).some((p: any) => p && p.path === pkg));
  });

  it("ad doctor: detects corrupted workspace manifest and reports registry error", async () => {
    const ws = join(testBaseDir, "corrupt-ws-cli");
    const child = join(ws, "child");
    mkdirSync(child, { recursive: true });
    createPkg(child, "ws.child", "Child");

    await runCliAsync(["link", ws], ws, { ACTIONDOCK_HOME: fakeHome });

    // 破坏子包清单
    writeFileSync(join(child, "actiondock.json"), "{ broken json");

    const resDoctor = await runCliAsync(["doctor", "--json"], fakeHome, { ACTIONDOCK_HOME: fakeHome });
    assert.strictEqual(resDoctor.exitCode, 1);
    const parsed = JSON.parse(resDoctor.stdout.toString() || resDoctor.stderr.toString());
    assert.strictEqual(parsed.ok, false);
    const errCheck = parsed.checks.find((c: any) => c.category === "registry" && c.status === "error");
    assert.ok(errCheck);
  });
});
