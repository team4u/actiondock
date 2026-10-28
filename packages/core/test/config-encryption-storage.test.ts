import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { ActionDockError } from "../src/errors";
import {
  CONFIG_DECRYPT_FAILED,
  CONFIG_ENCRYPTION_ERROR,
  UNSUPPORTED_STORAGE_SCHEMA,
} from "../src/errors";
import { configKeyId, type ConfigEncryptionKey, type ConfigKeyProvider } from "../src/security/config-cipher";
import { redactConfigValueForDeclarations } from "../src/storage/mask";
import { NodeSqliteDriver } from "../src/storage/sqlite-driver";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import { STORAGE_SCHEMA_VERSION } from "../src/storage/types";
import type { ConfigItemDefinition } from "../src/project/types";

/** 构造随机 32 字节密钥材料及其规范指纹。 */
function makeMaterial(): ConfigEncryptionKey {
  const key = randomBytes(32);
  return { key, id: configKeyId(key) };
}

/** 可变密钥提供器：可随时替换密钥以模拟密钥切换、丢失等场景。 */
function mutableProvider() {
  let current: ConfigEncryptionKey | undefined;
  const provider: ConfigKeyProvider = (create: boolean) => {
    if (current === undefined) {
      if (!create) {
        throw new ActionDockError(CONFIG_ENCRYPTION_ERROR, "no config encryption key available");
      }
      current = makeMaterial();
    }
    return current;
  };
  return {
    provider,
    set: (material: ConfigEncryptionKey) => {
      current = material;
    },
    get: () => current,
  };
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ad-enc-storage-"));
}

/** 直接读取底层行原始 value_json 与 user_version（绕过存储层解码）。 */
function readRawState(dbPath: string, packageId: string, key: string) {
  const driver = new NodeSqliteDriver(dbPath);
  try {
    const row = driver
      .prepare("SELECT value_json FROM config WHERE package_id = ? AND key = ?")
      .get<{ value_json: string | null }>(packageId, key);
    const version = driver.prepare("PRAGMA user_version;").get<{ user_version: number }>();
    const meta = driver
      .prepare("SELECT key_id FROM config_encryption WHERE id = 1")
      .get<{ key_id: string }>();
    return { raw: row?.value_json ?? null, version: Number(version?.user_version ?? 0), pinnedKeyId: meta?.key_id };
  } finally {
    driver.close();
  }
}

const SECRET_DECL: ConfigItemDefinition = { secret: true, description: "api token", default: "leak-me", env: "TOKEN_ENV" };

