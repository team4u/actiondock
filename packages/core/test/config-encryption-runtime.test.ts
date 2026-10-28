import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { type ActionContext, defineAction } from "@actiondock/sdk";
import { MemoryStorage } from "@actiondock/testing";
import {
  ActionDockError,
  CONFIG_DECRYPT_FAILED,
  CONFIG_ENCRYPTION_ERROR,
} from "../src/errors";
import { DefaultPackageRuntime } from "../src/package/runtime";
import { RuntimeConfig } from "../src/runtime/context";
import { createActionDockHost } from "../src/host";
import { createNodePlatform } from "../src/platform/node";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import { createConfigKeyProvider } from "../src/security/config-key";
import { startActionDockServer } from "../src/server";
import type { ConfigItemDefinition } from "../src/project/types";
import type { RuntimeStorage } from "../src/storage/types";
import { createV2Database, insertV2ConfigRow } from "./helpers/v2-database";

const SECRET_STRING_DECL: ConfigItemDefinition = { type: "string", secret: true };

function makeProjectConfig(
  config: Record<string, ConfigItemDefinition>,
  id = "pkg.enc"
) {
  return { id, name: id, version: "1.0.0", config };
}

/** 读取物理库中 config 表的原始存储值（验证整键加密事实） */
function readRawConfigValue(dbPath: string, packageId: string, key: string): string | null {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db
      .prepare("SELECT value_json FROM config WHERE package_id = ? AND key = ?")
      .get(packageId, key) as { value_json: string | null } | undefined;
    return row?.value_json ?? null;
  } finally {
    db.close();
  }
}

/** 用真实 V2 夹具（原生 SQL、user_version=2）写入旧版明文配置行 */
function seedLegacyPlaintextDatabase(dbPath: string, packageId: string, key: string, value: unknown): void {
  createV2Database({ dbPath });
  insertV2ConfigRow(dbPath, packageId, key, value);
}

const echoConfigAction = defineAction({
  run: (_input: unknown, ctx: ActionContext) => {
    // 未配置的键回填 null：Action 输出严禁 undefined（OUTPUT_NOT_JSON）
    const token = ctx.config.get("api.token");
    const ttl = ctx.config.get("cache.ttl");
    return {
      token: token ?? null,
      tokenType: token === undefined ? "undefined" : typeof token,
      ttl: ttl ?? null,
      ttlType: ttl === undefined ? "undefined" : typeof ttl,
      credentials: ctx.config.get("credentials") ?? null,
    };
  },
});

/** 最小可注入存储：可控快照/旧方法行为，用于原子性与错误注入验证 */
class FakeProtectionStorage {
  rows = new Map<string, { value: unknown; protection?: readonly ConfigItemDefinition[] }>();
  snapshotError?: Error;
  legacyProtectionDisabledKeys = new Set<string>();

  getConfigSnapshot(key: string): { value: unknown; protection?: readonly ConfigItemDefinition[] } | undefined {
    if (this.snapshotError) {
      throw this.snapshotError;
    }
    const row = this.rows.get(key);
    return row ? { ...row } : undefined;
  }

  getConfig(key: string): unknown {
    return this.rows.get(key)?.value;
  }

  getConfigProtection(key: string): readonly ConfigItemDefinition[] | undefined {
    // 旧方法陷阱：指定键返回 undefined，模拟读取值之后、读取规则之前行被删除
    if (this.legacyProtectionDisabledKeys.has(key)) {
      return undefined;
    }
    return this.rows.get(key)?.protection;
  }

  listConfig(): Record<string, unknown> {
    return Object.fromEntries([...this.rows].map(([k, r]) => [k, r.value]));
  }

  setConfig(key: string, value: unknown, options?: { declarations?: readonly ConfigItemDefinition[] }): void {
    const declarations = options?.declarations;
    this.rows.set(key, { value, ...(declarations ? { protection: declarations } : {}) });
  }

  deleteConfig(key: string): boolean {
    return this.rows.delete(key);
  }

  async getState(): Promise<undefined> {
    return undefined;
  }
  async setState(): Promise<void> {}
  async deleteState(): Promise<boolean> {
    return false;
  }
  async clearState(): Promise<number> {
    return 0;
  }
  async listStateKeys(): Promise<string[]> {
    return [];
  }
  close(): void {}
}

