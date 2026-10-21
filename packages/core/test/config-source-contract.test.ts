import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RuntimeConfig } from "../src/runtime/context";
import { createPackageRuntime } from "../src/package/runtime";
import { createActionDockHost } from "../src/host";
import { startActionDockServer } from "../src/server";
import { RemoteActionDockService } from "../src/service/remote";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import type { ConfigSource } from "../src/service/types";
import { defineAction } from "@actiondock/sdk";

describe("配置来源契约统一（ConfigSource）", () => {
  it("导出的 ConfigSource 类型覆盖五种来源，describe 返回完整覆盖链", (t) => {
    const storage = new SqliteRuntimeStorage({ dbPath: ":memory:", packageId: "src.types" });
    const global = new SqliteRuntimeStorage({ dbPath: ":memory:", packageId: "global" });
    t.after(() => { storage.close(); global.close(); });
    const key = "SRC_CHAIN_KEY";
    const projectConfig = { id: "src.types", config: { [key]: { type: "string" as const } } };

    // 覆盖：固定覆盖与单次调用覆盖统一为 override
    const withOverride = new RuntimeConfig(storage, { [key]: "from-override" }, projectConfig, global);
    assert.equal(withOverride.describe(key).source, "override" satisfies ConfigSource);

    // 包级持久化
    storage.setConfig(key, "from-package");
    assert.equal(new RuntimeConfig(storage, {}, projectConfig, global).describe(key).source, "package" satisfies ConfigSource);
    storage.deleteConfig(key);

    // 全局持久化
    global.setConfig(key, "from-global");
    assert.equal(new RuntimeConfig(storage, {}, projectConfig, global).describe(key).source, "global" satisfies ConfigSource);
    global.deleteConfig(key);

    // 环境变量
    const previous = process.env[key];
    process.env[key] = "from-env";
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    assert.equal(new RuntimeConfig(storage, {}, projectConfig, global).describe(key).source, "env" satisfies ConfigSource);
    delete process.env[key];

    // 声明默认值真实生效
    const withDefault = { id: "src.types", config: { [key]: { type: "string" as const, default: "from-default" } } };
    assert.equal(new RuntimeConfig(storage, {}, withDefault, global).describe(key).source, "default" satisfies ConfigSource);

    // 整链未命中：source null，不用 default 伪装
    const emptyConfig = { id: "src.types", config: { [key]: { type: "string" as const } } };
    const miss = new RuntimeConfig(storage, {}, emptyConfig, global).describe(key);
    assert.equal(miss.source, null);
    assert.equal(miss.value, undefined);
  });

  it("undefined 统一视为未命中并继续解析；null/false/0/空串是真实值", (t) => {
    const storage = new SqliteRuntimeStorage({ dbPath: ":memory:", packageId: "src.falsy" });
    const global = new SqliteRuntimeStorage({ dbPath: ":memory:", packageId: "global" });
    t.after(() => { storage.close(); global.close(); });
    const key = "SRC_FALSY_KEY";
    const projectConfig = { id: "src.falsy", config: { [key]: { type: "object" as const } } };

    // 覆盖值为 undefined：继续向包级解析，不得谎报 override
    const config = new RuntimeConfig(storage, { [key]: undefined }, projectConfig, global);
    storage.setConfig(key, null);
    const resolved = config.describe(key);
    assert.equal(resolved.source, "package");
    assert.equal(resolved.value, null);

    // false/0/空串均为真实值且保持来源
    for (const falsy of [false, 0, ""] as const) {
      storage.setConfig(key, falsy);
      const view = config.describe(key);
      assert.equal(view.source, "package", `值 ${JSON.stringify(falsy)} 应为真实值`);
      assert.equal(view.value, falsy);
      assert.equal(config.has(key), true);
    }

    // 默认值为 null/false/0/空串：来源仍为 default
    storage.deleteConfig(key);
    for (const falsyDefault of [null, false, 0, ""] as const) {
      const withFalsyDefault = { id: "src.falsy", config: { [key]: { type: "object" as const, default: falsyDefault } } };
      const view = new RuntimeConfig(storage, {}, withFalsyDefault, global).describe(key);
      assert.equal(view.source, "default");
      assert.equal(view.value, falsyDefault);
    }
  });

  it("configured 仅对显式来源为 true，default 与 null 均为 false", async (t) => {
    const host = await createActionDockHost({
      inMemory: true,
      autoLoadCurrentProject: false,
      packages: [{
        projectConfig: {
          id: "src.configured",
          config: {
            SRC_DEFAULT_KEY: { type: "string", default: "declared" },
            SRC_REQUIRED_KEY: { type: "string" },
          },
        },
      }],
    });
    t.after(() => host.close());

    // default：configured false
    const declaredDefault = await host.getConfig("src.configured", "SRC_DEFAULT_KEY");
    assert.equal(declaredDefault.source, "default");
    assert.equal(declaredDefault.configured, false);

    // null（未配置且无默认值）：configured false，不得因 source 非 "default" 误判 true
    const unconfigured = await host.getConfig("src.configured", "SRC_REQUIRED_KEY");
    assert.equal(unconfigured.source, null);
    assert.equal(unconfigured.configured, false);

    // 显式来源：configured true
    await host.setConfig("src.configured", "SRC_REQUIRED_KEY", "stored");
    const stored = await host.getConfig("src.configured", "SRC_REQUIRED_KEY");
    assert.equal(stored.source, "package");
    assert.equal(stored.configured, true);

    const overrideRuntime = await createPackageRuntime({
      projectConfig: { id: "src.configured", config: { SRC_REQUIRED_KEY: { type: "string" } } },
      configOverrides: { SRC_REQUIRED_KEY: "cli-value" },
      inMemory: true,
    });
    const overridden = await overrideRuntime.getConfig("SRC_REQUIRED_KEY");
    assert.equal(overridden.source, "override");
    assert.equal(overridden.configured, true);
    await overrideRuntime.close();
  });

  it("环境变量与全局继承的来源在管理视图保持真实标注", async (t) => {
    const key = "SRC_ENV_HOST_KEY";
    const previous = process.env[key];
    process.env[key] = "env-value";
    const host = await createActionDockHost({
      inMemory: true,
      autoLoadCurrentProject: false,
      packages: [{ projectConfig: { id: "src.env", config: { [key]: { type: "string" } } } }],
    });
    t.after(async () => {
      if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
      await host.close();
    });

    const envView = await host.getConfig("src.env", key);
    assert.equal(envView.source, "env");
    assert.equal(envView.configured, true);

    // 清除环境变量后全局继承：来源为 global 且保留真实值
    delete process.env[key];
    await host.setConfig("global", key, "global-value");
    const globalView = await host.getConfig("src.env", key);
    assert.equal(globalView.source, "global");
    assert.equal(globalView.value, "global-value");
    assert.equal(globalView.configured, true);

    // 全局作用域直读：无值时 source null 而非 default
    const globalMiss = await host.getConfig("global", "SRC_NEVER_STORED");
    assert.equal(globalMiss.source, null);
    assert.equal(globalMiss.configured, false);
  });

  it("Action 读取优先级与原值保持，source null 不破坏 fallback 与 has", async (t) => {
    const host = await createActionDockHost({
      inMemory: true,
      autoLoadCurrentProject: false,
      packages: [{
        projectConfig: {
          id: "src.action",
          config: {
            SRC_ACTION_KEY: { type: "string" },
            SRC_FALLBACK_KEY: { type: "number" },
          },
        },
        actions: {
          read: defineAction((_input, ctx) => ({
            stored: ctx.config.get("SRC_ACTION_KEY") ?? null,
            fallback: ctx.config.get("SRC_FALLBACK_KEY", 42),
            hasStored: ctx.config.has("SRC_ACTION_KEY"),
            hasFallbackAfterSet: true,
          })),
        },
      }],
    });
    t.after(() => host.close());

    // 未配置：has false，调用方 fallback 生效
    const before = await host.runAction("src.action/read", {});
    assert.equal(before.ok, true);
    assert.deepEqual(before.data, { stored: null, fallback: 42, hasStored: false, hasFallbackAfterSet: true });

    // 持久化后：原值读取与 has 恢复
    await host.setConfig("src.action", "SRC_ACTION_KEY", "persisted");
    await host.setConfig("src.action", "SRC_FALLBACK_KEY", 7);
    const after = await host.runAction("src.action/read", {});
    assert.equal(after.ok, true);
    assert.deepEqual(after.data, { stored: "persisted", fallback: 7, hasStored: true, hasFallbackAfterSet: true });
  });

  it("远端 roundtrip 保持真实来源，管理 get 未命中返回 source null", async (t) => {
    const key = "SRC_ROUNDTRIP_KEY";
    const previous = process.env[key];
    process.env[key] = "env-roundtrip";
    const host = await createActionDockHost({
      inMemory: true,
      autoLoadCurrentProject: false,
      packages: [{
        projectConfig: {
          id: "src.remote",
          config: {
            [key]: { type: "string" },
            SRC_REMOTE_DEFAULT: { type: "string", default: "remote-default" },
          },
        },
      }],
    });
    const server = await startActionDockServer({
      service: host, port: 0, hostname: "127.0.0.1", token: "src-test", enableManagement: true, packageAllowlist: ["*"],
    });
    const remote = new RemoteActionDockService({ serverUrl: `http://127.0.0.1:${server.port}`, token: "src-test" });
    t.after(async () => {
      if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
      await remote.close();
      await server.stop();
      await host.close();
    });

    // env 来源 roundtrip 保持
    const envView = await remote.management!.config.get("src.remote", key);
    assert.equal(envView.source, "env");
    assert.equal(envView.configured, true);
    assert.equal(envView.value, "env-roundtrip");

    // default 来源 roundtrip 保持
    const defaultView = await remote.management!.config.get("src.remote", "SRC_REMOTE_DEFAULT");
    assert.equal(defaultView.source, "default");
    assert.equal(defaultView.configured, false);

    // 未命中：source null
    const missView = await remote.management!.config.get("src.remote", "SRC_REMOTE_MISSING");
    assert.equal(missView.source, null);
    assert.equal(missView.configured, false);

    // 持久化后 package 来源 roundtrip，且覆盖 env 优先级
    await remote.management!.config.set("src.remote", key, "stored-roundtrip");
    const packageView = await remote.management!.config.get("src.remote", key);
    assert.equal(packageView.source, "package");
    assert.equal(packageView.configured, true);
    assert.equal(packageView.value, "stored-roundtrip");
  });
});
