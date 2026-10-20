import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONFIG_VALUE_INVALID,
  INVALID_ARGUMENT,
  ActionDockError,
} from "../src/errors";
import { RuntimeConfig } from "../src/runtime/context";
import { DefaultPackageRuntime } from "../src/package/runtime";
import { createActionDockHost } from "../src/host";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";

describe("核心运行时与全局配置集成契约", () => {
  it("Action 原值读取与不同来源 Schema 严格校验", async () => {
    const storage = new SqliteRuntimeStorage({
      dbPath: ":memory:",
      packageId: "pkg.test",
    });

    const projectConfig = {
      id: "pkg.test",
      name: "pkg.test",
      version: "1.0.0",
      config: {
        "server.port": {
          type: "number" as const,
          schema: {
            type: "integer" as const,
            minimum: 1024,
            maximum: 65535,
          },
        },
        "server.*.token": {
          type: "string" as const,
          schema: {
            type: "string" as const,
            minLength: 6,
            secret: true,
          },
        },
      },
    };

    // 1. 合法值正常获取原值
    const validConfig = new RuntimeConfig(
      storage,
      { "server.port": 8080, "server.api.token": "valid_token" },
      projectConfig
    );
    assert.strictEqual(validConfig.get("server.port"), 8080);
    assert.strictEqual(validConfig.get("server.api.token"), "valid_token");

    // 2. 违反 Schema 抛出 CONFIG_VALUE_INVALID
    const invalidConfig = new RuntimeConfig(
      storage,
      { "server.port": 80 }, // 小于 minimum: 1024
      projectConfig
    );
    assert.throws(
      () => invalidConfig.get("server.port"),
      (err: any) => err instanceof ActionDockError && err.code === CONFIG_VALUE_INVALID
    );

    // 3. 调用方 fallback 不进行 Schema 校验
    const fallbackVal = invalidConfig.get("unconfigured.port", 80);
    assert.strictEqual(fallbackVal, 80);
  });

  it("管理视图面对存量非法值不抛异常而安全脱敏展示", async () => {
    const runtime = new DefaultPackageRuntime({
      inMemory: true,
      projectConfig: {
        id: "pkg.legacy",
        name: "pkg.legacy",
        version: "1.0.0",
        config: {
          credentials: {
            type: "object",
            schema: {
              type: "object",
              properties: {
                token: { type: "string", minLength: 10, secret: true },
              },
            },
          },
        },
      },
      configOverrides: {
        // 存量非法数据：不是 object
        credentials: "corrupted_non_object",
      },
    });

    // describe 与管理端读取正常执行且保守隐藏
    const view = await runtime.getConfig("credentials");
    assert.strictEqual(view.key, "credentials");
    assert.strictEqual(view.secret, true);
    assert.strictEqual(view.value, "********");
    assert.deepStrictEqual(view.redactedPaths, [""]);
    await runtime.close();
  });

  it("非法配置写入时拦截并完整保留旧值", async () => {
    const runtime = new DefaultPackageRuntime({
      inMemory: true,
      projectConfig: {
        id: "pkg.mutate",
        name: "pkg.mutate",
        version: "1.0.0",
        config: {
          rateLimit: {
            type: "number",
            schema: {
              type: "integer",
              minimum: 1,
            },
          },
        },
      },
    });

    // 先写入合法初值
    await runtime.setConfig("rateLimit", 100);
    let current = await runtime.getConfig("rateLimit");
    assert.strictEqual(current.value, 100);

    // 尝试写入不满足 Schema 的数据（例如负数）
    await assert.rejects(
      async () => runtime.setConfig("rateLimit", -5),
      (err: any) => err instanceof ActionDockError && err.code === CONFIG_VALUE_INVALID
    );

    // 校验旧值未被篡改污染
    current = await runtime.getConfig("rateLimit");
    assert.strictEqual(current.value, 100);
    await runtime.close();
  });

  it("运行时与宿主管理操作严禁寻址模板键", async () => {
    const runtime = new DefaultPackageRuntime({
      inMemory: true,
      projectConfig: {
        id: "pkg.template-reject",
        name: "pkg.template-reject",
        version: "1.0.0",
        config: {
          "service.*.token": {
            type: "string",
          },
        },
      },
    });

    await assert.rejects(
      async () => runtime.getConfig("service.*.token"),
      (err: any) => err instanceof ActionDockError && err.code === INVALID_ARGUMENT
    );
    await assert.rejects(
      async () => runtime.setConfig("service.*.token", "val"),
      (err: any) => err instanceof ActionDockError && err.code === INVALID_ARGUMENT
    );
    await assert.rejects(
      async () => runtime.deleteConfig("service.*.token"),
      (err: any) => err instanceof ActionDockError && err.code === INVALID_ARGUMENT
    );
    await runtime.close();
  });

  it("多包合并时保护范围取并集且具体声明不撤销另一包模板保护", async () => {
    const pkg1 = new DefaultPackageRuntime({
      inMemory: true,
      projectConfig: {
        id: "pkg.security",
        name: "pkg.security",
        version: "1.0.0",
        config: {
          // 模板要求敏感字段脱敏
          "db.*": {
            schema: {
              type: "object",
              properties: {
                host: { type: "string" },
                password: { type: "string", secret: true },
              },
            },
          },
        },
      },
    });

    const pkg2 = new DefaultPackageRuntime({
      inMemory: true,
      projectConfig: {
        id: "pkg.consumer",
        name: "pkg.consumer",
        version: "1.0.0",
        config: {
          // 具体键未标记敏感
          "db.main": {
            type: "object",
          },
        },
      },
    });

    const host = await createActionDockHost({
      packages: [
        { projectConfig: pkg1.projectConfig, inMemory: true },
        { projectConfig: pkg2.projectConfig, inMemory: true },
      ],
      inMemory: true,
      autoLoadCurrentProject: false,
    });

    // 在全局存储设置共享配置值
    await host.setConfig("global", "db.main", {
      host: "localhost",
      password: "raw_secret_password",
    });

    // 1. 全局管理视图检查：pkg1 的模板敏感保护被合并
    const globalView = await host.getConfig("global", "db.main");
    assert.strictEqual(globalView.secret, true);
    assert.deepStrictEqual(globalView.value, {
      host: "localhost",
      password: "********",
    });
    assert.deepStrictEqual(globalView.redactedPaths, ["/password"]);

    // 2. 包级管理视图检查：pkg2 读取全局值时不绕过 pkg1 的保护
    const pkg2View = await host.getConfig("pkg.consumer", "db.main");
    assert.strictEqual(pkg2View.secret, true);
    assert.deepStrictEqual(pkg2View.value, {
      host: "localhost",
      password: "********",
    });
    assert.deepStrictEqual(pkg2View.redactedPaths, ["/password"]);

    // 3. 全局 setConfig 对所有有效声明严格校验
    await assert.rejects(
      async () =>
        host.setConfig("global", "db.main", {
          password: 12345, // 违反 pkg1 模式中的 type: string
        }),
      (err: any) => err instanceof ActionDockError && err.code === CONFIG_VALUE_INVALID
    );

    await host.close();
    await pkg1.close();
    await pkg2.close();
  });
});