function asStorage(fake: FakeProtectionStorage): RuntimeStorage {
  return fake as unknown as RuntimeStorage;
}

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const ENV_KEYS = ["ACTIONDOCK_ENCRYPTION_KEY", "ACTIONDOCK_HOME", "PKG_ENC_API_TOKEN"] as const;
let savedEnv: Record<string, string | undefined> = {};

describe("敏感配置加密运行时集成契约", () => {
  before(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
    }
    // 隔离真实环境：套件内禁止读取外部加密密钥，并将意外默认路径重定向到临时主目录
    delete process.env.ACTIONDOCK_ENCRYPTION_KEY;
    process.env.ACTIONDOCK_HOME = makeTempDir("ad-enc-neutral-home-");
  });

  after(() => {
    for (const k of ENV_KEYS) {
      const v = savedEnv[k];
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("包级敏感键整键加密，Action 获得完整原值与原类型，管理视图顶层与嵌套脱敏", async () => {
    const dataDir = makeTempDir("ad-enc-pkg-");
    const projectConfig = makeProjectConfig({
      "api.token": { ...SECRET_STRING_DECL },
      "cache.ttl": { type: "number", schema: { type: "integer", minimum: 1 } },
      credentials: {
        type: "object",
        schema: {
          type: "object",
          properties: {
            username: { type: "string" },
            password: { type: "string", secret: true },
          },
          required: ["username", "password"],
        },
      },
    });

    const runtime = new DefaultPackageRuntime({
      projectConfig,
      actions: { echo: echoConfigAction },
      dataDir,
    });

    await runtime.setConfig("api.token", "plain-secret-token");
    await runtime.setConfig("cache.ttl", 90);
    await runtime.setConfig("credentials", { username: "alice", password: "hunter2" });

    // Action 读取透明解密：完整原值与原始类型
    const result: any = await runtime.runAction("echo", {});
    assert.strictEqual(result.ok, true, JSON.stringify(result.error ?? {}));
    assert.strictEqual(result.data.token, "plain-secret-token");
    assert.strictEqual(result.data.tokenType, "string");
    assert.strictEqual(result.data.ttl, 90);
    assert.strictEqual(result.data.ttlType, "number");
    assert.deepStrictEqual(result.data.credentials, { username: "alice", password: "hunter2" });

    await runtime.close();

    // 物理库验证：敏感键整键加密，非敏感键保持普通 JSON
    const dbPath = join(dataDir, "pkg.enc", "runtime.db");
    const tokenRaw = readRawConfigValue(dbPath, "pkg.enc", "api.token");
    assert.ok(tokenRaw !== null && tokenRaw.startsWith("adenc:"), "api.token 必须整键加密存储");
    assert.ok(!tokenRaw.includes("plain-secret-token"));
    const credRaw = readRawConfigValue(dbPath, "pkg.enc", "credentials");
    assert.ok(credRaw !== null && credRaw.startsWith("adenc:"), "含嵌套敏感字段的键必须整键加密存储");
    assert.ok(!credRaw.includes("hunter2"));
    const ttlRaw = readRawConfigValue(dbPath, "pkg.enc", "cache.ttl");
    assert.ok(ttlRaw !== null && !ttlRaw.startsWith("adenc:"), "非敏感键不得加密");

    // 管理视图：顶层敏感整项隐藏；嵌套敏感字段路径脱敏
    const runtime2 = new DefaultPackageRuntime({ projectConfig, actions: { echo: echoConfigAction }, dataDir });
    const tokenView = await runtime2.getConfig("api.token");
    assert.strictEqual(tokenView.secret, true);
    assert.strictEqual(tokenView.value, undefined);
    const credView = await runtime2.getConfig("credentials");
    assert.strictEqual(credView.secret, true);
    assert.deepStrictEqual(credView.value, { username: "alice", password: "********" });
    assert.deepStrictEqual(credView.redactedPaths, ["/password"]);
    await runtime2.close();
  });

  it("删除或弱化敏感声明后，历史保护声明仍阻止管理视图明文泄漏", async () => {
    const dataDir = makeTempDir("ad-enc-decl-removed-");
    const withSecret = makeProjectConfig({
      "api.token": { ...SECRET_STRING_DECL },
      credentials: {
        type: "object",
        schema: {
          type: "object",
          properties: { password: { type: "string", secret: true } },
        },
      },
    });
    const runtime = new DefaultPackageRuntime({ projectConfig: withSecret, dataDir });
    await runtime.setConfig("api.token", "token-to-protect");
    await runtime.setConfig("credentials", { password: "nested-to-protect" });
    await runtime.close();

    // 新宿主加载弱化后的声明：顶层 secret 删除、嵌套 secret 字段删除
    const weakened = makeProjectConfig({
      "api.token": { type: "string" },
      credentials: { type: "object", schema: { type: "object", properties: { password: { type: "string" } } } },
    });
    const runtime2 = new DefaultPackageRuntime({ projectConfig: weakened, dataDir });
    const tokenView = await runtime2.getConfig("api.token");
    assert.strictEqual(tokenView.secret, true, "删除 secret 声明后仍必须按历史保护隐藏");
    assert.strictEqual(tokenView.value, undefined);
    const credView = await runtime2.getConfig("credentials");
    assert.strictEqual(credView.secret, true, "删除嵌套敏感声明后仍必须按历史保护脱敏");
    assert.deepStrictEqual(credView.value, { password: "********" });

    // 键整体不再声明时，管理列表仍因历史保护不泄漏
    const undeclared = new DefaultPackageRuntime({ projectConfig: makeProjectConfig({}, "pkg.enc"), dataDir });
    const views = await undeclared.listConfig();
    const tokenEntry = views.find((v) => v.key === "api.token");
    assert.ok(tokenEntry, "持久化键应在管理列表可见");
    assert.strictEqual(tokenEntry.secret, true);
    assert.strictEqual(tokenEntry.value, undefined);
    await runtime2.close();
    await undeclared.close();
  });

  it("不同宿主共享全局库且加载不同包时，全局敏感值仍受历史保护", async () => {
    const dataDir = makeTempDir("ad-enc-global-");
    const hostA = await createActionDockHost({
      packages: [{ projectConfig: makeProjectConfig({ "api.token": { ...SECRET_STRING_DECL } }) }],
      dataDir,
      autoLoadCurrentProject: false,
    });
    await hostA.management!.config.set("global", "api.token", "global-secret");

    // 物理全局库已整键加密
    const globalDb = join(dataDir, "global.db");
    const raw = readRawConfigValue(globalDb, "__global__", "api.token");
    assert.ok(raw !== null && raw.startsWith("adenc:"));
    assert.ok(!raw.includes("global-secret"));

    const viewA = await hostA.management!.config.get("global", "api.token");
    assert.strictEqual(viewA.secret, true);
    assert.strictEqual(viewA.value, undefined);
    await hostA.close();

    // 宿主 B 加载完全不同的包（无该键声明），仍不得泄漏全局明文
    const hostB = await createActionDockHost({
      packages: [{ projectConfig: makeProjectConfig({}, "pkg.other") }],
      dataDir,
      autoLoadCurrentProject: false,
    });
    const viewB = await hostB.management!.config.get("global", "api.token");
    assert.strictEqual(viewB.source, "global");
    assert.strictEqual(viewB.secret, true, "跨宿主历史保护必须生效");
    assert.strictEqual(viewB.value, undefined);

    const otherRuntime = hostB.getRuntime("pkg.other")!;
    const pkgView = await otherRuntime.getConfig("api.token");
    assert.strictEqual(pkgView.source, "global");
    assert.strictEqual(pkgView.secret, true);
    assert.strictEqual(pkgView.value, undefined);
    await hostB.close();
  });

  it("全局写入声明并集：具体键优先于模板，任一包声明敏感即加密", async () => {
    const dataDir = makeTempDir("ad-enc-union-");
    const pkgA = makeProjectConfig(
      {
        "server.*.token": { type: "string", secret: false },
        "server.api.token": { ...SECRET_STRING_DECL },
      },
      "pkg.a"
    );
    const pkgB = makeProjectConfig(
      {
        "shared.key": {
          type: "object",
          schema: {
            type: "object",
            properties: {
              user: { type: "string" },
              password: { type: "string", secret: true },
            },
          },
        },
      },
      "pkg.b"
    );

    const host = await createActionDockHost({
      packages: [{ projectConfig: pkgA }, { projectConfig: pkgB }],
      dataDir,
      autoLoadCurrentProject: false,
    });

    // 具体键 secret:true 优先于同键模板 secret:false：必须加密
    await host.management!.config.set("global", "server.api.token", "concrete-wins");
    // pkgB 声明嵌套敏感字段，跨包并集判定为敏感：必须加密
    await host.management!.config.set("global", "shared.key", { password: "union-secret", user: "bob" });
    await host.close();

    const rawConcrete = readRawConfigValue(join(dataDir, "global.db"), "__global__", "server.api.token");
    assert.ok(rawConcrete !== null && rawConcrete.startsWith("adenc:"), "具体键声明必须优先于模板判定加密");
    const rawUnion = readRawConfigValue(join(dataDir, "global.db"), "__global__", "shared.key");
    assert.ok(rawUnion !== null && rawUnion.startsWith("adenc:"), "跨包声明并集必须触发加密");

    const host2 = await createActionDockHost({
      packages: [{ projectConfig: pkgB }],
      dataDir,
      autoLoadCurrentProject: false,
    });
    const sharedView = await host2.management!.config.get("global", "shared.key");
    assert.strictEqual(sharedView.secret, true);
    assert.deepStrictEqual(sharedView.value, { password: "********", user: "bob" });
    await host2.close();
  });

  it("读取走 getConfigSnapshot 原子配对：旧方法陷阱（先值后规则）不得泄漏", async () => {
    const fake = new FakeProtectionStorage();
    fake.setConfig("api.token", "snapshot-only-secret", {
      declarations: [{ type: "string", secret: true }],
    });
    // 陷阱：旧 getConfig/getConfigProtection 配对会在两步之间"丢行"，只剩明文值与空规则
    fake.legacyProtectionDisabledKeys.add("api.token");

    // 无当前声明的管理视图：必须依赖原子快照中的历史保护，而非旧方法配对
    const runtime = new DefaultPackageRuntime({
      projectConfig: makeProjectConfig({}, "pkg.snapshot"),
      storage: asStorage(fake),
      inMemory: true,
    });
    const view = await runtime.getConfig("api.token");
    assert.strictEqual(view.secret, true, "必须优先使用 getConfigSnapshot 的原子保护规则");
    assert.strictEqual(view.value, undefined);
    await runtime.close();

    // 同一陷阱在 RuntimeConfig 解析链上同样受快照保护
    const config = new RuntimeConfig(asStorage(fake), {}, makeProjectConfig({}, "pkg.snapshot"));
    const resolved = config.describeWithProtection("api.token");
    assert.strictEqual(resolved.source, "package");
    assert.strictEqual(resolved.value, "snapshot-only-secret");
    assert.ok(resolved.protection !== undefined && resolved.protection.length > 0);
  });

  it("全部加密错误码不得回退到环境变量或默认值（含普通 Error 携带错误码）", async () => {
    const dataDir = makeTempDir("ad-enc-nofallback-");
    const declWithFallbacks = makeProjectConfig({
      "api.token": { ...SECRET_STRING_DECL, env: "PKG_ENC_API_TOKEN", default: "default-token" },
    });
    process.env.PKG_ENC_API_TOKEN = "env-fallback-token";
    const packageMemory = new SqliteRuntimeStorage({ dbPath: ":memory:", packageId: "pkg.enc" });

    // 加密域错误码逐一验证：普通 Error 携带结构化 code 同样必须透传，不得吞没回退
    const codes = [
      CONFIG_ENCRYPTION_ERROR,
      CONFIG_DECRYPT_FAILED,
    ] as const;
    for (const code of codes) {
      const fake = new FakeProtectionStorage();
      fake.snapshotError = Object.assign(new Error(`injected ${code} (plain error)`), { code });
      const config = new RuntimeConfig(packageMemory, {}, declWithFallbacks, asStorage(fake));
      assert.throws(
        () => config.get("api.token"),
        (err: any) => err.code === code && err.message.includes("plain error"),
        `错误码 ${code} 必须原样透传`
      );
    }

    // 包级来源分支（无降级捕获）同样透传普通 Error 携带的错误码
    const fakePkg = new FakeProtectionStorage();
    fakePkg.snapshotError = Object.assign(new Error("package branch plain error"), {
      code: CONFIG_DECRYPT_FAILED,
    });
    const configPkg = new RuntimeConfig(asStorage(fakePkg), {}, declWithFallbacks);
    assert.throws(
      () => configPkg.get("api.token"),
      (err: any) => err.code === CONFIG_DECRYPT_FAILED
    );

    // 真实持久库：密钥身份不符（K1 写入、K2 打开）必须报错而非回退环境变量
    const k1 = randomBytes(32);
    const k2 = randomBytes(32);
    const globalDb = join(dataDir, "global.db");
    const writer = new SqliteRuntimeStorage({
      dbPath: globalDb,
      packageId: "__global__",
      configKeyProvider: createConfigKeyProvider({ key: k1 }),
    });
    writer.setConfig("api.token", "k1-global-secret", { declarations: [SECRET_STRING_DECL] });
    writer.close();

    const readerWithK2 = new SqliteRuntimeStorage({
      dbPath: globalDb,
      packageId: "__global__",
      configKeyProvider: createConfigKeyProvider({ key: k2 }),
    });
    const configK2 = new RuntimeConfig(packageMemory, {}, declWithFallbacks, readerWithK2);
    assert.throws(
      () => configK2.get("api.token"),
      (err: any) =>
        err.code === CONFIG_ENCRYPTION_ERROR || err.code === CONFIG_DECRYPT_FAILED,
      "密钥身份不符必须抛出加密错误，不得回退 env/default"
    );
    readerWithK2.close();
    delete process.env.PKG_ENC_API_TOKEN;
  });

  it("V2 旧明文库在运行时打开时自动迁移：读取透明、写入正常、磁盘为密文", async () => {
    const dataDir = makeTempDir("ad-enc-legacy-");
    const dbPath = join(dataDir, "pkg.enc", "runtime.db");
    seedLegacyPlaintextDatabase(dbPath, "pkg.enc", "api.token", "legacy-plain-token");

    const runtime = new DefaultPackageRuntime({
      projectConfig: makeProjectConfig({ "api.token": { ...SECRET_STRING_DECL } }),
      actions: { echo: echoConfigAction },
      dataDir,
    });

    try {
      // 打开即自动迁移：管理视图按当前敏感声明脱敏，Action 读取透明解密
      const view = await runtime.getConfig("api.token");
      assert.strictEqual(view.secret, true);
      assert.strictEqual(view.value, undefined);
      const actionResult: any = await runtime.runAction("echo", {});
      assert.strictEqual(actionResult.ok, true);
      assert.strictEqual(actionResult.data.token, "legacy-plain-token", "迁移后业务原值保持不变");

      // 旧明文键正常更新（密文原地替换），不再要求任何手工迁移命令
      await runtime.setConfig("api.token", "rotated-token");
      const rotatedResult: any = await runtime.runAction("echo", {});
      assert.strictEqual(rotatedResult.data.token, "rotated-token");
    } finally {
      await runtime.close();
    }

    // 磁盘事实：版本 3 且两代值均以密文落库，库文件不含任何明文秘密
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const version = db.prepare("PRAGMA user_version;").get() as any;
      assert.strictEqual(version.user_version, 3, "V2 库必须在打开时升级到当前版本");
      const raw = db
        .prepare("SELECT value_json FROM config WHERE package_id = ? AND key = ?")
        .get("pkg.enc", "api.token") as { value_json: string };
      assert.match(raw.value_json, /^adenc:v1:/);
      assert.ok(!raw.value_json.includes("rotated-token"));
      assert.ok(!raw.value_json.includes("legacy-plain-token"));
    } finally {
      db.close();
    }
  });

  it("内存库与显式平台路径：不触真实 home，opts 显式 undefined 不覆盖平台路径", async () => {
    const realHomeKeys = join(homedir(), ".actiondock", "keys");
    const realHomeKeysExistedBefore = existsSync(realHomeKeys);

    // 纯内存包：密钥只在内存，敏感保护链路完整，且不落任何磁盘文件
    const memScratch = makeTempDir("ad-enc-mem-scratch-");
    const memRuntime = new DefaultPackageRuntime({
      projectConfig: makeProjectConfig({ "api.token": { ...SECRET_STRING_DECL } }),
      actions: { echo: echoConfigAction },
      inMemory: true,
      dataDir: memScratch,
      customHome: memScratch,
    });
    await memRuntime.setConfig("api.token", "memory-secret");
    const memResult: any = await memRuntime.runAction("echo", {});
    assert.strictEqual(memResult.ok, true);
    assert.strictEqual(memResult.data.token, "memory-secret");
    const memView = await memRuntime.getConfig("api.token");
    assert.strictEqual(memView.secret, true);
    assert.strictEqual(memView.value, undefined);
    await memRuntime.close();
    assert.ok(!existsSync(join(memScratch, "keys")), "内存运行不得创建密钥目录");
    assert.ok(!existsSync(join(memScratch, "pkg.enc")), "内存运行不得创建数据库目录");
    assert.ok(!existsSync(join(memScratch, ".actiondock")), "内存运行不得触碰主目录");

    // 平台级 dataDir 与库级显式 undefined：数据库与密钥必须同域（平台 dataDir 生效）
    const platDataDir = makeTempDir("ad-enc-platform-");
    const platform = createNodePlatform({ dataDir: platDataDir });
    const storage = platform.storage.createStorage("pkg.plat", {
      dataDir: undefined,
      customHome: undefined,
      inMemory: undefined,
    });
    storage.setConfig("api.token", "platform-path-secret", { declarations: [SECRET_STRING_DECL] });
    const platView = storage.getConfigSnapshot?.("api.token");
    assert.strictEqual(platView?.value, "platform-path-secret");
    assert.ok(platView?.protection !== undefined && platView.protection.length > 0);
    storage.close();
    assert.ok(existsSync(join(platDataDir, "pkg.plat", "runtime.db")), "数据库必须落在平台 dataDir 域");
    assert.ok(existsSync(join(platDataDir, "keys")), "密钥必须与数据库同域");

    // 外部旧存储（无快照/保护能力）保持既有行为：明文存储、按当前声明脱敏
    const legacyStorage = new MemoryStorage({ packageId: "pkg.legacy-mem" });
    const legacyRuntime = new DefaultPackageRuntime({
      projectConfig: makeProjectConfig({ "api.token": { ...SECRET_STRING_DECL } }),
      actions: { echo: echoConfigAction },
      storage: legacyStorage,
      inMemory: true,
    });
    await legacyRuntime.setConfig("api.token", "legacy-storage-secret");
    const legacyResult: any = await legacyRuntime.runAction("echo", {});
    assert.strictEqual(legacyResult.ok, true);
    assert.strictEqual(legacyResult.data.token, "legacy-storage-secret");
    const legacyView = await legacyRuntime.getConfig("api.token");
    assert.strictEqual(legacyView.secret, true);
    assert.strictEqual(legacyView.value, undefined);
    await legacyRuntime.close();

    const realHomeKeysExistedAfter = existsSync(realHomeKeys);
    assert.strictEqual(realHomeKeysExistedAfter, realHomeKeysExistedBefore, "测试不得在真实 home 创建密钥");
  });

  it("HTTP 配置路由原样透传加密/迁移错误码，不覆写为通用错误码", async () => {
    const token = "enc-http-test-token";

    // 场景一：V2 旧明文库 -> 宿主打开时自动迁移，PUT 更新直接成功且磁盘为密文
    const legacyDir = makeTempDir("ad-enc-http-legacy-");
    const legacyDbPath = join(legacyDir, "pkg.enc", "runtime.db");
    seedLegacyPlaintextDatabase(legacyDbPath, "pkg.enc", "api.token", "http-legacy-plain");
    const legacyHost = await createActionDockHost({
      packages: [{ projectConfig: makeProjectConfig({ "api.token": { ...SECRET_STRING_DECL } }) }],
      dataDir: legacyDir,
      autoLoadCurrentProject: false,
    });
    const legacyServer = await startActionDockServer({
      port: 0,
      hostname: "127.0.0.1",
      token,
      service: legacyHost,
      enableManagement: true,
      packageAllowlist: ["*"],
    });
    try {
      const putRes = await fetch(
        `http://127.0.0.1:${legacyServer.port}/api/v2/config?package=pkg.enc`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ key: "api.token", value: "attempted-update" }),
        }
      );
      assert.strictEqual(putRes.status, 200, "旧明文键更新必须直接成功，不再要求手工迁移");
      const body: any = await putRes.json();
      assert.strictEqual(body.ok, true);

      // 磁盘事实：自动迁移已把库升到当前版本，新旧两代值均为密文
      const db = new DatabaseSync(legacyDbPath, { readOnly: true });
      try {
        const version = db.prepare("PRAGMA user_version;").get() as any;
        assert.strictEqual(version.user_version, 3);
        const raw = db
          .prepare("SELECT value_json FROM config WHERE package_id = ? AND key = ?")
          .get("pkg.enc", "api.token") as { value_json: string };
        assert.match(raw.value_json, /^adenc:v1:/);
        assert.ok(!raw.value_json.includes("attempted-update"));
        assert.ok(!raw.value_json.includes("http-legacy-plain"));
      } finally {
        db.close();
      }

      const viewRes = await fetch(
        `http://127.0.0.1:${legacyServer.port}/api/v2/config?package=pkg.enc&key=api.token`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const viewBody: any = await viewRes.json();
      assert.strictEqual(viewBody.item.secret, true, "管理视图不得回显秘密");
      assert.strictEqual(viewBody.item.value, undefined);
    } finally {
      await legacyServer.stop();
      await legacyHost.close();
    }

    // 场景二：密钥丢失后 GET 读取加密行 -> 加密错误原样透传
    const lostKeyDir = makeTempDir("ad-enc-http-lostkey-");
    const seeder = new DefaultPackageRuntime({
      projectConfig: makeProjectConfig({ "api.token": { ...SECRET_STRING_DECL } }),
      dataDir: lostKeyDir,
    });
    await seeder.setConfig("api.token", "http-encrypted-secret");
    await seeder.close();
    rmSync(join(lostKeyDir, "keys"), { recursive: true, force: true });

    const lostKeyHost = await createActionDockHost({
      packages: [{ projectConfig: makeProjectConfig({ "api.token": { ...SECRET_STRING_DECL } }) }],
      dataDir: lostKeyDir,
      autoLoadCurrentProject: false,
    });
    const lostKeyServer = await startActionDockServer({
      port: 0,
      hostname: "127.0.0.1",
      token,
      service: lostKeyHost,
      enableManagement: true,
      packageAllowlist: ["*"],
    });
    try {
      const getRes = await fetch(
        `http://127.0.0.1:${lostKeyServer.port}/api/v2/config?package=pkg.enc&key=api.token`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      assert.strictEqual(getRes.status, 500);
      const body: any = await getRes.json();
      assert.ok(
        body.error.code === CONFIG_ENCRYPTION_ERROR || body.error.code === CONFIG_DECRYPT_FAILED,
        `加密错误必须原样透传，实际收到: ${body.error.code}`
      );
      assert.notStrictEqual(body.error.code, "CONFIG_LIST_ERROR");

      const listRes = await fetch(
        `http://127.0.0.1:${lostKeyServer.port}/api/v2/config?package=pkg.enc`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      assert.strictEqual(listRes.status, 500);
      const listBody: any = await listRes.json();
      assert.ok(
        listBody.error.code === CONFIG_ENCRYPTION_ERROR || listBody.error.code === CONFIG_DECRYPT_FAILED,
        `列表读取同样必须原样透传加密错误，实际收到: ${listBody.error.code}`
      );
    } finally {
      await lostKeyServer.stop();
      await lostKeyHost.close();
    }
  });
});
