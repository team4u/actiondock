import { describe, expect, it } from "bun:test";
import {
  canonicalizeJson,
  computeDigest,
  computeManifestDigest,
  parseJsonWithoutDuplicates,
  verifyManifestDigest,
} from "../src/project/digest";

describe("RFC 8785 JSON 规范化与 SHA-256 摘要", () => {
  it("对对象键按照 UTF-16 顺序排序并消除空白字符", () => {
    const raw = { b: 2, a: 1, c: { y: "bar", x: "foo" } };
    const canonical = canonicalizeJson(raw);
    expect(canonical).toBe('{"a":1,"b":2,"c":{"x":"foo","y":"bar"}}');
  });

  it("正确处理负零为零", () => {
    expect(canonicalizeJson(-0)).toBe("0");
    expect(canonicalizeJson(0)).toBe("0");
    expect(canonicalizeJson({ zero: -0 })).toBe('{"zero":0}');
  });

  it("拒绝非有限数值", () => {
    expect(() => canonicalizeJson(NaN)).toThrow();
    expect(() => canonicalizeJson(Infinity)).toThrow();
    expect(() => canonicalizeJson(-Infinity)).toThrow();
  });

  it("忽略对象中的 undefined 与函数", () => {
    const obj = { a: 1, b: undefined, c: () => {} };
    expect(canonicalizeJson(obj)).toBe('{"a":1}');
  });

  it("数组中的 undefined 序列化为 null", () => {
    const arr = [1, undefined, 3];
    expect(canonicalizeJson(arr)).toBe("[1,null,3]");
  });

  it("率先拦截并拒绝重复 JSON 键", () => {
    const jsonWithDuplicates = '{"name":"test","version":"1.0.0","name":"duplicate"}';
    expect(() => parseJsonWithoutDuplicates(jsonWithDuplicates)).toThrow(/Duplicate key 'name'/);
  });

  it("解析合法 JSON 结构", () => {
    const json = '{"name":"test","version":"1.0.0","tags":["a","b"],"active":true,"count":10}';
    const parsed = parseJsonWithoutDuplicates<any>(json);
    expect(parsed.name).toBe("test");
    expect(parsed.tags).toEqual(["a", "b"]);
    expect(parsed.active).toBe(true);
    expect(parsed.count).toBe(10);
  });

  it("计算具有确定性的摘要且对键顺序与空白不敏感", () => {
    const textA = JSON.stringify({ id: "pkg-1", version: "1.0.0", description: "demo" }, null, 2);
    const textB = JSON.stringify({ description: "demo", id: "pkg-1", version: "1.0.0" });
    const digestA = computeDigest(textA);
    const digestB = computeDigest(textB);

    expect(digestA.startsWith("sha256-")).toBe(true);
    expect(digestA).toBe(digestB);
    expect(verifyManifestDigest({ id: "pkg-1", version: "1.0.0", description: "demo" }, digestA)).toBe(true);
  });

  it("内容变更时摘要必然发生改变", () => {
    const digestA = computeManifestDigest({ id: "pkg-1", version: "1.0.0" });
    const digestB = computeManifestDigest({ id: "pkg-1", version: "1.0.1" });
    expect(digestA).not.toBe(digestB);
  });
});
