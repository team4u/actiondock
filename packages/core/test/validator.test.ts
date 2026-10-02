import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateSchema,
  validateSchemaOnly,
  hasDangerousKeys,
} from "../src/schema/validator";

describe("JSON Schema Validator 测试套件", () => {
  it("处理空 Schema 或未定义 Schema 默认校验通过", () => {
    assert.strictEqual(validateSchema(undefined, { foo: "bar" }).valid, true);
    assert.strictEqual(validateSchema({}, { foo: "bar" }).valid, true);
  });

  it("支持基础 Schema 校验成功与失败", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name"],
    };

    const pass = validateSchema(schema, { name: "Alice", age: 30 });
    assert.strictEqual(pass.valid, true);

    const fail = validateSchema(schema, { age: 30 });
    assert.strictEqual(fail.valid, false);
    assert.notStrictEqual(fail.errors, undefined);
    assert.ok((fail.errors!.length) > 0);
  });

  it("相同引用的 Schema 多次校验命中 WeakMap 缓存", () => {
    const schema = {
      type: "object",
      properties: {
        title: { type: "string" },
      },
    };

    const res1 = validateSchema(schema, { title: "First" });
    assert.strictEqual(res1.valid, true);

    const res2 = validateSchema(schema, { title: "Second" });
    assert.strictEqual(res2.valid, true);

    const res3 = validateSchema(schema, { title: 123 });
    assert.strictEqual(res3.valid, false);
  });

  it("包含相同 $id 的多个独立 Schema 对象实例反复校验不会抛出已存在异常", () => {
    const schemaId = "https://actiondock.dev/schemas/user-profile.json";

    const schemaInstance1 = {
      $id: schemaId,
      type: "object",
      properties: {
        username: { type: "string" },
        email: { type: "string", format: "email" },
      },
      required: ["username", "email"],
    };

    const schemaInstance2 = {
      $id: schemaId,
      type: "object",
      properties: {
        username: { type: "string" },
        email: { type: "string", format: "email" },
      },
      required: ["username", "email"],
    };

    // 第一次编译并校验 instance1
    const res1 = validateSchema(schemaInstance1, {
      username: "antigravity",
      email: "test@actiondock.dev",
    });
    assert.strictEqual(res1.valid, true);

    // 第二次校验不同实例但相同 $id 的 instance2，确保不会抛出 "schema with key or id already exists"
    const res2 = validateSchema(schemaInstance2, {
      username: "deepmind",
      email: "deepmind@actiondock.dev",
    });
    assert.strictEqual(res2.valid, true);

    // 校验 instance2 在数据不合规时正确报错
    const res3 = validateSchema(schemaInstance2, {
      username: "deepmind",
      email: "not-an-email",
    });
    assert.strictEqual(res3.valid, false);
    assert.notStrictEqual(res3.errors, undefined);
    assert.strictEqual(res3.errors?.some((e) => e.includes("email")), true);
  });

  it("支持布尔 Schema 校验：false 拒绝所有数据，true 允许合法数据", () => {
    const resFalse = validateSchema(false, { any: "data" });
    assert.strictEqual(resFalse.valid, false);
    assert.ok((resFalse.errors?.[0]).includes("Schema is false"));

    const resTrue = validateSchema(true, { key: 42 });
    assert.strictEqual(resTrue.valid, true);

    const resTrueDangerous = validateSchema(true, JSON.parse('{"__proto__": {"polluted": true}}'));
    assert.strictEqual(resTrueDangerous.valid, false);
  });

  it("相同 $id 但具有不同规则的 Schema 互不污染", () => {
    const sharedId = "https://actiondock.dev/schemas/dynamic.json";
    const stringSchema = {
      $id: sharedId,
      type: "object",
      properties: {
        val: { type: "string" },
      },
      required: ["val"],
    };
    const numberSchema = {
      $id: sharedId,
      type: "object",
      properties: {
        val: { type: "number" },
      },
      required: ["val"],
    };

    const res1 = validateSchema(stringSchema, { val: "hello" });
    assert.strictEqual(res1.valid, true);

    const res2 = validateSchema(numberSchema, { val: 123 });
    assert.strictEqual(res2.valid, true);

    const res3 = validateSchema(stringSchema, { val: 123 });
    assert.strictEqual(res3.valid, false);

    const res4 = validateSchema(numberSchema, { val: "hello" });
    assert.strictEqual(res4.valid, false);
  });

  it("深度递归拦截原型污染属性键名（__proto__、constructor、prototype）", () => {
    const nestedProto = {
      level1: {
        level2: JSON.parse('{"__proto__": "attack"}'),
      },
    };
    assert.strictEqual(validateSchema({}, nestedProto).valid, false);

    const arrayConstructor = [
      { ok: 1 },
      { level2: [JSON.parse('{"constructor": "attack"}')] },
    ];
    assert.strictEqual(validateSchema({}, arrayConstructor).valid, false);

    const deepPrototype = {
      items: [
        {
          meta: JSON.parse('{"prototype": "attack"}'),
        },
      ],
    };
    assert.strictEqual(validateSchema({}, deepPrototype).valid, false);
  });

  it("完全支持 Object.create(null) 无原型对象的数据校验", () => {
    const schema = {
      type: "object",
      properties: {
        foo: { type: "string" },
      },
      required: ["foo"],
    };

    const nullProtoObj = Object.create(null);
    nullProtoObj.foo = "bar";

    const res = validateSchema(schema, nullProtoObj);
    assert.strictEqual(res.valid, true);

    const nullProtoFail = Object.create(null);
    nullProtoFail.foo = 123;
    const resFail = validateSchema(schema, nullProtoFail);
    assert.strictEqual(resFail.valid, false);
  });

  it("validateSchemaOnly 仅校验 Schema 规则而不执行 dangerous-key 检查", () => {
    // false Schema 拒绝所有输入
    const resFalse = validateSchemaOnly(false, { a: 1 });
    assert.strictEqual(resFalse.valid, false);
    assert.ok((resFalse.errors?.[0]).includes("Schema is false"));

    // true, undefined, 空对象均通过
    assert.strictEqual(validateSchemaOnly(true, { a: 1 }).valid, true);
    assert.strictEqual(validateSchemaOnly(undefined, { a: 1 }).valid, true);
    assert.strictEqual(validateSchemaOnly({}, { a: 1 }).valid, true);

    // 包含原型污染键的数据在 validateSchemaOnly 下若无 schema 规则限制将直接通过
    const dangerous = JSON.parse('{"__proto__": {"evil": true}}');
    assert.strictEqual(validateSchemaOnly(undefined, dangerous).valid, true);
    assert.strictEqual(validateSchemaOnly({}, dangerous).valid, true);
  });

  it("hasDangerousKeys 与 validateSchema 支持 DAG 有向无环图安全遍历", () => {
    // 构造具备共享子结构的 DAG
    const leaf = { name: "shared-leaf", count: 42 };
    const dag = {
      nodeA: leaf,
      nodeB: leaf,
      items: [leaf, leaf],
    };

    assert.strictEqual(hasDangerousKeys(dag), false);

    const schema = {
      type: "object",
      properties: {
        nodeA: { type: "object" },
        nodeB: { type: "object" },
        items: { type: "array" },
      },
    };
    const res = validateSchema(schema, dag);
    assert.strictEqual(res.valid, true);
  });

  it("hasDangerousKeys 与 validateSchema 环路安全，杜绝调用栈溢出", () => {
    // 构造直接环路对象
    const circularObj: any = { title: "circular" };
    circularObj.self = circularObj;

    // 不会因递归导致 RangeError: Maximum call stack size exceeded
    assert.strictEqual(hasDangerousKeys(circularObj), false);

    // 构造带原型的环路对象
    const circularDangerous: any = { constructor: "danger" };
    circularDangerous.loop = circularDangerous;
    assert.strictEqual(hasDangerousKeys(circularDangerous), true);
  });
});
