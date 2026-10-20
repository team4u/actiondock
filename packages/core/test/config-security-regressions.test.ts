import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createActionDockHost } from "../src/host";
import { startActionDockServer } from "../src/server";
import { RemoteActionDockService } from "../src/service/remote";
import { normalizeRemoteConfigResponse } from "../src/client/config";
import { resolveConfigDeclaration, validateConfigDeclarations } from "../src/project/config-declarations";
import type { ConfigItemDefinition } from "../src/project/types";
import { redactConfigValue, redactConfigValueAtPaths, sanitizeConfigDefinitions } from "../src/storage/mask";
import { RuntimeConfig } from "../src/runtime/context";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import { CONFIG_VALUE_INVALID, PROTOCOL_UNSUPPORTED } from "../src/errors";
import { DefaultPackageRuntime } from "../src/package/runtime";
import { defineAction } from "@actiondock/sdk";

const connection: ConfigItemDefinition = {
  schema: {
    type: "object",
    properties: { host: { type: "string" }, password: { type: "string", secret: true } },
    additionalProperties: false,
  },
};

const response = <T>(value: T, paths: string[] = [], secret = true) => ({
  configViewVersion: 1,
  packageId: "config.remote",
  declared: {},
  items: [{ key: "MYSQL_MAIN", source: "env", configured: true, secret, value, redactedPaths: paths }],
});

