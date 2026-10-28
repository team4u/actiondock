import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { ActionDockError, CONFIG_ENCRYPTION_ERROR, UNSUPPORTED_STORAGE_SCHEMA } from "../src/errors";
import { configKeyId, type ConfigEncryptionKey, type ConfigKeyProvider } from "../src/security/config-cipher";
import { redactConfigValueForDeclarations } from "../src/storage/mask";
import { NodeSqliteDriver } from "../src/storage/sqlite-driver";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import { STORAGE_SCHEMA_VERSION } from "../src/storage/types";
import type { ConfigItemDefinition } from "../src/project/types";
import { createV2Database, insertV2ConfigRow, insertV2IdempotencyRow, insertV2RunRow, insertV2StateRow } from "./helpers/v2-database";

/**
 * V2 数据库打开时自动迁移的行为测试。
 *
 * 夹具为真实旧版形态的磁盘库（user_version = 2、历史表结构、明文配置行），
 * 通过常规 SqliteRuntimeStorage 打开并传入配置声明，验证：
 * - 新库直接完整落当前版本且无敏感写入不触密钥；
 * - V2 在单事务内完成结构补齐与敏感明文转密文，业务数据完整保留；
 * - 迁移失败整体回滚且可重试；不支持版本明确拒绝；
 * - 打开当前版本库不重写既有密文。
 */

function makeMaterial(): ConfigEncryptionKey {
  const key = randomBytes(32);
  return { key, id: configKeyId(key) };
}

function fixedProvider(material: ConfigEncryptionKey): ConfigKeyProvider {
  return () => material;
}

/** 绝不允许被调到的密钥提供器：用于验证零密钥路径。 */
function refusingProvider(): ConfigKeyProvider {
  return () => {
    throw new ActionDockError(CONFIG_ENCRYPTION_ERROR, "key provider must not be called");
  };
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ad-v2-migration-"));
}

/** 读取库版本与配置行原始字节（绕过存储层解码）。 */
function readDbState(dbPath: string, packageId: string, key: string) {
  const driver = new NodeSqliteDriver(dbPath);
  try {
    const row = driver
      .prepare("SELECT value_json, updated_at FROM config WHERE package_id = ? AND key = ?")
      .get<{ value_json: string | null; updated_at: string }>(packageId, key);
    const version = driver.prepare("PRAGMA user_version;").get<{ user_version: number }>();
    let pinnedKeyId: string | undefined;
    try {
      pinnedKeyId = driver
        .prepare("SELECT key_id FROM config_encryption WHERE id = 1")
        .get<{ key_id: string }>()?.key_id;
    } catch {
      // config_encryption 表可能不存在（V2 夹具）
    }
    return {
      raw: row?.value_json ?? null,
      updatedAt: row?.updated_at ?? null,
      version: Number(version?.user_version ?? 0),
      pinnedKeyId,
    };
  } finally {
    driver.close();
  }
}

function listTables(dbPath: string): string[] {
  const driver = new NodeSqliteDriver(dbPath);
  try {
    return driver
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all<{ name: string }>()
      .map((r) => r.name);
  } finally {
    driver.close();
  }
}

function listRunColumns(dbPath: string): string[] {
  const driver = new NodeSqliteDriver(dbPath);
  try {
    return driver.prepare("PRAGMA table_info(runs);").all<{ name: string }>().map((r) => r.name);
  } finally {
    driver.close();
  }
}

