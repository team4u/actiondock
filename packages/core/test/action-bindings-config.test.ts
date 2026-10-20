import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ActionDockError,
  INVALID_ACTION_REF,
  INVALID_ARGUMENT,
  INVALID_JSON,
  NOT_FOUND,
} from "../src/errors";
import {
  hasRemoteActionBinding,
  loadActionBindings,
  resolveActionBinding,
  validateActionBindings,
  type ActionBindings,
} from "../src/invocation/bindings";

describe("Action Bindings Configuration (packages/core/src/invocation/bindings.ts)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-bindings-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("validates and resolves valid local, remote, and default bindings", () => {
    const raw = {
      "demo-pkg/greet": {
        default: { type: "local" },
        cloud: { type: "remote", profile: "prod-cluster" },
      },
    };

    const bindings = validateActionBindings(raw);

    // 未传 binding 检索 default
    const defaultTarget = resolveActionBinding(bindings, "demo-pkg/greet");
    assert.deepStrictEqual(defaultTarget, { type: "local" });

    // 显式传 default
    const explicitDefault = resolveActionBinding(bindings, "demo-pkg/greet", "default");
    assert.deepStrictEqual(explicitDefault, { type: "local" });

    // 显式传 cloud
    const cloudTarget = resolveActionBinding(bindings, "demo-pkg/greet", "cloud");
    assert.deepStrictEqual(cloudTarget, {
      type: "remote",
      profile: "prod-cluster",
    });
  });

  it("supports multiple bindings for the same ref and checks hasRemoteActionBinding", () => {
    const raw = {
      "service-pkg/query": {
        default: { type: "local" },
        edge: { type: "remote", profile: "edge-tokyo" },
        us: { type: "remote", profile: "us-east" },
        mock: { type: "local" },
      },
      "service-pkg/local-only": {
        default: { type: "local" },
        test: { type: "local" },
      },
    };

    const bindings = validateActionBindings(raw);

    assert.strictEqual(hasRemoteActionBinding(bindings, "service-pkg/query"), true);
    assert.strictEqual(hasRemoteActionBinding(bindings, "service-pkg/local-only"), false);
    assert.strictEqual(hasRemoteActionBinding(bindings, "service-pkg/not-configured"), false);

    assert.deepStrictEqual(resolveActionBinding(bindings, "service-pkg/query", "edge"), {
      type: "remote",
      profile: "edge-tokyo",
    });
    assert.deepStrictEqual(resolveActionBinding(bindings, "service-pkg/query", "mock"), {
      type: "local",
    });
  });

  it("distinguishes unconfigured default and explicit missing bindings", () => {
    const raw = {
      "pkg-a/has-custom-only": {
        staging: { type: "remote", profile: "staging-env" },
      },
    };
    const bindings = validateActionBindings(raw);

    // 未配置 default：未传 binding 返回 undefined
    const noDefaultResult = resolveActionBinding(bindings, "pkg-a/has-custom-only");
    assert.strictEqual(noDefaultResult, undefined);

    // 完全未注册的 ref：未传 binding 返回 undefined
    const notFoundResult = resolveActionBinding(bindings, "pkg-a/unregistered");
    assert.strictEqual(notFoundResult, undefined);

    // 显式查询缺失的 binding：抛出 NOT_FOUND 且包含 action 与 binding details
    assert.throws(
      () => resolveActionBinding(bindings, "pkg-a/has-custom-only", "default"),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, NOT_FOUND);
        assert.deepStrictEqual(err.details, {
          action: "pkg-a/has-custom-only",
          binding: "default",
        });
        return true;
      }
    );

    assert.throws(
      () => resolveActionBinding(bindings, "pkg-a/unregistered", "custom-node"),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, NOT_FOUND);
        assert.deepStrictEqual(err.details, {
          action: "pkg-a/unregistered",
          binding: "custom-node",
        });
        return true;
      }
    );
  });

  it("rejects illegal target fields, mixed fields, and unknown target types", () => {
    // local 含有 profile
    assert.throws(
      () =>
        validateActionBindings({
          "pkg/act": { default: { type: "local", profile: "prod" } },
        }),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_ARGUMENT);
        return true;
      }
    );

    // local 含有 path
    assert.throws(
      () =>
        validateActionBindings({
          "pkg/act": { default: { type: "local", path: "./dist/index.js" } },
        }),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_ARGUMENT);
        return true;
      }
    );

    // remote 含有 url
    assert.throws(
      () =>
        validateActionBindings({
          "pkg/act": {
            cloud: { type: "remote", profile: "prod", url: "https://example.com" },
          },
        }),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_ARGUMENT);
        return true;
      }
    );

    // remote 含有 token
    assert.throws(
      () =>
        validateActionBindings({
          "pkg/act": {
            cloud: { type: "remote", profile: "prod", token: "secret" },
          },
        }),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_ARGUMENT);
        return true;
      }
    );

    // remote 缺失 profile
    assert.throws(
      () =>
        validateActionBindings({
          "pkg/act": { cloud: { type: "remote" } },
        }),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_ARGUMENT);
        return true;
      }
    );

    // 未知 type
    assert.throws(
      () =>
        validateActionBindings({
          "pkg/act": { cloud: { type: "serverless" } },
        }),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_ARGUMENT);
        return true;
      }
    );
  });

  it("rejects illegal binding names and illegal profiles", () => {
    // 空绑定名
    assert.throws(
      () =>
        validateActionBindings({
          "pkg/act": { "": { type: "local" } },
        }),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_ARGUMENT);
        return true;
      }
    );

    // 包含空白的绑定名
    assert.throws(
      () =>
        validateActionBindings({
          "pkg/act": { "prod cluster": { type: "local" } },
        }),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_ARGUMENT);
        return true;
      }
    );

    // 非法字符绑定名
    assert.throws(
      () =>
        validateActionBindings({
          "pkg/act": { "prod*node": { type: "local" } },
        }),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_ARGUMENT);
        return true;
      }
    );

    // 空 profile
    assert.throws(
      () =>
        validateActionBindings({
          "pkg/act": { cloud: { type: "remote", profile: "" } },
        }),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_ARGUMENT);
        return true;
      }
    );

    // 含有空白的 profile
    assert.throws(
      () =>
        validateActionBindings({
          "pkg/act": { cloud: { type: "remote", profile: "us east" } },
        }),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_ARGUMENT);
        return true;
      }
    );
  });

  it("rejects illegal action refs including wildcards, path traversal, colons, and bare names", () => {
    const invalidRefs = [
      "",
      "   ",
      "bare-action",
      "pkg:action",
      "pkg/action*",
      "pkg/?action",
      "../pkg/action",
      "pkg/../action",
      "pkg/action ",
      " pkg/action",
      "pkg//action",
      "pkg/ActionID",
    ];

    for (const ref of invalidRefs) {
      assert.throws(
        () =>
          validateActionBindings({
            [ref]: { default: { type: "local" } },
          }),
        (err: unknown) => {
          assert(err instanceof ActionDockError);
          assert.strictEqual(err.code, INVALID_ACTION_REF);
          return true;
        },
        `Expected ref '${ref}' to be rejected`
      );
    }
  });

  it("handles missing vs corrupted file in loadActionBindings", () => {
    // 1. 目标文件不存在：安全返回空冻结映射
    const emptyBindings = loadActionBindings(tempDir);
    assert.deepStrictEqual(emptyBindings, Object.create(null));
    assert.strictEqual(Object.isFrozen(emptyBindings), true);

    // 2. 存在合法 bindings.json
    const configDir = join(tempDir, ".actiondock");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "bindings.json"),
      JSON.stringify({
        bindings: {
          "pkg-one/run": {
            default: { type: "local" },
            remote: { type: "remote", profile: "cloud-v2" },
          },
        },
      }),
      "utf-8"
    );

    const loaded = loadActionBindings(tempDir);
    assert.strictEqual(hasRemoteActionBinding(loaded, "pkg-one/run"), true);
    assert.deepStrictEqual(resolveActionBinding(loaded, "pkg-one/run"), {
      type: "local",
    });

    // 3. 损坏的 JSON 格式必须透传 ActionDockError(INVALID_JSON)
    writeFileSync(
      join(configDir, "bindings.json"),
      "{ invalid json: true, ",
      "utf-8"
    );
    assert.throws(
      () => loadActionBindings(tempDir),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_JSON);
        return true;
      }
    );

    // 4. 外层对象缺失 bindings 属性
    writeFileSync(
      join(configDir, "bindings.json"),
      JSON.stringify({ schemaVersion: 1 }),
      "utf-8"
    );
    assert.throws(
      () => loadActionBindings(tempDir),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_ARGUMENT);
        return true;
      }
    );

    // 5. 外层对象存在未知字段
    writeFileSync(
      join(configDir, "bindings.json"),
      JSON.stringify({
        bindings: {},
        unexpectedKey: "malicious",
      }),
      "utf-8"
    );
    assert.throws(
      () => loadActionBindings(tempDir),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_ARGUMENT);
        return true;
      }
    );
  });

  it("guarantees snapshot immutability against input mutations", () => {
    const inputTarget = { type: "remote" as const, profile: "initial-prod" };
    const inputGroup = {
      default: { type: "local" as const },
      cloud: inputTarget,
    };
    const inputBindings = {
      "pkg/action": inputGroup,
    };

    const snapshot = validateActionBindings(inputBindings);

    // 修改输入对象及其子属性
    (inputTarget as any).profile = "tampered-prod";
    (inputGroup as any).default = { type: "remote", profile: "tampered-default" };
    (inputGroup as any).extra = { type: "local" };
    (inputBindings as any)["pkg/action"] = {};
    (inputBindings as any)["pkg/new-action"] = { default: { type: "local" } };

    // 验证快照未被任何后置变动污染
    assert.deepStrictEqual(resolveActionBinding(snapshot, "pkg/action", "default"), {
      type: "local",
    });
    assert.deepStrictEqual(resolveActionBinding(snapshot, "pkg/action", "cloud"), {
      type: "remote",
      profile: "initial-prod",
    });
    assert.strictEqual(resolveActionBinding(snapshot, "pkg/new-action"), undefined);

    // 验证快照为深度冻结对象
    assert.strictEqual(Object.isFrozen(snapshot), true);
    assert.strictEqual(Object.isFrozen(snapshot["pkg/action"]), true);
    assert.strictEqual(
      Object.isFrozen(resolveActionBinding(snapshot, "pkg/action", "default")),
      true
    );
  });

  it("defends against prototype pollution and inherited property key attacks", () => {
    // 1. 原型继承的属性不得被作为绑定读取
    const maliciousPrototype = {
      "inherited-pkg/action": {
        default: { type: "local" },
      },
    };
    const forgedInput = Object.create(maliciousPrototype);
    const validated = validateActionBindings(forgedInput);

    assert.deepStrictEqual(validated, Object.create(null));
    assert.strictEqual(
      resolveActionBinding(validated, "inherited-pkg/action"),
      undefined
    );

    // 2. 内部组对象原型继承的属性亦被忽略
    const innerForged = Object.create({
      inheritedBinding: { type: "local" },
    });
    innerForged.default = { type: "local" };
    const groupBindings = validateActionBindings({
      "safe-pkg/action": innerForged,
    });
    assert.deepStrictEqual(
      resolveActionBinding(groupBindings, "safe-pkg/action", "default"),
      { type: "local" }
    );
    assert.throws(
      () =>
        resolveActionBinding(groupBindings, "safe-pkg/action", "inheritedBinding"),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, NOT_FOUND);
        return true;
      }
    );

    // 3. 禁止以原型特殊名称命名绑定
    for (const protoKey of ["__proto__", "constructor", "prototype"]) {
      assert.throws(
        () =>
          validateActionBindings({
            "safe-pkg/action": {
              [protoKey]: { type: "local" },
            },
          }),
        (err: unknown) => {
          assert(err instanceof ActionDockError);
          assert.strictEqual(err.code, INVALID_ARGUMENT);
          return true;
        }
      );
    }

    // 4. 对快照查询 constructor / toString / __proto__ 不得命中 Object.prototype
    const validBindings = validateActionBindings({
      "safe-pkg/action": {
        default: { type: "local" },
      },
    });

    assert.strictEqual(Object.getPrototypeOf(validBindings), null);
    assert.strictEqual(Object.getPrototypeOf(validBindings["safe-pkg/action"]), null);

    assert.throws(
      () => resolveActionBinding(validBindings, "safe-pkg/action", "constructor"),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, NOT_FOUND);
        return true;
      }
    );

    assert.throws(
      () => resolveActionBinding(validBindings, "safe-pkg/action", "toString"),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, NOT_FOUND);
        return true;
      }
    );

    assert.throws(
      () => resolveActionBinding(validBindings, "safe-pkg/action", "__proto__"),
      (err: unknown) => {
        assert(err instanceof ActionDockError);
        assert.strictEqual(err.code, NOT_FOUND);
        return true;
      }
    );
  });
});
