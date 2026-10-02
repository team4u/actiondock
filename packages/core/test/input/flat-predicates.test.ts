import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isFlatPathPropertyName,
  isForbiddenActionInputPropertyName,
  FORBIDDEN_ACTION_INPUT_PROPERTIES,
  isFlatSafePropertyName,
} from "../../src/input";

describe("Flat Predicates", () => {
  describe("isFlatPathPropertyName", () => {
    it("接受合法标识符（字母开头，包含字母、数字、下划线、中划线）", () => {
      assert.strictEqual(isFlatPathPropertyName("name"), true);
      assert.strictEqual(isFlatPathPropertyName("user_name"), true);
      assert.strictEqual(isFlatPathPropertyName("user-name"), true);
      assert.strictEqual(isFlatPathPropertyName("_internal"), true);
      assert.strictEqual(isFlatPathPropertyName("item123"), true);
      assert.strictEqual(isFlatPathPropertyName("A"), true);
    });

    it("拒绝非法标识符（包含点、斜杠、空格、数字开头等）", () => {
      assert.strictEqual(isFlatPathPropertyName(""), false);
      assert.strictEqual(isFlatPathPropertyName("123"), false);
      assert.strictEqual(isFlatPathPropertyName("1item"), false);
      assert.strictEqual(isFlatPathPropertyName("-dash"), false);
      assert.strictEqual(isFlatPathPropertyName("user name"), false);
      assert.strictEqual(isFlatPathPropertyName("user.name"), false);
      assert.strictEqual(isFlatPathPropertyName("user/name"), false);
      assert.strictEqual(isFlatPathPropertyName("user@name"), false);
      assert.strictEqual(isFlatPathPropertyName("user$name"), false);
    });
  });

  describe("isForbiddenActionInputPropertyName 与 FORBIDDEN_ACTION_INPUT_PROPERTIES", () => {
    it("识别禁止属性名 __proto__、constructor、prototype", () => {
      assert.strictEqual(isForbiddenActionInputPropertyName("__proto__"), true);
      assert.strictEqual(isForbiddenActionInputPropertyName("constructor"), true);
      assert.strictEqual(isForbiddenActionInputPropertyName("prototype"), true);
    });

    it("放行普通属性名", () => {
      assert.strictEqual(isForbiddenActionInputPropertyName("name"), false);
      assert.strictEqual(isForbiddenActionInputPropertyName("proto"), false);
      assert.strictEqual(isForbiddenActionInputPropertyName("construct"), false);
      assert.strictEqual(isForbiddenActionInputPropertyName("type"), false);
    });

    it("FORBIDDEN_ACTION_INPUT_PROPERTIES 为冻结数组且包含全部禁止属性", () => {
      assert.strictEqual(Object.isFrozen(FORBIDDEN_ACTION_INPUT_PROPERTIES), true);
      assert.deepStrictEqual(Array.from(FORBIDDEN_ACTION_INPUT_PROPERTIES), [
        "__proto__",
        "constructor",
        "prototype",
      ]);
    });
  });

  describe("isFlatSafePropertyName", () => {
    it("当且仅当属性名合法且非禁止属性时返回 true", () => {
      assert.strictEqual(isFlatSafePropertyName("title"), true);
      assert.strictEqual(isFlatSafePropertyName("user_id"), true);

      // 禁止属性即便符合语法命名也返回 false
      assert.strictEqual(isFlatSafePropertyName("constructor"), false);
      assert.strictEqual(isFlatSafePropertyName("__proto__"), false);
      assert.strictEqual(isFlatSafePropertyName("prototype"), false);

      // 语法非法的属性名返回 false
      assert.strictEqual(isFlatSafePropertyName("user name"), false);
      assert.strictEqual(isFlatSafePropertyName("123"), false);
    });
  });
});