describe("配置安全边界回归", () => {
  it("实际应用远端路径而非信任路径已掩码，本地弱声明不撤销保护", () => {
    const raw = response({ host: "h", password: "raw-password" }, ["/password"]);
    const normalized = normalizeRemoteConfigResponse(raw, { localDeclarations: { MYSQL_MAIN: {} } });
    assert.deepEqual(normalized.items[0].value, { host: "h", password: "********" });
    assert.equal(normalized.items[0].source, "env");
    assert.equal(normalized.items[0].secret, true);
    assert.equal(JSON.stringify(normalized).includes("raw-password"), false);
    assert.equal(raw.items[0].value.password, "raw-password");
  });

  it("可选秘密字段缺失与未配置不是旧协议，默认值的隐藏路径不能丢失", () => {
    const raw = response({ host: "h" });
    raw.declared = { MYSQL_MAIN: connection };
    const safe = normalizeRemoteConfigResponse(raw);
    assert.deepEqual(safe.items[0].value, { host: "h" });
    assert.deepEqual(safe.items[0].redactedPaths, []);
    const defaultView = response(undefined, [""]);
    defaultView.items[0].source = "default";
    defaultView.items[0].configured = false;
    const hidden = normalizeRemoteConfigResponse(defaultView).items[0];
    assert.equal(hidden.configured, false);
    assert.deepEqual(hidden.redactedPaths, [""]);
  });

  it("旧协议响应被拒绝：不猜测来源、不返回空安全列表掩盖错误", () => {
    // 旧 values 字典响应无法证明来源与元数据，必须拒绝。
    assert.throws(
      () => normalizeRemoteConfigResponse({
        values: { NORMAL: "********" },
        declared: { NORMAL: { type: "string" }, "MYSQL_*": connection },
      }),
      (err: any) => err.code === PROTOCOL_UNSUPPORTED
    );
    // 旧别名（config 数组）响应同样拒绝，不得透传未知别名内容。
    assert.throws(
      () => normalizeRemoteConfigResponse({
        packageId: "other.package",
        config: [{ key: "KEY", value: "unknown-raw-secret" }],
        debug: { rawValue: "unknown-raw-secret" },
      }, { localPackageId: "local.package" }),
      (err: any) => err.code === PROTOCOL_UNSUPPORTED
    );
    // 新协议元数据不完整同样拒绝。
    assert.throws(
      () => normalizeRemoteConfigResponse({ configViewVersion: 1, values: { KEY: "raw" } }),
      (err: any) => err.code === PROTOCOL_UNSUPPORTED
    );
    const safe = normalizeRemoteConfigResponse(response({ password: "raw" }, ["/bad~2path"]));
    assert.equal(safe.items[0].value, undefined);
    assert.deepEqual(safe.items[0].redactedPaths, [""]);
  });

  it("根指针与空属性名指针不同，掩码不修改原对象", () => {
    const original = { "": "empty-key-secret", host: "h" };
    const safe = redactConfigValueAtPaths(original, ["/"]);
    assert.deepEqual(safe.value, { "": "********", host: "h" });
    assert.equal(original[""], "empty-key-secret");
    assert.equal(redactConfigValueAtPaths(original, [""]).value, undefined);
  });

  it("声明默认值与祖先枚举不能携带子字段秘密", () => {
    const definition: ConfigItemDefinition = {
      ...connection,
      default: { host: "h", password: "default-password" },
      schema: { ...connection.schema, enum: [{ host: "h", password: "enum-password" }] },
    };
    const safe = sanitizeConfigDefinitions({ MYSQL_MAIN: definition })!;
    assert.equal(safe.MYSQL_MAIN.default, undefined);
    assert.equal(safe.MYSQL_MAIN.schema!.enum, undefined);
    assert.equal(JSON.stringify(safe).includes("enum-password"), false);
    assert.deepEqual(definition.default, { host: "h", password: "default-password" });
    const unknownDefault = sanitizeConfigDefinitions({ KEY: { schema: { type: "object" }, default: { unknown: "raw" } } })!;
    assert.equal(unknownDefault.KEY.default, undefined);
  });

  it("未知原型属性是普通自有数据，不污染返回对象原型", () => {
    const raw = JSON.parse('{"__proto__":{"token":"raw"},"host":"h"}');
    const safe = redactConfigValue(raw, { schema: { type: "object", properties: { host: { type: "string" } } } });
    assert.ok(safe.value && typeof safe.value === "object");
    assert.equal(Object.getPrototypeOf(safe.value), Object.prototype);
    assert.equal(Object.hasOwn(safe.value!, "__proto__"), true);
    assert.equal((safe.value as any).__proto__, "********");
    assert.equal(({} as any).token, undefined);
  });

  it("省略根 type 不能让旧标量值绕过嵌套秘密字段保护", () => {
    const safe = redactConfigValue("raw-connection-string", { schema: { properties: { password: { secret: true } } } });
    assert.equal(safe.value, "********");
    assert.deepEqual(safe.redactedPaths, [""]);
  });

  it("模板完整匹配拒绝末尾换行和非法声明", () => {
    assert.equal(resolveConfigDeclaration({ "MYSQL_*": connection }, "MYSQL_MAIN\n"), undefined);
    assert.ok(validateConfigDeclarations({ "MYSQL_*": null }).length > 0);
    assert.ok(validateConfigDeclarations({ "MYSQL_*": { secret: "true" } }).length > 0);
  });

  it("读取校验覆盖存储、全局、环境、默认与覆盖，调用方回退不参与校验", (t) => {
    const storage = new SqliteRuntimeStorage({ dbPath: ":memory:", packageId: "config.sources" });
    const global = new SqliteRuntimeStorage({ dbPath: ":memory:", packageId: "global" });
    const key = "ACTIONDOCK_CONFIG_SOURCE_REGRESSION";
    const previous = process.env[key];
    t.after(() => { storage.close(); global.close(); if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    const config = { id: "config.sources", config: { [key]: { type: "number" as const, schema: { type: "integer" as const, minimum: 1 }, default: -1 } } };
    const read = (overrides = {}) => new RuntimeConfig(storage, overrides, config, global).get(key);
    const invalid = () => assert.throws(() => read(), { code: CONFIG_VALUE_INVALID });
    delete process.env[key];
    invalid();
    process.env[key] = "-2"; invalid();
    global.setConfig(key, -3); invalid();
    storage.setConfig(key, -4); invalid();
    assert.throws(() => read({ [key]: -5 }), { code: CONFIG_VALUE_INVALID });
    assert.equal(read({ [key]: 10 }), 10);
    assert.equal(new RuntimeConfig(storage, {}, config, global).get("missing", -100), -100);
  });

  it("全局取多个包不同敏感字段的并集，但 Action 仍读取完整原值", async (t) => {
    const fields = { host: { type: "string" as const }, password: { type: "string" as const }, token: { type: "string" as const } };
    const host = await createActionDockHost({
      inMemory: true, autoLoadCurrentProject: false,
      packages: [
        { projectConfig: { id: "config.first", config: { "MYSQL_*": { schema: { type: "object", properties: { ...fields, password: { type: "string", secret: true } } } } }, actions: { read: { entry: "" } } },
          actions: { read: defineAction((_input, ctx) => ctx.config.get("MYSQL_MAIN")) } },
        { projectConfig: { id: "config.second", config: { MYSQL_MAIN: { schema: { type: "object", properties: { ...fields, token: { type: "string", secret: true } } } } } } },
      ],
    });
    t.after(() => host.close());
    const raw = { host: "h", password: "raw-password", token: "raw-token" };
    await host.setConfig("global", "MYSQL_MAIN", raw);
    for (const scope of ["global", "config.first", "config.second"]) {
      const view = await host.getConfig(scope, "MYSQL_MAIN");
      assert.deepEqual(view.value, { host: "h", password: "********", token: "********" });
      assert.deepEqual([...view.redactedPaths].sort(), ["/password", "/token"]);
    }
    const result = await host.runAction("config.first/read", {});
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, raw);
  });

  it("外部运行时独立全局库的安全值不能被 Host 全局库替换", async (t) => {
    const global = new SqliteRuntimeStorage({ dbPath: ":memory:", packageId: "global" });
    global.setConfig("MYSQL_MAIN", { host: "external-host", password: "raw-password" });
    const external = new DefaultPackageRuntime({ inMemory: true, globalStorage: global, projectConfig: { id: "config.external" } });
    const host = await createActionDockHost({
      inMemory: true, autoLoadCurrentProject: false,
      packages: [external, { projectConfig: { id: "config.protection", config: { "MYSQL_*": connection } } }],
    });
    t.after(async () => { await host.close(); global.close(); });
    assert.equal((await host.getConfig("global", "MYSQL_MAIN")).configured, false);
    const view = await host.getConfig("config.external", "MYSQL_MAIN");
    assert.equal(view.source, "global");
    assert.deepEqual(view.value, { host: "external-host", password: "********" });
  });

  it("真实 HTTP 单键读取支持环境变量模板，非法远端写入保持旧值", async (t) => {
    const key = "MYSQL_ENVREGRESSION";
    const previous = process.env[key];
    process.env[key] = JSON.stringify({ host: "env-host", password: "env-password" });
    const host = await createActionDockHost({
      inMemory: true,
      autoLoadCurrentProject: false,
      packages: [{ projectConfig: { id: "config.remote", config: { "MYSQL_*": connection, env: { default: "reserved-key" } } } }],
    });
    const server = await startActionDockServer({ service: host, port: 0, hostname: "127.0.0.1", token: "config-test", enableManagement: true });
    const remote = new RemoteActionDockService({ serverUrl: `http://127.0.0.1:${server.port}`, token: "config-test" });
    t.after(async () => { await remote.close(); await server.stop(); await host.close(); if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    const reserved = await remote.management!.config.get("config.remote", "env");
    assert.equal(reserved.value, "reserved-key");
    assert.equal(reserved.configured, false);
    const view = await remote.management!.config.get("config.remote", key);
    assert.equal(view.source, "env");
    assert.deepEqual(view.value, { host: "env-host", password: "********" });
    assert.deepEqual(view.redactedPaths, ["/password"]);
    assert.equal((await remote.management!.config.list("config.remote")).some((item) => item.key === key), false);
    await remote.management!.config.set("config.remote", "MYSQL_MAIN", { host: "stored-host", password: "stored-password" });
    await assert.rejects(remote.management!.config.set("config.remote", "MYSQL_MAIN", { host: 123 }), { code: CONFIG_VALUE_INVALID, status: 400 });
    assert.deepEqual((await remote.management!.config.get("config.remote", "MYSQL_MAIN")).value, { host: "stored-host", password: "********" });
  });
});