describe("配置加密存储", () => {
  it("新敏感键直接整键加密：透明读取、快照保护与密钥指纹写入同事务完成", () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "pkg", "runtime.db");
    const harness = mutableProvider();
    const storage = new SqliteRuntimeStorage({
      dbPath,
      packageId: "demo.pkg",
      configKeyProvider: harness.provider,
    });

    storage.setConfig("TOKEN", "s3cret-value", { declarations: [SECRET_DECL] });
    storage.close();

    const state = readRawState(dbPath, "demo.pkg", "TOKEN");
    assert.match(state.raw ?? "", /^adenc:v1:/);
    assert.equal(state.version, STORAGE_SCHEMA_VERSION);
    assert.equal(state.pinnedKeyId, harness.get()?.id);
    assert.equal((state.raw ?? "").includes("s3cret-value"), false);

    const reopened = new SqliteRuntimeStorage({
      dbPath,
      packageId: "demo.pkg",
      configKeyProvider: harness.provider,
    });
    try {
      assert.equal(reopened.getConfig<string>("TOKEN"), "s3cret-value");
      const snapshot = reopened.getConfigSnapshot("TOKEN");
      assert.ok(snapshot);
      assert.equal(snapshot.value, "s3cret-value");
      assert.ok(Array.isArray(snapshot.protection));
      assert.equal(snapshot.protection?.some((item) => item.secret === true), true);
      assert.deepEqual(reopened.getConfigProtection("TOKEN"), snapshot.protection);
    } finally {
      reopened.close();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("保护元数据最小化：不携带 default/env/description/enum 等值内容", () => {
    const harness = mutableProvider();
    const storage = new SqliteRuntimeStorage({
      dbPath: ":memory:",
      packageId: "demo.pkg",
      configKeyProvider: harness.provider,
    });
    try {
      const nested: ConfigItemDefinition = {
        secret: true,
        description: "数据库连接",
        default: { password: "leak" },
        env: "DSN_ENV",
        schema: {
          type: "object",
          enum: [{ password: "leak" }],
          properties: {
            host: { type: "string" },
            password: { type: "string", secret: true, enum: ["leak-a", "leak-b"] },
          },
        },
      };
      storage.setConfig("DSN", { host: "db.local", password: "real-secret" }, { declarations: [nested] });
      const protection = storage.getConfigProtection("DSN");
      assert.ok(protection && protection.length > 0);
      const serialized = JSON.stringify(protection);
      for (const banned of ['"description"', '"default"', '"env"', '"enum"', "leak"]) {
        assert.equal(serialized.includes(banned), false, `protection must not contain ${banned}`);
      }
      // 结构与 secret 信息保留：脱敏函数可直接依据历史保护执行
      const redacted = redactConfigValueForDeclarations(
        storage.getConfig("DSN"),
        protection as ConfigItemDefinition[]
      );
      assert.equal(redacted.value, undefined);
      assert.equal(redacted.secret, true);
    } finally {
      storage.close();
    }
  });

  it("普通键保持明文 JSON 兼容，首次加密不波及同库其他键", () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "pkg", "runtime.db");
    const harness = mutableProvider();
    const storage = new SqliteRuntimeStorage({
      dbPath,
      packageId: "demo.pkg",
      configKeyProvider: harness.provider,
    });
    storage.setConfig("MODE", "fast");
    storage.setConfig("TOKEN", "s3cret", { declarations: [{ secret: true }] });
    storage.close();

    const plain = readRawState(dbPath, "demo.pkg", "MODE");
    assert.equal(plain.raw, '"fast"');
    assert.equal(plain.version, STORAGE_SCHEMA_VERSION);

    const reopened = new SqliteRuntimeStorage({
      dbPath,
      packageId: "demo.pkg",
      configKeyProvider: harness.provider,
    });
    try {
      assert.deepEqual(reopened.listConfig(), { MODE: "fast", TOKEN: "s3cret" });
    } finally {
      reopened.close();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("声明变敏感时正常写入直接把旧明文升级为密文", () => {
    const harness = mutableProvider();
    const storage = new SqliteRuntimeStorage({
      dbPath: ":memory:",
      packageId: "demo.pkg",
      configKeyProvider: harness.provider,
    });
    try {
      storage.setConfig("DSN", "postgres://plain-host/db");
      // 同一存储内直接以敏感声明覆盖旧明文：新值必须以密文落库
      storage.setConfig("DSN", "postgres://new-host/db", { declarations: [{ secret: true }] });
      assert.equal(storage.getConfig("DSN"), "postgres://new-host/db");
      const snapshot = storage.getConfigSnapshot("DSN");
      assert.ok(snapshot?.protection?.some((item) => item.secret === true));
      // 删除后重写同属新链路，保持密文
      storage.deleteConfig("DSN");
      storage.setConfig("DSN", "postgres://again/db", { declarations: [{ secret: true }] });
      assert.equal(storage.getConfig("DSN"), "postgres://again/db");
    } finally {
      storage.close();
    }
  });

  it("密文存在但元数据被删属损坏态：写入新敏感键必须失败且不生成替代密钥或元数据", () => {
    const harness = mutableProvider();
    const createCalls: boolean[] = [];
    const trackingProvider: ConfigKeyProvider = (create: boolean) => {
      createCalls.push(create);
      return harness.provider(create);
    };
    const driver = new NodeSqliteDriver(":memory:");
    const storage = new SqliteRuntimeStorage({
      dbPath: ":memory:",
      packageId: "demo.pkg",
      driver,
      configKeyProvider: trackingProvider,
    });
    try {
      // 首次加密：空元数据表 + 无密文 → 允许生成密钥并钉住
      storage.setConfig("TOKEN_A", "secret-a", { declarations: [{ secret: true }] });
      // 模拟损坏：删除元数据行但保留密文行
      driver.prepare("DELETE FROM config_encryption").run();
      createCalls.length = 0;
      assert.throws(
        () => storage.setConfig("TOKEN_B", "secret-b", { declarations: [{ secret: true }] }),
        (err: unknown) => err instanceof ActionDockError && err.code === CONFIG_ENCRYPTION_ERROR
      );
      // 未生成替代密钥（无 create 调用）、未重建元数据行、新键未落库
      assert.equal(createCalls.length, 0, "损坏态严禁调用密钥提供器生成替代密钥");
      const pinned = driver.prepare("SELECT COUNT(*) AS n FROM config_encryption").get<{ n: number }>();
      assert.equal(Number(pinned?.n ?? 0), 0, "不得重建元数据行");
      const rowB = driver
        .prepare("SELECT value_json FROM config WHERE package_id = ? AND key = ?")
        .get<{ value_json: string }>("demo.pkg", "TOKEN_B");
      assert.equal(rowB, undefined, "新键写入必须失败且不留半行");
      // 既有密文行读取同样拒绝（元数据缺失）
      assert.throws(
        () => storage.getConfig("TOKEN_A"),
        (err: unknown) => err instanceof ActionDockError && err.code === CONFIG_ENCRYPTION_ERROR
      );
    } finally {
      storage.close();
    }
  });

  it("已加密键后续写入保持加密且保护只增不减，重复写入保护去重不增长", () => {
    const harness = mutableProvider();
    const storage = new SqliteRuntimeStorage({
      dbPath: ":memory:",
      packageId: "demo.pkg",
      configKeyProvider: harness.provider,
    });
    try {
      const declA: ConfigItemDefinition = { secret: true };
      const declB: ConfigItemDefinition = {
        schema: { type: "object", properties: { password: { type: "string", secret: true } } },
      };
      storage.setConfig("CRED", "first", { declarations: [declA, declB] });
      const afterFirst = storage.getConfigProtection("CRED");
      assert.equal(afterFirst?.length, 2);

      // 当前声明完全移除敏感标记：仍保持加密，历史保护合并保留
      storage.setConfig("CRED", "rotated", { declarations: [] });
      const afterSecond = storage.getConfigProtection("CRED");
      assert.equal(afterSecond?.length, 2);
      assert.equal(storage.getConfig("CRED"), "rotated");

      // 重复同声明写入：保护数组长度稳定，不随写入次数增长
      for (let i = 0; i < 5; i++) {
        storage.setConfig("CRED", `value-${i}`, { declarations: [declA, declB] });
      }
      assert.equal(storage.getConfigProtection("CRED")?.length, 2);
      assert.equal(storage.getConfig("CRED"), "value-4");
    } finally {
      storage.close();
    }
  });

  it("密钥身份切换被明确拒绝：读取与敏感写入均不回退", () => {
    const harness = mutableProvider();
    const storage = new SqliteRuntimeStorage({
      dbPath: ":memory:",
      packageId: "demo.pkg",
      configKeyProvider: harness.provider,
    });
    storage.setConfig("TOKEN", "s3cret", { declarations: [{ secret: true }] });
    const first = harness.get(); // 首次加密写入之后保存原密钥，供切换后回归验证
    assert.ok(first);
    storage.setConfig("MODE", "fast");

    harness.set(makeMaterial()); // 切换到另一把有效密钥
    assert.throws(
      () => storage.getConfig("TOKEN"),
      (err: unknown) => err instanceof ActionDockError && err.code === CONFIG_ENCRYPTION_ERROR
    );
    assert.throws(
      () => storage.setConfig("TOKEN", "next", { declarations: [{ secret: true }] }),
      (err: unknown) => err instanceof ActionDockError && err.code === CONFIG_ENCRYPTION_ERROR
    );
    // 与加密无关的普通明文键不受影响
    storage.setConfig("MODE", "slow");
    assert.equal(storage.getConfig("MODE"), "slow");

    // 切回原密钥后恢复正常
    harness.set(first);
    assert.equal(storage.getConfig("TOKEN"), "s3cret");
    storage.close();
  });

  it("密钥缺失时按 provider 语义失败，绝不静默回退明文", () => {
    const denyAll: ConfigKeyProvider = () => {
      throw new ActionDockError(CONFIG_ENCRYPTION_ERROR, "no config encryption key available");
    };
    const storage = new SqliteRuntimeStorage({
      dbPath: ":memory:",
      packageId: "demo.pkg",
      configKeyProvider: denyAll,
    });
    try {
      assert.throws(
        () => storage.setConfig("TOKEN", "s3cret", { declarations: [{ secret: true }] }),
        (err: unknown) => err instanceof ActionDockError && err.code === CONFIG_ENCRYPTION_ERROR
      );
    } finally {
      storage.close();
    }
  });

  it("密文损坏与未知版本均严格失败，绝不把密文当明文返回", () => {
    const harness = mutableProvider();
    const driver = new NodeSqliteDriver(":memory:");
    const storage = new SqliteRuntimeStorage({
      dbPath: ":memory:",
      packageId: "demo.pkg",
      driver,
      configKeyProvider: harness.provider,
    });
    try {
      storage.setConfig("TOKEN", "s3cret", { declarations: [{ secret: true }] });

      const tamper = (value: string) => {
        driver
          .prepare("UPDATE config SET value_json = ? WHERE package_id = ? AND key = ?")
          .run(value, "demo.pkg", "TOKEN");
      };

      tamper(`adenc:v1:${"0".repeat(64)}:${Buffer.from("junk").toString("base64url")}`);
      assert.throws(
        () => storage.getConfig("TOKEN"),
        (err: unknown) => err instanceof ActionDockError && err.code === CONFIG_DECRYPT_FAILED
      );

      tamper(`adenc:v9:${"0".repeat(64)}:${Buffer.from("junk").toString("base64url")}`);
      assert.throws(
        () => storage.getConfig("TOKEN"),
        (err: unknown) =>
          err instanceof ActionDockError &&
          err.code === CONFIG_DECRYPT_FAILED &&
          String(err.message).includes("not supported")
      );

      // 无元数据的孤立密文同样拒绝，而非降级明文
      driver.prepare("DELETE FROM config_encryption").run();
      assert.throws(
        () => storage.getConfig("TOKEN"),
        (err: unknown) => err instanceof ActionDockError && err.code === CONFIG_ENCRYPTION_ERROR
      );
    } finally {
      storage.close();
    }
  });

  it("内存库默认一次性随机密钥：不读取环境变量，不触碰真实用户目录", () => {
    const previous = process.env.ACTIONDOCK_ENCRYPTION_KEY;
    const envKey = randomBytes(32);
    process.env.ACTIONDOCK_ENCRYPTION_KEY = Buffer.from(envKey).toString("hex");
    try {
      const driver = new NodeSqliteDriver(":memory:");
      const storage = new SqliteRuntimeStorage({
        dbPath: ":memory:",
        packageId: "demo.pkg",
        driver,
      });
      try {
        storage.setConfig("TOKEN", "memory-secret", { declarations: [{ secret: true }] });
        assert.equal(storage.getConfig("TOKEN"), "memory-secret");
        const meta = driver
          .prepare("SELECT key_id FROM config_encryption WHERE id = 1")
          .get<{ key_id: string }>();
        // 钉住的指纹必须不同于环境密钥：证明未读取 ACTIONDOCK_ENCRYPTION_KEY
        assert.notEqual(meta?.key_id, configKeyId(envKey));
      } finally {
        storage.close();
      }
    } finally {
      if (previous === undefined) {
        delete process.env.ACTIONDOCK_ENCRYPTION_KEY;
      } else {
        process.env.ACTIONDOCK_ENCRYPTION_KEY = previous;
      }
    }
  });

  it("不受支持的库版本被拒绝，当前版本库可正常打开", () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "pkg", "runtime.db");
    const harness = mutableProvider();
    const storage = new SqliteRuntimeStorage({
      dbPath,
      packageId: "demo.pkg",
      configKeyProvider: harness.provider,
    });
    storage.setConfig("TOKEN", "s3cret", { declarations: [{ secret: true }] });
    storage.close();

    // 版本 3 的库重新打开正常
    const reopened = new SqliteRuntimeStorage({
      dbPath,
      packageId: "demo.pkg",
      configKeyProvider: harness.provider,
    });
    reopened.close();

    // 版本 4 明确拒绝
    const raw = new NodeSqliteDriver(dbPath);
    raw.exec("PRAGMA user_version = 4;");
    raw.close();
    assert.throws(
      () =>
        new SqliteRuntimeStorage({
          dbPath,
          packageId: "demo.pkg",
          configKeyProvider: harness.provider,
        }),
      (err: unknown) => (err as { code?: string })?.code === UNSUPPORTED_STORAGE_SCHEMA
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("构造 init 失败时回收自建 driver，不泄漏数据库文件句柄", () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "pkg", "runtime.db");
    mkdirSync(join(dir, "pkg"), { recursive: true });
    const raw = new NodeSqliteDriver(dbPath);
    raw.exec("PRAGMA user_version = 9;");
    raw.close();

    const countDbFds = (): number => {
      const fdDir = "/proc/self/fd";
      if (!existsSync(fdDir)) return -1;
      // 必须用 readlinkSync 读取链接目标：readFileSync 会打开 fd 内容，
      // 遇到管道类 fd 将永久阻塞挂死测试进程
      return readdirSync(fdDir).filter((fd) => {
        try {
          return readlinkSync(join(fdDir, fd)) === dbPath;
        } catch {
          return false;
        }
      }).length;
    };

    const before = countDbFds();
    assert.throws(
      () =>
        new SqliteRuntimeStorage({
          dbPath,
          packageId: "demo.pkg",
        }),
      (err: unknown) => (err as { code?: string })?.code === UNSUPPORTED_STORAGE_SCHEMA
    );
    const after = countDbFds();
    if (before >= 0 && after >= 0) {
      assert.equal(after, before, "failed construction must not leak database file handles");
    }

    // 无残留连接：后续维护连接可自由切换日志模式
    const probe = new NodeSqliteDriver(dbPath);
    probe.exec("PRAGMA journal_mode = DELETE;");
    probe.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("驱动事务支持 immediate 模式：读后写场景不触发快照锁升级", () => {
    const driver = new NodeSqliteDriver(":memory:");
    try {
      driver.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
      driver.prepare("INSERT INTO t (v) VALUES ('a')").run();
      const out = driver.transaction(
        () => {
          const row = driver.prepare("SELECT v FROM t WHERE id = 1").get<{ v: string }>();
          driver.prepare("UPDATE t SET v = ? WHERE id = 1").run(`${row?.v}-b`);
          return row?.v;
        },
        "immediate"
      );
      assert.equal(out, "a");
      assert.equal(driver.prepare("SELECT v FROM t").get<{ v: string }>()?.v, "a-b");

      // 异常回滚保持既有行为
      assert.throws(() =>
        driver.transaction(
          () => {
            driver.prepare("UPDATE t SET v = 'x'").run();
            throw new Error("boom");
          },
          "immediate"
        )
      );
      assert.equal(driver.prepare("SELECT v FROM t").get<{ v: string }>()?.v, "a-b");
    } finally {
      driver.close();
    }
  });
});
