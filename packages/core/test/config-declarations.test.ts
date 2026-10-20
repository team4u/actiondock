import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ActionDockError,
  CONFIG_VALUE_INVALID,
  INVALID_ARGUMENT,
  MANIFEST_INVALID,
} from "../src/errors";
import {
  assertConcreteConfigKey,
  assertValidConfigDeclarations,
  isConfigTemplate,
  resolveConfigDeclaration,
  validateConfigDeclarations,
  validateConfigValue,
} from "../src/project/config-declarations";
import { loadManifest, validateManifest } from "../src/project/manifest";
import { loadProjectConfig } from "../src/project/loader";

describe("配置声明与通配模板解析", () => {
  it("正确识别模板键与具体键", () => {
    assert.strictEqual(isConfigTemplate("services.*.apiKey"), true);
    assert.strictEqual(isConfigTemplate("*"), true);
    assert.strictEqual(isConfigTemplate("prefix.*"), true);
    assert.strictEqual(isConfigTemplate("database.url"), false);
    assert.strictEqual(isConfigTemplate(""), false);
  });

  it("断言具体配置键拒绝模板键与非法字符串", () => {
    assert.throws(
      () => assertConcreteConfigKey("services.*.apiKey"),
      (err: any) => err instanceof ActionDockError && err.code === INVALID_ARGUMENT
    );
    assert.throws(
      () => assertConcreteConfigKey(""),
      (err: any) => err instanceof ActionDockError && err.code === INVALID_ARGUMENT
    );
    assert.doesNotThrow(() => assertConcreteConfigKey("database.url"));
  });

  it("具体键严格优先于模板命中", () => {
    const config = {
      "services.github.token": {
        description: "具体声明项",
        type: "string" as const,
      },
      "services.*.token": {
        description: "模板声明项",
        type: "string" as const,
      },
    };

    const resolved = resolveConfigDeclaration(config, "services.github.token");
    assert.ok(resolved);
    assert.strictEqual(resolved.key, "services.github.token");
    assert.strictEqual(resolved.item.description, "具体声明项");
    assert.strictEqual(resolved.template, undefined);
  });

  it("支持单星号模板匹配合法字符并完整锚定", () => {
    const config = {
      "cluster.*.endpoint": {
        type: "string" as const,
      },
    };

    const hit = resolveConfigDeclaration(config, "cluster.us-east-1.endpoint");
    assert.ok(hit);
    assert.strictEqual(hit.key, "cluster.*.endpoint");
    assert.strictEqual(hit.template, "cluster.*.endpoint");

    // 星号必须匹配至少一个字符
    assert.strictEqual(resolveConfigDeclaration(config, "cluster..endpoint"), undefined);

    // 含有非法字符时拒绝匹配
    assert.strictEqual(resolveConfigDeclaration(config, "cluster.us/east.endpoint"), undefined);
    assert.strictEqual(resolveConfigDeclaration(config, "cluster.us east.endpoint"), undefined);
  });

  it("正确转义模板中的字面字符", () => {
    const config = {
      "api.v1.*.key": {
        type: "string" as const,
      },
    };

    // 点字符不被当作正则通配符
    assert.strictEqual(resolveConfigDeclaration(config, "apiXv1XsubXkey"), undefined);
    assert.ok(resolveConfigDeclaration(config, "api.v1.sub.key"));
  });

  it("最长前缀优先再最长后缀匹配且禁止依赖对象枚举顺序", () => {
    // 构造不同定义顺序的对象以验证顺序无关性
    const configA = {
      "services.*": { description: "泛化前缀" },
      "services.*.auth.token": { description: "最长后缀" },
      "services.gateway.*.token": { description: "最长前缀" },
    };

    const configB = {
      "services.gateway.*.token": { description: "最长前缀" },
      "services.*.auth.token": { description: "最长后缀" },
      "services.*": { description: "泛化前缀" },
    };

    // 最长前缀胜出
    const hitA = resolveConfigDeclaration(configA, "services.gateway.main.token");
    const hitB = resolveConfigDeclaration(configB, "services.gateway.main.token");
    assert.strictEqual(hitA?.item.description, "最长前缀");
    assert.strictEqual(hitB?.item.description, "最长前缀");

    // 前缀相同时最长后缀胜出
    const configSuffix = {
      "env.*": { description: "短后缀" },
      "env.*.config": { description: "长后缀" },
    };
    const hitSuffix = resolveConfigDeclaration(configSuffix, "env.prod.config");
    assert.strictEqual(hitSuffix?.item.description, "长后缀");
  });

  it("模板声明中禁止出现 required、default 和 env 字段", () => {
    const withRequired = {
      "servers.*": {
        required: false,
      },
    };
    const withDefault = {
      "servers.*": {
        default: undefined,
      },
    };
    const withEnv = {
      "servers.*": {
        env: "SERVERS_ENV",
      },
    };

    assert.ok(validateConfigDeclarations(withRequired).length > 0);
    assert.ok(validateConfigDeclarations(withDefault).length > 0);
    assert.ok(validateConfigDeclarations(withEnv).length > 0);

    assert.throws(
      () => assertValidConfigDeclarations(withRequired),
      (err: any) => err instanceof ActionDockError && err.code === MANIFEST_INVALID
    );
  });

  it("禁止模板包含多个星号通配符", () => {
    const multiStar = {
      "services.*.nodes.*": {
        type: "string" as const,
      },
    };
    const errors = validateConfigDeclarations(multiStar);
    assert.ok(errors.some((e) => e.includes("must contain exactly one '*' wildcard")));
  });

  it("递归检查模式关键字白名单与字段类型约束", () => {
    // 禁止非白名单关键字如 $ref
    const invalidKeyword = {
      dbConfig: {
        schema: {
          type: "object" as const,
          $ref: "#/definitions/db",
        },
      },
    };
    assert.ok(
      validateConfigDeclarations(invalidKeyword).some((e) => e.includes("unsupported keyword '$ref'"))
    );

    // secret 必须为布尔值
    const invalidSecretType = {
      secretToken: {
        schema: {
          type: "string" as const,
          secret: "true" as any,
        },
      },
    };
    assert.ok(
      validateConfigDeclarations(invalidSecretType).some((e) => e.includes("property 'secret' must be a boolean"))
    );

    // 外层 type 与根模式 type 一致性
    const incompatibleType = {
      port: {
        type: "string" as const,
        schema: {
          type: "number" as const,
        },
      },
    };
    assert.ok(
      validateConfigDeclarations(incompatibleType).some((e) => e.includes("incompatible"))
    );

    // 外层 number 兼容模式 integer
    const compatibleInteger = {
      port: {
        type: "number" as const,
        schema: {
          type: "integer" as const,
        },
      },
    };
    assert.strictEqual(validateConfigDeclarations(compatibleInteger).length, 0);
  });

  it("配置值校验在模式不满足时抛出 CONFIG_VALUE_INVALID 且不泄漏敏感实值", () => {
    const secretItem = {
      schema: {
        type: "object" as const,
        properties: {
          password: {
            type: "string" as const,
            minLength: 12,
            secret: true,
          },
        },
        required: ["password"],
      },
    };

    const actualSecretValue = {
      password: "short_pwd",
    };

    assert.throws(
      () => validateConfigValue("auth.credentials", actualSecretValue, secretItem),
      (err: any) => {
        assert.ok(err instanceof ActionDockError);
        assert.strictEqual(err.code, CONFIG_VALUE_INVALID);
        assert.ok(err.message.includes("auth.credentials"));
        assert.ok(err.message.includes("/password"));
        // 关键断言：错误信息与细节中严禁包含敏感原始数据
        assert.strictEqual(err.message.includes("short_pwd"), false);
        const detailsJson = JSON.stringify(err.details || {});
        assert.strictEqual(detailsJson.includes("short_pwd"), false);
        return true;
      }
    );

    // 值为 undefined 时不校验（由运行时诊断处理）
    assert.doesNotThrow(() => validateConfigValue("auth.credentials", undefined, secretItem));
  });

  it("清单加载与校验接入配置声明检查", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "actiondock-manifest-test-"));
    try {
      const manifestPath = join(tempDir, "actiondock.json");
      const badManifest = {
        id: "test.invalid-config",
        version: "1.0.0",
        config: {
          "service.*": {
            required: true,
          },
        },
      };
      writeFileSync(manifestPath, JSON.stringify(badManifest, null, 2), "utf-8");

      assert.throws(
        () => loadManifest(tempDir),
        (err: any) => err instanceof ActionDockError && err.code === MANIFEST_INVALID
      );

      assert.throws(
        () => loadProjectConfig(tempDir),
        (err: any) => err instanceof ActionDockError && err.code === MANIFEST_INVALID
      );

      const validation = validateManifest(badManifest);
      assert.strictEqual(validation.valid, false);
      assert.ok(validation.errors && validation.errors.length > 0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
