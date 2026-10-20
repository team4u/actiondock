import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TestConfigStore } from "../src/runtime";
import { MemoryStorage } from "../src/storage";
import { CONFIG_VALUE_INVALID, INVALID_ARGUMENT } from "@actiondock/core";
import type { ProjectConfig } from "@actiondock/core";

const manifest: ProjectConfig = {
  id: "test.config-schema",
  config: {
    "MYSQL_*": {
      schema: {
        type: "object",
        properties: { host: { type: "string" }, password: { type: "string", secret: true } },
        required: ["host", "password"],
        additionalProperties: false,
      },
    },
  },
};

describe("测试配置与生产声明校验一致", () => {
  it("模板配置读取保持原值，非法写入不覆盖原值", (t) => {
    const storage = new MemoryStorage();
    t.after(() => storage.close());
    const config = new TestConfigStore(storage, manifest);
    const value = { host: "h", password: "raw-password" };
    config.set("MYSQL_MAIN", value);
    assert.deepEqual(config.get("MYSQL_MAIN"), value);
    assert.deepEqual(config.list().MYSQL_MAIN, value);
    assert.equal(Object.hasOwn(config.list(), "MYSQL_*"), false);
    assert.throws(() => config.set("MYSQL_MAIN", { host: "h" }), { code: CONFIG_VALUE_INVALID });
    assert.deepEqual(config.get("MYSQL_MAIN"), value);
  });

  it("覆盖和存量非法值在读取时校验，调用方默认值保持原语义", (t) => {
    const storage = new MemoryStorage();
    t.after(() => storage.close());
    const config = new TestConfigStore(storage, manifest, { MYSQL_OVERRIDE: "invalid" });
    assert.throws(() => config.get("MYSQL_OVERRIDE"), { code: CONFIG_VALUE_INVALID });
    storage.setConfig("MYSQL_LEGACY", "invalid");
    assert.throws(() => config.get("MYSQL_LEGACY"), { code: CONFIG_VALUE_INVALID });
    assert.equal(config.get("MYSQL_MISSING", "caller-fallback"), "caller-fallback");
  });

  it("测试辅助也拒绝将模板作为具体键寻址", (t) => {
    const storage = new MemoryStorage();
    t.after(() => storage.close());
    const config = new TestConfigStore(storage, manifest);
    for (const operation of [() => config.get("MYSQL_*"), () => config.has("MYSQL_*"), () => config.set("MYSQL_*", {}), () => config.delete("MYSQL_*")]) {
      assert.throws(operation, { code: INVALID_ARGUMENT });
    }
  });
});
