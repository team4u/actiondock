import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { initProject } from "@actiondock/core";
import { resolveDatabasePath } from "@actiondock/core/package";
import { runCliAsync } from "./helpers/run-cli";

/**
 * 普通 config 命令打开 V2 旧库时自动迁移的 CLI 端到端测试。
 *
 * 夹具为真实旧版形态磁盘库（user_version = 2、明文配置行），通过
 * ad config list / get / set 常规命令触发宿主打开存储，验证：
 * - 打开即自动迁移：版本升到当前版本、敏感明文转密文、非敏感保持明文；
 * - 全局库同样在首次打开时按已加载包声明并集迁移；
 * - 已删除的显式迁移子命令不再注册。
 *
 * 全部测试通过临时 ACTIONDOCK_HOME 与显式清理 ACTIONDOCK_ENCRYPTION_KEY
 * 环境变量实现隔离，绝不读取或创建用户真实密钥。
 */

const PACKAGE_ID = "test.v2-auto-cli";
const LEGACY_SECRET = "{{SECRET_q7w8e9r2}}";
const GLOBAL_LEGACY_SECRET = "{{SECRET_m3n4b5v6}}";

/** 与旧版程序一致的最小 V2 结构（四张基础表，缺 events 与 config_encryption）。 */
function seedV2Database(dbPath: string, rows: Array<{ namespace: string; key: string; value: unknown }>): void {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(`
      CREATE TABLE config (
        package_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (package_id, key)
      );
      CREATE TABLE state (
        package_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        PRIMARY KEY (package_id, namespace, key)
      );
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        root_run_id TEXT NOT NULL,
        parent_run_id TEXT,
        package_id TEXT NOT NULL,
        package_instance_id TEXT NOT NULL,
        action_id TEXT NOT NULL,
        generation_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        status TEXT NOT NULL,
        input_json TEXT,
        output_json TEXT,
        error_json TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER
      );
      CREATE TABLE idempotency_keys (
        owner_id TEXT NOT NULL,
        action_ref TEXT NOT NULL,
        request_id TEXT NOT NULL,
        input_digest TEXT NOT NULL,
        run_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, action_ref, request_id)
      );
      PRAGMA user_version = 2;
    `);
    const insert = db.prepare(
      "INSERT INTO config (package_id, key, value_json, updated_at) VALUES (?, ?, ?, ?)"
    );
    for (const row of rows) {
      insert.run(row.namespace, row.key, JSON.stringify(row.value), "2024-02-02T02:02:02.002Z");
    }
  } finally {
    db.close();
  }
}

function readRawConfig(dbPath: string, namespace: string, key: string): string | null {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db
      .prepare("SELECT value_json FROM config WHERE package_id = ? AND key = ?")
      .get(namespace, key) as { value_json: string | null } | undefined;
    return row?.value_json ?? null;
  } finally {
    db.close();
  }
}

function readUserVersion(dbPath: string): number {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare("PRAGMA user_version;").get() as { user_version: number };
    return Number(row.user_version);
  } finally {
    db.close();
  }
}

