import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
    assert.strictEqual(canonical, '{"a":1,"b":2,"c":{"x":"foo","y":"bar"}}');
  });

  it("正确处理负零为零", () => {
    assert.strictEqual(canonicalizeJson(-0), "0");
    assert.strictEqual(canonicalizeJson(0), "0");
    assert.strictEqual(canonicalizeJson({ zero: -0 }), '{"zero":0}');
  });

  it("拒绝非有限数值", () => {
    assert.throws(() => canonicalizeJson(NaN));
    assert.throws(() => canonicalizeJson(Infinity));
    assert.throws(() => canonicalizeJson(-Infinity));
  });

  it("忽略对象中的 undefined 与函数", () => {
    const obj = { a: 1, b: undefined, c: () => {} };
    assert.strictEqual(canonicalizeJson(obj), '{"a":1}');
  });

  it("数组中的 undefined 序列化为 null", () => {
    const arr = [1, undefined, 3];
    assert.strictEqual(canonicalizeJson(arr), "[1,null,3]");
  });

  it("率先拦截并拒绝重复 JSON 键", () => {
    const jsonWithDuplicates = '{"name":"test","version":"1.0.0","name":"duplicate"}';
    assert.throws(() => parseJsonWithoutDuplicates(jsonWithDuplicates), /Duplicate key 'name'/);
  });

  it("解析合法 JSON 结构", () => {
    const json = '{"name":"test","version":"1.0.0","tags":["a","b"],"active":true,"count":10}';
    const parsed = parseJsonWithoutDuplicates<any>(json);
    assert.strictEqual(parsed.name, "test");
    assert.deepStrictEqual(parsed.tags, ["a", "b"]);
    assert.strictEqual(parsed.active, true);
    assert.strictEqual(parsed.count, 10);
  });

  it("计算具有确定性的摘要且对键顺序与空白不敏感", () => {
    const textA = JSON.stringify({ id: "pkg-1", version: "1.0.0", description: "demo" }, null, 2);
    const textB = JSON.stringify({ description: "demo", id: "pkg-1", version: "1.0.0" });
    const digestA = computeDigest(textA);
    const digestB = computeDigest(textB);

    assert.strictEqual(digestA.startsWith("sha256-"), true);
    assert.strictEqual(digestA, digestB);
    assert.strictEqual(verifyManifestDigest({ id: "pkg-1", version: "1.0.0", description: "demo" }, digestA), true);
  });

  it("内容变更时摘要必然发生改变", () => {
    const digestA = computeManifestDigest({ id: "pkg-1", version: "1.0.0" });
    const digestB = computeManifestDigest({ id: "pkg-1", version: "1.0.1" });
    assert.notStrictEqual(digestA, digestB);
  });
});
