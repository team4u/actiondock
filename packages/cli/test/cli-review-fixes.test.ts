import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
setDefaultTimeout(120000);
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "@actiondock/core";
import { createStorage } from "@actiondock/core/package";
import { runCliAsync } from "./helpers/run-cli";

let tempHome: string | undefined;

/**
 * 构造一个含指定短 id Action 的最小工程。
 */
function setupPackage(dir: string, pkgId: string, actionId: string): void {
  mkdirSync(join(dir, "actions"), { recursive: true });
  writeFileSync(
    join(dir, "actiondock.json"),
    JSON.stringify(
      {
        $schema: "https://actiondock.dev/schema/v2.json",
        schemaVersion: 2,
        id: pkgId,
        name: pkgId,
        version: "1.0.0",
        actions: {
          [actionId]: {
            entry: `actions/${actionId}.ts`,
            description: `Shared action from ${pkgId}`,
            inputSchema: { type: "object" },
          },
        },
        playbooks: {},
      },
      null,
      2
    )
  );
  writeFileSync(
    join(dir, "actions", `${actionId}.ts`),
    `import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "${actionId}",
  description: "Shared action",
  run: () => ({ from: "${pkgId}" }),
});
`
  );
}

describe("CLI Review Fixes", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-cli-review-"));
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-cli-review-home-"));
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

  it("excludes other packages' short-id actions when filtering by -P", async () => {
    // 两个包都暴露同名短 id Action：shared.echo
    const pkgADir = mkdtempSync(join(tmpdir(), "ad-review-pkgA-"));
    const pkgBDir = mkdtempSync(join(tmpdir(), "ad-review-pkgB-"));
    try {
      for (const dir of [pkgADir, pkgBDir]) {
        const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
        if (existsSync(rootNodeModules)) {
          try {
            symlinkSync(rootNodeModules, join(dir, "node_modules"), "junction");
          } catch {}
        }
      }
      setupPackage(pkgADir, "review.pkg-a", "shared.echo");
      setupPackage(pkgBDir, "review.pkg-b", "shared.echo");

      const linkA = await runCliAsync(["link", pkgADir], tmpdir());
      expect(linkA.exitCode).toBe(0);
      const linkB = await runCliAsync(["link", pkgBDir], tmpdir());
      expect(linkB.exitCode).toBe(0);

      // 指定 -P review.pkg-a：不得混入 pkg-b 的短 id 条目
      const proc = await runCliAsync(["list", "-P", "review.pkg-a", "--json"], tmpdir());
      expect(proc.exitCode).toBe(0);
      const actions = JSON.parse(proc.stdout.toString());
      expect(actions.length).toBe(1);
      expect((actions[0] as any).id).toBe("shared.echo");

      // 不指定 -P（链接包聚合视图）：两个包的条目均可列出
      const all = await runCliAsync(["list", "--json"], tmpdir());
      expect(all.exitCode).toBe(0);
      const allActions = JSON.parse(all.stdout.toString());
      expect(allActions.length).toBe(2);
    } finally {
      await runCliAsync(["unlink", "review.pkg-a"], tmpdir()).catch(() => {});
      await runCliAsync(["unlink", "review.pkg-b"], tmpdir()).catch(() => {});
      rmSync(pkgADir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      rmSync(pkgBDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("pushes user limit into runs list beyond the previous hardcoded 500 cap", async () => {
    // 直接向存储写入 600 条运行记录，验证 -n 600 能取到 500 条之后的数据
    const storage = createStorage("team.github-ops", { customHome: tempHome });
    try {
      const base = Date.now() - 600_000;
      for (let i = 0; i < 600; i++) {
        storage.createRun({
          id: `pushed-run-${String(i).padStart(4, "0")}`,
          rootRunId: `pushed-run-${String(i).padStart(4, "0")}`,
          packageId: "team.github-ops",
          packageInstanceId: "team.github-ops",
          actionId: "sample.greet",
          generationId: "1",
          ownerId: "local",
          status: "success",
          startedAt: new Date(base + i * 100).toISOString(),
          finishedAt: new Date(base + i * 100 + 50).toISOString(),
        });
      }
    } finally {
      storage.close();
    }

    const proc = await runCliAsync(["runs", "list", "-n", "600", "--json"], tempDir);
    expect(proc.exitCode).toBe(0);
    const runs = JSON.parse(proc.stdout.toString());
    // 修复前查询层硬编码 500 上限：600 条历史下 -n 600 只能看到 500 条
    expect(runs.length).toBe(600);

    // 默认 -n 20 仍按用户值截断
    const small = await runCliAsync(["runs", "list", "--json"], tempDir);
    expect(small.exitCode).toBe(0);
    expect(JSON.parse(small.stdout.toString()).length).toBe(20);
  });

  it("keeps config schema statuses consistent with the merged config list view", async () => {
    // 环境变量提供 env 来源，持久化提供 project 来源，声明默认值提供 default，未设键为 missing 候选
    await runCliAsync(["config", "set", "SAMPLE_GREETING", "Howdy"], tempDir);

    const schemaProc = await runCliAsync(["config", "schema", "--json"], tempDir);
    expect(schemaProc.exitCode).toBe(0);
    const schema = JSON.parse(schemaProc.stdout.toString());

    const listProc = await runCliAsync(["config", "list", "--json"], tempDir);
    expect(listProc.exitCode).toBe(0);
    const entries = JSON.parse(listProc.stdout.toString());

    const listByKey = new Map<string, any>(entries.map((e: any) => [e.key, e] as [string, any]));

    for (const item of schema.configs) {
      const merged = listByKey.get(item.key) as any;
      expect(merged).toBeDefined();
      // schema 的 source 与合并视图的 source 一致；
      // 状态推导：非 default 来源即 SET，default 来源且确有声明默认值即 DEFAULT
      expect(item.source).toBe(merged.source);
      if (item.source === "default") {
        expect(item.status).toBe("DEFAULT");
      } else {
        expect(item.status).toBe("SET");
      }
    }

    // project 来源（包级持久化）命中：SAMPLE_GREETING 经 config set 写入包级作用域
    const greeting = schema.configs.find((c: any) => c.key === "SAMPLE_GREETING");
    expect(greeting.source).toBe("project");
    expect(greeting.status).toBe("SET");
  });

  it("preserves core error codes in --json envelopes instead of degrading to EXECUTION_FAILURE", async () => {
    // 损坏工程清单：loadProjectConfig 抛错后经命令层包裹，--json 信封应保留可分辨的错误码
    writeFileSync(join(tempDir, "actiondock.json"), "{ invalid json !!!");

    const proc = await runCliAsync(["config", "schema", "--json"], tempDir);
    expect(proc.exitCode).not.toBe(0);
    const envelope = JSON.parse(proc.stdout.toString());
    expect(envelope.ok).toBe(false);
    expect(typeof envelope.error.code).toBe("string");
    expect(envelope.error.code).not.toBe("EXECUTION_FAILURE");

    // link 命令同样保留原始错误码
    const linkProc = await runCliAsync(["link", join(tempDir, "no-such-dir")], tempDir);
    expect(linkProc.exitCode).not.toBe(0);
  });
});