describe("CLI 打开 V2 旧库自动迁移端到端", () => {
  let tempDir: string;
  let tempHome: string;
  let packageDbPath: string;
  let globalDbPath: string;

  const isolatedEnv = (extra?: Record<string, string | undefined>) => ({
    ACTIONDOCK_HOME: tempHome,
    ACTIONDOCK_ENCRYPTION_KEY: undefined,
    ACTIONDOCK_SERVER_URL: undefined,
    ACTIONDOCK_PROFILE: undefined,
    ...extra,
  });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-v2-cli-"));
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-v2-home-"));
    process.env.ACTIONDOCK_HOME = tempHome;
    const rootNodeModules = resolve(import.meta.dirname, "../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
    }
    initProject(tempDir, { id: PACKAGE_ID, name: "V2 Auto CLI Fixture" });
    writeFileSync(
      join(tempDir, "actiondock.json"),
      JSON.stringify(
        {
          id: PACKAGE_ID,
          name: "V2 Auto CLI Fixture",
          version: "1.0.0",
          config: {
            LEGACY_TOKEN: { type: "string", secret: true },
            GLOBAL_TOKEN: { type: "string", secret: true },
            PLAIN_KEY: { type: "string" },
          },
          actions: {},
        },
        null,
        2
      ),
      "utf-8"
    );
    packageDbPath = resolveDatabasePath(PACKAGE_ID, { customHome: tempHome });
    globalDbPath = join(tempHome, ".actiondock", "global.db");
  });

  afterEach(async () => {
    delete process.env.ACTIONDOCK_HOME;
    for (const dir of [tempHome, tempDir]) {
      if (dir && existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch {
          await new Promise((r) => setTimeout(r, 200));
          try {
            rmSync(dir, { recursive: true, force: true });
          } catch {}
        }
      }
    }
  });

  it("包级：ad config list 打开 V2 库即迁移，敏感明文转密文且非敏感保持明文", async () => {
    seedV2Database(packageDbPath, [
      { namespace: PACKAGE_ID, key: "LEGACY_TOKEN", value: LEGACY_SECRET },
      { namespace: PACKAGE_ID, key: "PLAIN_KEY", value: "plain-normal-value" },
    ]);

    const list = await runCliAsync(["config", "list", "--json"], tempDir, isolatedEnv());
    assert.strictEqual(list.exitCode, 0, list.stderr.toString());

    // 磁盘事实：版本升级、敏感行整键密文、非敏感行保持明文
    assert.strictEqual(readUserVersion(packageDbPath), 3, "V2 库必须在打开时升级到版本 3");
    const secretRaw = readRawConfig(packageDbPath, PACKAGE_ID, "LEGACY_TOKEN");
    assert.match(secretRaw ?? "", /^adenc:v1:/);
    assert.ok(!(secretRaw ?? "").includes(LEGACY_SECRET));
    assert.strictEqual(readRawConfig(packageDbPath, PACKAGE_ID, "PLAIN_KEY"), '"plain-normal-value"');

    // 读取视图不泄漏秘密，普通键明文可读
    const secretView = await runCliAsync(["config", "get", "LEGACY_TOKEN", "--json"], tempDir, isolatedEnv());
    assert.strictEqual(secretView.exitCode, 0);
    assert.ok(!secretView.stdout.toString().includes(LEGACY_SECRET));
    const plainView = await runCliAsync(["config", "get", "PLAIN_KEY", "--json"], tempDir, isolatedEnv());
    assert.strictEqual(plainView.exitCode, 0);
    assert.strictEqual(JSON.parse(plainView.stdout.toString()).value, "plain-normal-value");

    // 迁移后敏感键正常更新（密文原地替换）
    const rotated = await runCliAsync(["config", "set", "LEGACY_TOKEN", "rotated-secret-9f2c"], tempDir, isolatedEnv());
    assert.strictEqual(rotated.exitCode, 0, rotated.stderr.toString());
    const rotatedRaw = readRawConfig(packageDbPath, PACKAGE_ID, "LEGACY_TOKEN");
    assert.match(rotatedRaw ?? "", /^adenc:v1:/);
    assert.ok(!(rotatedRaw ?? "").includes("rotated-secret-9f2c"));
  });

  it("全局：ad config list --global 打开 V2 全局库即按已加载包声明迁移", async () => {
    seedV2Database(globalDbPath, [
      { namespace: "__global__", key: "GLOBAL_TOKEN", value: GLOBAL_LEGACY_SECRET },
    ]);

    const list = await runCliAsync(["config", "list", "--global", "--json"], tempDir, isolatedEnv());
    assert.strictEqual(list.exitCode, 0, list.stderr.toString());

    assert.strictEqual(readUserVersion(globalDbPath), 3);
    const raw = readRawConfig(globalDbPath, "__global__", "GLOBAL_TOKEN");
    assert.match(raw ?? "", /^adenc:v1:/);
    assert.ok(!(raw ?? "").includes(GLOBAL_LEGACY_SECRET));

    const view = await runCliAsync(["config", "get", "GLOBAL_TOKEN", "--global", "--json"], tempDir, isolatedEnv());
    assert.strictEqual(view.exitCode, 0);
    assert.ok(!view.stdout.toString().includes(GLOBAL_LEGACY_SECRET));
  });

  it("显式迁移子命令已删除：ad config encrypt 不再是可用命令", async () => {
    const result = await runCliAsync(["config", "encrypt", "--backup", "b.db"], tempDir, isolatedEnv());
    assert.notStrictEqual(result.exitCode, 0);
    assert.ok(
      result.stderr.toString().includes("unknown command") ||
        result.stderr.toString().includes("Invalid") ||
        result.stderr.toString().includes("error"),
      "已删除命令必须明确报错而非静默成功"
    );
  });
});
