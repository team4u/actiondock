import { describe, expect, it } from "bun:test";
import { validateSchema } from "../src/schema/validator";

describe("JSON Schema Validator 测试套件", () => {
  it("处理空 Schema 或未定义 Schema 默认校验通过", () => {
    expect(validateSchema(undefined, { foo: "bar" }).valid).toBe(true);
    expect(validateSchema({}, { foo: "bar" }).valid).toBe(true);
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
    expect(pass.valid).toBe(true);

    const fail = validateSchema(schema, { age: 30 });
    expect(fail.valid).toBe(false);
    expect(fail.errors).toBeDefined();
    expect(fail.errors!.length).toBeGreaterThan(0);
  });

  it("相同引用的 Schema 多次校验命中 WeakMap 缓存", () => {
    const schema = {
      type: "object",
      properties: {
        title: { type: "string" },
      },
    };

    const res1 = validateSchema(schema, { title: "First" });
    expect(res1.valid).toBe(true);

    const res2 = validateSchema(schema, { title: "Second" });
    expect(res2.valid).toBe(true);

    const res3 = validateSchema(schema, { title: 123 });
    expect(res3.valid).toBe(false);
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
    expect(res1.valid).toBe(true);

    // 第二次校验不同实例但相同 $id 的 instance2，确保不会抛出 "schema with key or id already exists"
    const res2 = validateSchema(schemaInstance2, {
      username: "deepmind",
      email: "deepmind@actiondock.dev",
    });
    expect(res2.valid).toBe(true);

    // 校验 instance2 在数据不合规时正确报错
    const res3 = validateSchema(schemaInstance2, {
      username: "deepmind",
      email: "not-an-email",
    });
    expect(res3.valid).toBe(false);
    expect(res3.errors).toBeDefined();
    expect(res3.errors?.some((e) => e.includes("email"))).toBe(true);
  });
});
