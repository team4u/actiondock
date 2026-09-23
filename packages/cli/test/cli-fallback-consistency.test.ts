import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
setDefaultTimeout(120000);
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "@actiondock/core";
import { runCliAsync } from "./helpers/run-cli";

let tempHome: string | undefined;

/**
 * 机器模式意图回退一致性对照（H2 修复回归）：
 * list、info、playbook list、state list、runs list、config list 六组命令
 * 以 --json 加不匹配 intent 调用时，isFallback 语义必须一致——
 * 默认不回退返回空集，显式 --fallback 才回退，人类模式默认回退。
 */
describe("CLI Machine-Mode Fallback Consistency", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-cli-fb-"));
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-cli-fb-home-"));
    process.env.ACTIONDOCK_HOME = tempHome;
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
      } catch {}
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

  it("keeps machine-mode fallback semantics consistent across list, info, playbook, state, runs, and config", async () => {
    // 预置数据：run 产生 runs 与 state 键，config set 产生配置项
    await runCliAsync(["run", "sample.greet", "--input", '{"name": "A"}', "--json"], tempDir);
    await runCliAsync(["config", "set", "SAMPLE_GREETING", "Howdy"], tempDir);

    const noMatch = "nomatch-intent-xyz";
    const cases: Array<{ label: string; args: string[]; empty: unknown }> = [
      { label: "list", args: ["list", "--intent", noMatch, "--json"], empty: [] },
      {
        label: "info",
        args: ["info", "--intent", noMatch, "--json"],
        empty: { linkedPackages: [], matchedCount: 0, isFallback: false },
      },
      { label: "playbook list", args: ["playbook", "list", "--intent", noMatch, "--json"], empty: [] },
      { label: "state list", args: ["state", "list", "--intent", noMatch, "--json"], empty: [] },
      { label: "runs list", args: ["runs", "list", "--intent", noMatch, "--json"], empty: [] },
      { label: "config list", args: ["config", "list", "--intent", noMatch, "--json"], empty: [] },
    ];

    for (const c of cases) {
      const proc = await runCliAsync(c.args, tempDir);
      expect(proc.exitCode).toBe(0);
      const parsed = JSON.parse(proc.stdout.toString());
      expect(parsed).toEqual(c.empty as any);
    }

    // 显式 --fallback 时各命令一致回退（isFallback 标记或非空全量）
    const fallbackCases: Array<{ label: string; args: string[]; check: (parsed: any) => boolean }> = [
      {
        label: "list",
        args: ["list", "--intent", noMatch, "--fallback", "--json"],
        check: (p) => p.isFallback === true && Array.isArray(p.items) && p.items.length > 0,
      },
      {
        label: "info",
        args: ["info", "--intent", noMatch, "--fallback", "--json"],
        check: (p) => p.isFallback === true && Array.isArray(p.linkedPackages) && p.linkedPackages.length > 0,
      },
      {
        label: "playbook list",
        args: ["playbook", "list", "--intent", noMatch, "--fallback", "--json"],
        check: (p) => p.isFallback === true,
      },
      {
        label: "state list",
        args: ["state", "list", "--intent", noMatch, "--fallback", "--json"],
        check: (p) => Array.isArray(p) && p.length > 0,
      },
      {
        label: "runs list",
        args: ["runs", "list", "--intent", noMatch, "--fallback", "--json"],
        check: (p) => Array.isArray(p) && p.length > 0,
      },
      {
        label: "config list",
        args: ["config", "list", "--intent", noMatch, "--fallback", "--json"],
        check: (p) => Array.isArray(p) && p.length > 0,
      },
    ];

    for (const c of fallbackCases) {
      const proc = await runCliAsync(c.args, tempDir);
      expect(proc.exitCode).toBe(0);
      const parsed = JSON.parse(proc.stdout.toString());
      expect(c.check(parsed)).toBe(true);
    }

    // 人类模式默认回退（无 --json）：list 与 state list 均输出全量（非空输出且退出码 0）
    const humanList = await runCliAsync(["list", "--intent", noMatch], tempDir);
    expect(humanList.exitCode).toBe(0);
    expect(humanList.stdout.toString()).toContain("sample.greet");

    const humanState = await runCliAsync(["state", "list", "--intent", noMatch], tempDir);
    expect(humanState.exitCode).toBe(0);
    expect(humanState.stdout.toString()).toContain("greet_count");
  });
});
