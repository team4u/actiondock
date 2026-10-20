import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryStorage } from "../src/storage";
import { TestConfigStore } from "../src/runtime";

describe("测试配置覆盖未命中一致性验收", () => {
  it("undefined 覆盖继续读取存储、默认或调用方回退，has 和 list 也一致", (t) => {
    const storage = new MemoryStorage();
    t.after(() => storage.close());
    storage.setConfig("STORED", "stored-value");
    const config = new TestConfigStore(storage, {
      id: "test.source-review",
      config: { DEFAULTED: { default: "default-value" }, MISSING: {} },
    }, { STORED: undefined, DEFAULTED: undefined, MISSING: undefined });
    assert.equal(config.get("STORED"), "stored-value");
    assert.equal(config.get("DEFAULTED"), "default-value");
    assert.equal(config.get("MISSING", "caller-fallback"), "caller-fallback");
    assert.equal(config.has("STORED"), true);
    assert.equal(config.has("DEFAULTED"), true);
    assert.equal(config.has("MISSING"), false);
    const listed = config.list();
    assert.equal(listed.STORED, "stored-value");
    assert.equal(listed.DEFAULTED, "default-value");
    assert.equal(Object.hasOwn(listed, "MISSING"), false);
  });

  it("null/false/0/空串覆盖仍有值，不被当成 undefined 跳过", (t) => {
    const storage = new MemoryStorage();
    t.after(() => storage.close());
    for (const value of [null, false, 0, ""]) {
      storage.setConfig("KEY", "stored-value");
      const config = new TestConfigStore(storage, { id: "test.source-review" }, { KEY: value });
      assert.equal(config.get("KEY", "caller-fallback"), value);
      assert.equal(config.has("KEY"), true);
      assert.equal(config.list().KEY, value);
    }
  });
});
