import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSecretConfigKey,
  redactConfigValue,
  redactConfigValueForDeclarations,
  sanitizeConfigDefinitions,
} from "../src/storage/mask";
import type { ConfigItemDefinition } from "../src/project/types";

describe("配置值脱敏与安全视图纯函数", () => {
  it("正确识别外层及模式嵌套敏感配置", () => {
    const topSecret: ConfigItemDefinition = { secret: true };
    assert.strictEqual(isSecretConfigKey("api.key", topSecret), true);

    const schemaPropSecret: ConfigItemDefinition = {
      schema: {
        type: "object",
        properties: {
          token: { type: "string", secret: true },
        },
      },
    };
    assert.strictEqual(isSecretConfigKey("auth", schemaPropSecret), true);

    const schemaItemSecret: ConfigItemDefinition = {
      schema: {
        type: "array",
        items: { type: "string", secret: true },
      },
    };
    assert.strictEqual(isSecretConfigKey("tokens", schemaItemSecret), true);

    const schemaAdditionalSecret: ConfigItemDefinition = {
      schema: {
        type: "object",
        additionalProperties: { type: "string", secret: true },
      },
    };
    assert.strictEqual(isSecretConfigKey("custom", schemaAdditionalSecret), true);

    const nonSecret: ConfigItemDefinition = {
      type: "string",
      schema: { type: "string" },
    };
    assert.strictEqual(isSecretConfigKey("url", nonSecret), false);
  });

  it("整项敏感与 undefined 处理", () => {
    const secretItem: ConfigItemDefinition = { secret: true };

    // 值为 undefined 时不生成虚假脱敏路径
    const unconfigured = redactConfigValue(undefined, secretItem);
    assert.strictEqual(unconfigured.value, undefined);
    assert.strictEqual(unconfigured.secret, true);
    assert.deepStrictEqual(unconfigured.redactedPaths, []);

    // 具有默认值或实体值时生成根路径隐藏
    const withDefault = redactConfigValue("default_password", secretItem);
    assert.strictEqual(withDefault.value, undefined);
    assert.strictEqual(withDefault.secret, true);
    assert.deepStrictEqual(withDefault.redactedPaths, [""]);
  });

  it("缺失可选敏感字段时保留对象缺失状态且 secret 为 true", () => {
    const item: ConfigItemDefinition = {
      schema: {
        type: "object",
        properties: {
          username: { type: "string" },
          optionalPassword: { type: "string", secret: true },
        },
      },
    };

    const actual = { username: "operator" };
    const res = redactConfigValue(actual, item);

    // 不添加 undefined 键
    assert.deepStrictEqual(res.value, { username: "operator" });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(res.value, "optionalPassword"), false);
    // 反映声明包含敏感字段，此时脱敏路径为空
    assert.strictEqual(res.secret, true);
    assert.deepStrictEqual(res.redactedPaths, []);
  });

  it("对象未知属性与嵌套未知对象保守隐藏", () => {
    const item: ConfigItemDefinition = {
      schema: {
        type: "object",
        properties: {
          declaredHost: { type: "string" },
          sub: {
            type: "object",
            // 嵌套对象未声明内部属性
          },
        },
      },
    };

    const input = {
      declaredHost: "127.0.0.1",
      unknownKey: "hidden_payload",
      sub: {
        nestedUnknown: "inner_payload",
      },
    };

    const res = redactConfigValue(input, item);

    assert.deepStrictEqual(res.value, {
      declaredHost: "127.0.0.1",
      unknownKey: "********",
      sub: {
        nestedUnknown: "********",
      },
    });
    assert.strictEqual(res.secret, true);
    assert.deepStrictEqual(res.redactedPaths.sort(), ["/sub/nestedUnknown", "/unknownKey"].sort());
  });

  it("数组按 items 遍历无对应声明则元素隐藏", () => {
    // 数组带 items 且为 secret
    const itemWithSecretItems: ConfigItemDefinition = {
      schema: {
        type: "array",
        items: { type: "string", secret: true },
      },
    };
    const resA = redactConfigValue(["secret1", "secret2"], itemWithSecretItems);
    assert.deepStrictEqual(resA.value, ["********", "********"]);
    assert.deepStrictEqual(resA.redactedPaths, ["/0", "/1"]);

    // 数组无 items 声明，元素保守隐藏
    const itemWithoutItems: ConfigItemDefinition = {
      schema: {
        type: "array",
      },
    };
    const resB = redactConfigValue([100, 200], itemWithoutItems);
    assert.deepStrictEqual(resB.value, ["********", "********"]);
    assert.deepStrictEqual(resB.redactedPaths, ["/0", "/1"]);
  });

  it("动态 additionalProperties 模式继续遍历", () => {
    const item: ConfigItemDefinition = {
      schema: {
        type: "object",
        additionalProperties: {
          type: "string",
          secret: true,
        },
      },
    };

    const input = {
      customA: "secretA",
      customB: "secretB",
    };

    const res = redactConfigValue(input, item);
    assert.deepStrictEqual(res.value, {
      customA: "********",
      customB: "********",
    });
    assert.deepStrictEqual(res.redactedPaths.sort(), ["/customA", "/customB"].sort());
  });

  it("数据结构与声明不符时保守隐藏该节点", () => {
    const item: ConfigItemDefinition = {
      schema: {
        type: "object",
        properties: {
          port: { type: "integer" },
        },
      },
    };

    // 传入非整数
    const input = { port: "not-an-int" };
    const res = redactConfigValue(input, item);
    assert.deepStrictEqual(res.value, { port: "********" });
    assert.deepStrictEqual(res.redactedPaths, ["/port"]);
  });

  it("标准 JSON Pointer 字符转义处理", () => {
    const item: ConfigItemDefinition = {
      schema: {
        type: "object",
        properties: {
          "special/key~name": {
            type: "string",
            secret: true,
          },
        },
      },
    };

    const input = {
      "special/key~name": "sensitive",
    };

    const res = redactConfigValue(input, item);
    assert.deepStrictEqual(res.value, {
      "special/key~name": "********",
    });
    // 转义规则：~ 替换为 ~0，/ 替换为 ~1
    assert.deepStrictEqual(res.redactedPaths, ["/special~1key~0name"]);
  });

  it("纯函数不变性保证原对象不被篡改", () => {
    const item: ConfigItemDefinition = {
      schema: {
        type: "object",
        properties: {
          nested: {
            type: "object",
            properties: {
              secretToken: { type: "string", secret: true },
            },
          },
        },
      },
    };

    const original = {
      nested: {
        secretToken: "original_raw_token",
      },
    };

    const originalCopy = JSON.parse(JSON.stringify(original));
    redactConfigValue(original, item);

    assert.deepStrictEqual(original, originalCopy);
  });

  it("跨声明合并脱敏取路径并集且祖先路径覆盖子路径", () => {
    // 声明 A：只保护 credentials 下的 token
    const itemA: ConfigItemDefinition = {
      schema: {
        type: "object",
        properties: {
          credentials: {
            type: "object",
            properties: {
              token: { type: "string", secret: true },
              name: { type: "string" },
            },
          },
        },
      },
    };

    // 声明 B：将整个 credentials 节点作为未知结构或敏感对象保护
    const itemB: ConfigItemDefinition = {
      schema: {
        type: "object",
        properties: {
          credentials: {
            type: "object",
            secret: true,
          },
        },
      },
    };

    const input = {
      credentials: {
        token: "tok_123",
        name: "test-user",
      },
    };

    const merged = redactConfigValueForDeclarations(input, [itemA, itemB]);
    // 祖先路径 /credentials 覆盖子路径 /credentials/token
    assert.deepStrictEqual(merged.redactedPaths, ["/credentials"]);
    assert.deepStrictEqual(merged.value, {
      credentials: "********",
    });
    assert.strictEqual(merged.secret, true);
  });

  it("任意声明整项敏感则合并视图隐藏整个根", () => {
    const itemTopSecret: ConfigItemDefinition = {
      secret: true,
    };
    const itemNormal: ConfigItemDefinition = {
      schema: {
        type: "object",
        properties: {
          foo: { type: "string" },
        },
      },
    };

    const res = redactConfigValueForDeclarations({ foo: "bar" }, [itemNormal, itemTopSecret]);
    assert.strictEqual(res.value, undefined);
    assert.strictEqual(res.secret, true);
    assert.deepStrictEqual(res.redactedPaths, [""]);
  });

  it("清洗配置定义字典时不泄露敏感 default 且清洗 enum 约束", () => {
    const originalDefs: Record<string, ConfigItemDefinition> = {
      apiKey: {
        type: "string",
        secret: true,
        default: "super-secret-key",
      },
      dbSettings: {
        type: "object",
        default: { user: "admin", pass: "123456" },
        schema: {
          type: "object",
          properties: {
            user: { type: "string" },
            pass: {
              type: "string",
              secret: true,
              enum: ["123456", "adminpass"],
            },
          },
        },
      },
      normal: {
        type: "string",
        default: "safe_default",
      },
    };

    const originalJson = JSON.stringify(originalDefs);
    const sanitized = sanitizeConfigDefinitions(originalDefs);

    // 纯函数不变性
    assert.strictEqual(JSON.stringify(originalDefs), originalJson);
    assert.ok(sanitized);

    // 顶层敏感项剥离 default
    assert.strictEqual(sanitized.apiKey.default, undefined);

    // 模式包含字段级敏感项时剥离 default
    assert.strictEqual(sanitized.dbSettings.default, undefined);

    // 敏感节点的 enum 约束列表被剥离
    const passSchema = sanitized.dbSettings.schema?.properties?.pass;
    assert.strictEqual(passSchema?.enum, undefined);

    // 普通配置项不受影响
    assert.strictEqual(sanitized.normal.default, "safe_default");
  });
});
