import { describe, expect, it } from "bun:test";
import {
  isFlatPathPropertyName,
  isForbiddenActionInputPropertyName,
  FORBIDDEN_ACTION_INPUT_PROPERTIES,
  isFlatSafePropertyName,
} from "../../src/input";

describe("Flat Predicates", () => {
  describe("isFlatPathPropertyName", () => {
    it("接受合法标识符（字母开头，包含字母、数字、下划线、中划线）", () => {
      expect(isFlatPathPropertyName("name")).toBe(true);
      expect(isFlatPathPropertyName("user_name")).toBe(true);
      expect(isFlatPathPropertyName("user-name")).toBe(true);
      expect(isFlatPathPropertyName("_internal")).toBe(true);
      expect(isFlatPathPropertyName("item123")).toBe(true);
      expect(isFlatPathPropertyName("A")).toBe(true);
    });

    it("拒绝非法标识符（包含点、斜杠、空格、数字开头等）", () => {
      expect(isFlatPathPropertyName("")).toBe(false);
      expect(isFlatPathPropertyName("123")).toBe(false);
      expect(isFlatPathPropertyName("1item")).toBe(false);
      expect(isFlatPathPropertyName("-dash")).toBe(false);
      expect(isFlatPathPropertyName("user name")).toBe(false);
      expect(isFlatPathPropertyName("user.name")).toBe(false);
      expect(isFlatPathPropertyName("user/name")).toBe(false);
      expect(isFlatPathPropertyName("user@name")).toBe(false);
      expect(isFlatPathPropertyName("user$name")).toBe(false);
    });
  });

  describe("isForbiddenActionInputPropertyName 与 FORBIDDEN_ACTION_INPUT_PROPERTIES", () => {
    it("识别禁止属性名 __proto__、constructor、prototype", () => {
      expect(isForbiddenActionInputPropertyName("__proto__")).toBe(true);
      expect(isForbiddenActionInputPropertyName("constructor")).toBe(true);
      expect(isForbiddenActionInputPropertyName("prototype")).toBe(true);
    });

    it("放行普通属性名", () => {
      expect(isForbiddenActionInputPropertyName("name")).toBe(false);
      expect(isForbiddenActionInputPropertyName("proto")).toBe(false);
      expect(isForbiddenActionInputPropertyName("construct")).toBe(false);
      expect(isForbiddenActionInputPropertyName("type")).toBe(false);
    });

    it("FORBIDDEN_ACTION_INPUT_PROPERTIES 为冻结数组且包含全部禁止属性", () => {
      expect(Object.isFrozen(FORBIDDEN_ACTION_INPUT_PROPERTIES)).toBe(true);
      expect(Array.from(FORBIDDEN_ACTION_INPUT_PROPERTIES)).toEqual([
        "__proto__",
        "constructor",
        "prototype",
      ]);
    });
  });

  describe("isFlatSafePropertyName", () => {
    it("当且仅当属性名合法且非禁止属性时返回 true", () => {
      expect(isFlatSafePropertyName("title")).toBe(true);
      expect(isFlatSafePropertyName("user_id")).toBe(true);

      // 禁止属性即便符合语法命名也返回 false
      expect(isFlatSafePropertyName("constructor")).toBe(false);
      expect(isFlatSafePropertyName("__proto__")).toBe(false);
      expect(isFlatSafePropertyName("prototype")).toBe(false);

      // 语法非法的属性名返回 false
      expect(isFlatSafePropertyName("user name")).toBe(false);
      expect(isFlatSafePropertyName("123")).toBe(false);
    });
  });
});