describe("存储版本自动迁移", () => {
  it("新库直接创建当前版本完整结构，无敏感写入不加载或创建任何密钥", () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "pkg", "runtime.db");
    const storage = new SqliteRuntimeStorage({
      dbPath,
      packageId: "demo.pkg",
      configKeyProvider: refusingProvider(),
      configDeclarations: [{ TOKEN: { secret: true } }],
    });
    try {
      storage.setConfig("MODE", "fast");
      assert.equal(storage.getConfig("MODE"), "fast");
    } finally {
      storage.close();
    }

    const state = readDbState(dbPath, "demo.pkg", "MODE");
    assert.equal(state.version, STORAGE_SCHEMA_VERSION);
    assert.equal(state.raw, '"fast"');
    const tables = listTables(dbPath);
    for (const required of ["config", "state", "runs", "idempotency_keys", "events", "config_encryption"]) {
      assert.ok(tables.includes(required), `current schema must contain ${required}`);
    }
    // 空加密元数据表：未钉住任何密钥指纹
    const driver = new NodeSqliteDriver(dbPath);
    try {
      const count = driver.prepare("SELECT COUNT(*) AS n FROM config_encryption").get<{ n: number }>();
      assert.equal(Number(count?.n ?? 0), 0);
    } finally {
      driver.close();
    }
    // 密钥提供器从未被调用（拒绝式提供器未抛错），也不存在 keys 目录
    assert.equal(existsSync(join(dir, "keys")), false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("真实 V2（旧 runs 形态）自动迁移：敏感明文转密文，业务数据与时间戳完整保留", async () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "demo.pkg", "runtime.db");
    createV2Database({ dbPath, legacyRunsShape: true });
    const marker = `v2-secret-${randomBytes(12).toString("hex")}`;
    insertV2ConfigRow(dbPath, "demo.pkg", "API_TOKEN", marker, "2023-05-05T05:05:05.005Z");
    insertV2ConfigRow(dbPath, "demo.pkg", "RETRY_LIMIT", 3, "2023-05-05T05:05:05.005Z");
    insertV2StateRow(dbPath, "demo.pkg", "", "cursor", { page: 7 });
    insertV2RunRow(dbPath, { id: "run-legacy-1", packageId: "demo.pkg", actionId: "noop" });
    insertV2IdempotencyRow(dbPath, {
      ownerId: "owner-legacy",
      actionRef: "demo.pkg/noop",
      requestId: "req-legacy-1",
      runId: "run-legacy-1",
    });

    const material = makeMaterial();
    const storage = new SqliteRuntimeStorage({
      dbPath,
      packageId: "demo.pkg",
      configKeyProvider: fixedProvider(material),
      configDeclarations: [{ API_TOKEN: { type: "string", secret: true } }],
    });
    try {
      // 迁移后读取透明：业务原值可解
      assert.equal(storage.getConfig<string>("API_TOKEN"), marker);
      assert.equal(storage.getConfig<number>("RETRY_LIMIT"), 3);
      // 三类业务记录完整保留：state、runs 与幂等去重记录
      assert.deepEqual(await storage.getState("", "cursor"), { page: 7 });
      const run = storage.getRun("run-legacy-1");
      assert.ok(run);
      assert.equal(run.status, "success");
      assert.equal(run.actionId, "noop");
      const idempotency = storage.getIdempotencyRecord("owner-legacy", "demo.pkg/noop", "req-legacy-1");
      assert.ok(idempotency, "幂等去重记录必须完整保留");
      assert.equal(idempotency?.runId, "run-legacy-1");
      assert.equal(
        idempotency?.inputDigest,
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      );
    } finally {
      storage.close();
    }

    // 版本、密文、指纹与时间戳
    const state = readDbState(dbPath, "demo.pkg", "API_TOKEN");
    assert.equal(state.version, STORAGE_SCHEMA_VERSION);
    assert.match(state.raw ?? "", /^adenc:v1:/);
    assert.ok(!(state.raw ?? "").includes(marker));
    assert.equal(state.pinnedKeyId, material.id);
    assert.equal(state.updatedAt, "2023-05-05T05:05:05.005Z", "迁移必须保留 updated_at");

    // 普通明文键保持原状
    const plain = readDbState(dbPath, "demo.pkg", "RETRY_LIMIT");
    assert.equal(plain.raw, "3");
    assert.equal(plain.updatedAt, "2023-05-05T05:05:05.005Z");

    // 结构补齐：runs 新列与 events 表到位
    const columns = listRunColumns(dbPath);
    for (const column of ["origin_json", "host_session_id", "host_pid", "heartbeat_at"]) {
      assert.ok(columns.includes(column), `runs must gain ${column} after migration`);
    }
    assert.ok(listTables(dbPath).includes("events"));

    // 历史保护声明可用于脱敏（不含值内容）
    const reopened = new SqliteRuntimeStorage({
      dbPath,
      packageId: "demo.pkg",
      configKeyProvider: fixedProvider(material),
      configDeclarations: [{ API_TOKEN: { type: "string", secret: true } }],
    });
    try {
      const protection = reopened.getConfigProtection("API_TOKEN");
      assert.ok(protection && protection.some((item) => item.secret === true));
      const redacted = redactConfigValueForDeclarations(
        reopened.getConfig("API_TOKEN"),
        (protection ?? []) as ConfigItemDefinition[]
      );
      assert.equal(redacted.secret, true);
      assert.equal(redacted.value, undefined);
    } finally {
      reopened.close();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("模板声明与跨包并集参与判定，具体键声明严格优先于模板", () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "demo.pkg", "runtime.db");
    createV2Database({ dbPath });
    const marker = `v2-tpl-${randomBytes(8).toString("hex")}`;
    insertV2ConfigRow(dbPath, "demo.pkg", "MYSQL_MAIN", { host: "db.local", password: marker });
    insertV2ConfigRow(dbPath, "demo.pkg", "MYSQL_PUBLIC", "public-dsn");
    insertV2ConfigRow(dbPath, "demo.pkg", "UNRELATED", "keep-plain");

    const material = makeMaterial();
    const storage = new SqliteRuntimeStorage({
      dbPath,
      packageId: "demo.pkg",
      configKeyProvider: fixedProvider(material),
      // 同一字典内具体键非 secret 严格优先于同键模板 secret 判定
      configDeclarations: [
        {
          MYSQL_PUBLIC: { type: "string" },
          "MYSQL_*": {
            schema: {
              type: "object",
              properties: { host: { type: "string" }, password: { type: "string", secret: true } },
            },
          },
        },
      ],
    });
    try {
      assert.deepEqual(storage.getConfig("MYSQL_MAIN"), { host: "db.local", password: marker });
      assert.equal(storage.getConfig("MYSQL_PUBLIC"), "public-dsn");
      assert.equal(storage.getConfig("UNRELATED"), "keep-plain");
    } finally {
      storage.close();
    }

    // 模板命中的键迁移为密文；具体键声明优先使其保持明文；未命中键不受影响
    assert.match(readDbState(dbPath, "demo.pkg", "MYSQL_MAIN").raw ?? "", /^adenc:v1:/);
    const concrete = readDbState(dbPath, "demo.pkg", "MYSQL_PUBLIC");
    assert.equal(concrete.raw, '"public-dsn"', "具体键非敏感声明必须严格优先于同键模板");
    assert.equal(readDbState(dbPath, "demo.pkg", "UNRELATED").raw, '"keep-plain"');

    // 跨字典并集：另一声明字典单独声明同一具体键敏感 → 仍迁移
    const dbPath2 = join(dir, "pkg2", "runtime.db");
    createV2Database({ dbPath: dbPath2 });
    insertV2ConfigRow(dbPath2, "pkg2", "MYSQL_PUBLIC", "union-dsn");
    const material2 = makeMaterial();
    const storage2 = new SqliteRuntimeStorage({
      dbPath: dbPath2,
      packageId: "pkg2",
      configKeyProvider: fixedProvider(material2),
      configDeclarations: [{ MYSQL_PUBLIC: { type: "string" } }, { MYSQL_PUBLIC: { secret: true } }],
    });
    try {
      assert.equal(storage2.getConfig("MYSQL_PUBLIC"), "union-dsn");
    } finally {
      storage2.close();
    }
    assert.match(readDbState(dbPath2, "pkg2", "MYSQL_PUBLIC").raw ?? "", /^adenc:v1:/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("密文写入中途失败整体回滚：首个密文落库后第二行失败，原值/元数据/结构均可重试", () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "demo.pkg", "runtime.db");
    createV2Database({ dbPath, legacyRunsShape: true });
    const firstMarker = `v2-mid-a-${randomBytes(8).toString("hex")}`;
    const secondMarker = `v2-mid-b-${randomBytes(8).toString("hex")}`;
    insertV2ConfigRow(dbPath, "demo.pkg", "AAA_FIRST", firstMarker);
    insertV2ConfigRow(dbPath, "demo.pkg", "BBB_SECOND", secondMarker);
    // 计数触发器：首条密文 UPDATE 落库后，第二条 UPDATE 强制失败
    //（不依赖行扫描顺序，确定性发生在写入阶段中透）
    const triggerDriver = new NodeSqliteDriver(dbPath);
    triggerDriver.exec(`
      CREATE TRIGGER fail_second_config_update BEFORE UPDATE ON config
      WHEN (SELECT COUNT(*) FROM config WHERE value_json LIKE 'adenc:%') >= 1
      BEGIN
        SELECT RAISE(ABORT, 'injected mid-write failure');
      END;
    `);
    triggerDriver.close();

    const material = makeMaterial();
    const declarations = [{ AAA_FIRST: { secret: true }, BBB_SECOND: { secret: true } }];
    assert.throws(
      () =>
        new SqliteRuntimeStorage({
          dbPath,
          packageId: "demo.pkg",
          configKeyProvider: fixedProvider(material),
          configDeclarations: declarations,
        }),
      (err: unknown) =>
        err instanceof Error && String(err.message).includes("injected mid-write failure")
    );

    // 写入阶段中途失败：首条已写入的密文也一并回滚，全部回到 V2 形态
    const driver = new NodeSqliteDriver(dbPath);
    try {
      const version = driver.prepare("PRAGMA user_version;").get<{ user_version: number }>();
      assert.equal(Number(version?.user_version ?? 0), 2, "失败后必须保持 V2 版本");
      for (const key of ["AAA_FIRST", "BBB_SECOND"]) {
        const row = driver
          .prepare("SELECT value_json FROM config WHERE package_id = ? AND key = ?")
          .get<{ value_json: string }>("demo.pkg", key);
        assert.equal(row?.value_json, JSON.stringify(key === "AAA_FIRST" ? firstMarker : secondMarker), `${key} 必须回到明文原值`);
      }
      let pinRowCount = -1;
      try {
        const pin = driver.prepare("SELECT COUNT(*) AS n FROM config_encryption").get<{ n: number }>();
        pinRowCount = Number(pin?.n ?? 0);
      } catch {
        // 表不存在即迁移 DDL 已回滚，同样视为零行
        pinRowCount = 0;
      }
      assert.equal(pinRowCount, 0, "密钥指纹钉住必须一并回滚");
      const runColumns = driver.prepare("PRAGMA table_info(runs);").all<{ name: string }>();
      assert.ok(!runColumns.some((column) => column.name === "origin_json"), "结构补齐必须一并回滚");
    } finally {
      driver.close();
    }

    // 移除故障注入后重试成功
    const cleanup = new NodeSqliteDriver(dbPath);
    cleanup.exec("DROP TRIGGER fail_second_config_update;");
    cleanup.close();
    const storage = new SqliteRuntimeStorage({
      dbPath,
      packageId: "demo.pkg",
      configKeyProvider: fixedProvider(material),
      configDeclarations: declarations,
    });
    try {
      assert.equal(storage.getConfig("AAA_FIRST"), firstMarker);
      assert.equal(storage.getConfig("BBB_SECOND"), secondMarker);
    } finally {
      storage.close();
    }
    const done = readDbState(dbPath, "demo.pkg", "AAA_FIRST");
    assert.equal(done.version, STORAGE_SCHEMA_VERSION);
    assert.match(done.raw ?? "", /^adenc:v1:/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("迁移严格验证声明命中后才加密：未声明敏感的库升级版本但不触密钥", () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "demo.pkg", "runtime.db");
    createV2Database({ dbPath });
    insertV2ConfigRow(dbPath, "demo.pkg", "MODE", "fast");
    insertV2ConfigRow(dbPath, "demo.pkg", "EMPTY_SECRET", "");

    const storage = new SqliteRuntimeStorage({
      dbPath,
      packageId: "demo.pkg",
      configKeyProvider: refusingProvider(),
      configDeclarations: [{ MODE: { type: "string" } }],
    });
    try {
      assert.equal(storage.getConfig("MODE"), "fast");
    } finally {
      storage.close();
    }

    const state = readDbState(dbPath, "demo.pkg", "MODE");
    assert.equal(state.version, STORAGE_SCHEMA_VERSION);
    assert.equal(state.raw, '"fast"');
    assert.equal(state.pinnedKeyId, undefined, "无敏感行时不得钉住任何密钥");
    rmSync(dir, { recursive: true, force: true });
  });

  it("迁移解析阶段失败整体回滚：版本、结构、明文原值保持 V2 且修复后可重试", () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "demo.pkg", "runtime.db");
    createV2Database({ dbPath });
    const goodMarker = `v2-good-${randomBytes(8).toString("hex")}`;
    insertV2ConfigRow(dbPath, "demo.pkg", "AAA_GOOD_TOKEN", goodMarker);
    // 损坏 JSON 的敏感行：严格解析在任何密文写入前失败
    const corruptDriver = new NodeSqliteDriver(dbPath);
    corruptDriver
      .prepare("INSERT INTO config (package_id, key, value_json, updated_at) VALUES (?, ?, ?, ?)")
      .run("demo.pkg", "ZZZ_BAD_TOKEN", "{not-valid-json", "2024-01-01T00:00:00.000Z");
    corruptDriver.close();

    const material = makeMaterial();
    assert.throws(
      () =>
        new SqliteRuntimeStorage({
          dbPath,
          packageId: "demo.pkg",
          configKeyProvider: fixedProvider(material),
          configDeclarations: [
            { AAA_GOOD_TOKEN: { secret: true }, ZZZ_BAD_TOKEN: { secret: true } },
          ],
        }),
      (err: unknown) => err instanceof ActionDockError
    );

    // 回滚后：版本仍为 2，正常行仍为明文原值，未钉住密钥
    const afterFailure = readDbState(dbPath, "demo.pkg", "AAA_GOOD_TOKEN");
    assert.equal(afterFailure.version, 2);
    assert.equal(afterFailure.raw, JSON.stringify(goodMarker));
    assert.equal(afterFailure.pinnedKeyId, undefined);

    // 修复损坏行后重试成功
    const fixDriver = new NodeSqliteDriver(dbPath);
    fixDriver
      .prepare("UPDATE config SET value_json = ? WHERE package_id = ? AND key = ?")
      .run(JSON.stringify("repaired-secret"), "demo.pkg", "ZZZ_BAD_TOKEN");
    fixDriver.close();
    const storage = new SqliteRuntimeStorage({
      dbPath,
      packageId: "demo.pkg",
      configKeyProvider: fixedProvider(material),
      configDeclarations: [{ AAA_GOOD_TOKEN: { secret: true }, ZZZ_BAD_TOKEN: { secret: true } }],
    });
    try {
      assert.equal(storage.getConfig("AAA_GOOD_TOKEN"), goodMarker);
      assert.equal(storage.getConfig("ZZZ_BAD_TOKEN"), "repaired-secret");
    } finally {
      storage.close();
    }
    const done = readDbState(dbPath, "demo.pkg", "AAA_GOOD_TOKEN");
    assert.equal(done.version, STORAGE_SCHEMA_VERSION);
    assert.match(done.raw ?? "", /^adenc:v1:/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("重开已迁移库不重写既有密文（字节与时间戳稳定）", () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "demo.pkg", "runtime.db");
    createV2Database({ dbPath });
    insertV2ConfigRow(dbPath, "demo.pkg", "API_TOKEN", "stable-secret", "2023-06-06T06:06:06.006Z");
    const material = makeMaterial();
    const declarations = [{ API_TOKEN: { secret: true } }];
    const first = new SqliteRuntimeStorage({
      dbPath,
      packageId: "demo.pkg",
      configKeyProvider: fixedProvider(material),
      configDeclarations: declarations,
    });
    first.close();
    const afterFirst = readDbState(dbPath, "demo.pkg", "API_TOKEN");

    const second = new SqliteRuntimeStorage({
      dbPath,
      packageId: "demo.pkg",
      configKeyProvider: fixedProvider(material),
      configDeclarations: declarations,
    });
    try {
      assert.equal(second.getConfig("API_TOKEN"), "stable-secret");
    } finally {
      second.close();
    }
    const afterSecond = readDbState(dbPath, "demo.pkg", "API_TOKEN");
    assert.equal(afterSecond.raw, afterFirst.raw, "当前版本库重开不得重写密文");
    assert.equal(afterSecond.updatedAt, afterFirst.updatedAt);
    assert.equal(afterSecond.version, STORAGE_SCHEMA_VERSION);
    rmSync(dir, { recursive: true, force: true });
  });

  it("不支持的历史版本与未来版本均明确拒绝且数据库保持未修改", () => {
    for (const version of [1, 4, 99]) {
      const dir = makeTempDir();
      const dbPath = join(dir, "demo.pkg", "runtime.db");
      createV2Database({ dbPath });
      const raw = new NodeSqliteDriver(dbPath);
      raw.exec(`PRAGMA user_version = ${version};`);
      raw.close();

      assert.throws(
        () =>
          new SqliteRuntimeStorage({
            dbPath,
            packageId: "demo.pkg",
            configKeyProvider: fixedProvider(makeMaterial()),
            configDeclarations: [{ TOKEN: { secret: true } }],
          }),
        (err: unknown) => (err as { code?: string })?.code === UNSUPPORTED_STORAGE_SCHEMA
      );
      const check = new NodeSqliteDriver(dbPath);
      const current = check.prepare("PRAGMA user_version;").get<{ user_version: number }>();
      check.close();
      assert.equal(Number(current?.user_version ?? 0), version, "被拒绝的库版本必须保持未修改");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("当前版本库缺失关键表属损坏状态：拒绝打开而不是静默修补", () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "demo.pkg", "runtime.db");
    const material = makeMaterial();
    const seeder = new SqliteRuntimeStorage({
      dbPath,
      packageId: "demo.pkg",
      configKeyProvider: fixedProvider(material),
      configDeclarations: [{ TOKEN: { secret: true } }],
    });
    seeder.setConfig("TOKEN", "secret-value", { declarations: [{ secret: true }] });
    seeder.close();

    const raw = new NodeSqliteDriver(dbPath);
    raw.exec("DROP TABLE config_encryption;");
    raw.close();

    assert.throws(
      () =>
        new SqliteRuntimeStorage({
          dbPath,
          packageId: "demo.pkg",
          configKeyProvider: fixedProvider(material),
          configDeclarations: [{ TOKEN: { secret: true } }],
        }),
      (err: unknown) => (err as { code?: string })?.code === UNSUPPORTED_STORAGE_SCHEMA
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("结构完整的未来版本库仍被拒绝：版本号是硬边界而非表集合", () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "demo.pkg", "runtime.db");
    // 以真实存储新建完整当前版本结构（六张表齐备），仅版本号被改为未来值
    const seeder = new SqliteRuntimeStorage({
      dbPath,
      packageId: "demo.pkg",
      configKeyProvider: fixedProvider(makeMaterial()),
      configDeclarations: [{ TOKEN: { secret: true } }],
    });
    seeder.setConfig("TOKEN", "secret-value", { declarations: [{ secret: true }] });
    seeder.close();
    const raw = new NodeSqliteDriver(dbPath);
    raw.exec("PRAGMA user_version = 99;");
    raw.close();

    assert.throws(
      () =>
        new SqliteRuntimeStorage({
          dbPath,
          packageId: "demo.pkg",
          configKeyProvider: fixedProvider(makeMaterial()),
          configDeclarations: [{ TOKEN: { secret: true } }],
        }),
      (err: unknown) =>
        (err as { code?: string })?.code === UNSUPPORTED_STORAGE_SCHEMA &&
        String((err as Error).message).includes("no supported migration path")
    );
    const check = new NodeSqliteDriver(dbPath);
    const version = check.prepare("PRAGMA user_version;").get<{ user_version: number }>();
    check.close();
    assert.equal(Number(version?.user_version ?? 0), 99, "被拒绝的库必须保持未修改");
    rmSync(dir, { recursive: true, force: true });
  });

  it("V2 缺本迁移不负责创建的核心表时失败整体回滚：版本、明文与新增 DDL 均回到 V2", () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "demo.pkg", "runtime.db");
    createV2Database({ dbPath, legacyRunsShape: true });
    const marker = `v2-missing-table-${randomBytes(8).toString("hex")}`;
    insertV2ConfigRow(dbPath, "demo.pkg", "API_TOKEN", marker);
    // 删除 v2-to-v3 不负责创建的核心表：迁移先执行全部转换后必须在校验处失败并回滚
    const dropper = new NodeSqliteDriver(dbPath);
    dropper.exec("DROP TABLE idempotency_keys;");
    dropper.close();

    assert.throws(
      () =>
        new SqliteRuntimeStorage({
          dbPath,
          packageId: "demo.pkg",
          configKeyProvider: fixedProvider(makeMaterial()),
          configDeclarations: [{ API_TOKEN: { secret: true } }],
        }),
      (err: unknown) => (err as { code?: string })?.code === UNSUPPORTED_STORAGE_SCHEMA
    );

    // 提交前失败：版本、数据、结构与密钥全部回到 V2 形态
    const driver = new NodeSqliteDriver(dbPath);
    try {
      const version = driver.prepare("PRAGMA user_version;").get<{ user_version: number }>();
      assert.equal(Number(version?.user_version ?? 0), 2, "失败后必须保持 V2 版本");
      const row = driver
        .prepare("SELECT value_json FROM config WHERE package_id = ? AND key = ?")
        .get<{ value_json: string }>("demo.pkg", "API_TOKEN");
      assert.equal(row?.value_json, JSON.stringify(marker), "明文原值保持未变");
      const runColumns = driver.prepare("PRAGMA table_info(runs);").all<{ name: string }>();
      assert.ok(
        !runColumns.some((column) => column.name === "origin_json"),
        "迁移补齐的 runs 新列必须一并回滚"
      );
      const events = driver
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'events'")
        .get<{ name: string }>();
      assert.equal(events, undefined, "迁移创建的 events 表必须一并回滚");
    } finally {
      driver.close();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("全局命名空间（__global__）同样在打开时自动迁移", () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "global.db");
    createV2Database({ dbPath });
    insertV2ConfigRow(dbPath, "__global__", "SHARED_TOKEN", "global-legacy-secret");

    const material = makeMaterial();
    const storage = new SqliteRuntimeStorage({
      dbPath,
      packageId: "__global__",
      configKeyProvider: fixedProvider(material),
      configDeclarations: [{ SHARED_TOKEN: { secret: true } }],
    });
    try {
      assert.equal(storage.getConfig("SHARED_TOKEN"), "global-legacy-secret");
    } finally {
      storage.close();
    }
    const state = readDbState(dbPath, "__global__", "SHARED_TOKEN");
    assert.equal(state.version, STORAGE_SCHEMA_VERSION);
    assert.match(state.raw ?? "", /^adenc:v1:/);
    rmSync(dir, { recursive: true, force: true });
  });
});
