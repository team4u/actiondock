import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleConfigRoutes } from "../src/server/routes/config";
import { normalizeRemoteConfigResponse } from "../src/client/config";
import { CONFIG_VALUE_INVALID, INVALID_ARGUMENT } from "../src/errors";
import type { ConfigValueView } from "../src/service/types";

describe("远端配置接口与客户端安全归一化", () => {
  it("HTTP GET /config 返回 configViewVersion: 1、items 真实元数据与兼容 values", async () => {
    const mockViews: ConfigValueView[] = [
      {
        key: "normal.key",
        configured: true,
        secret: false,
        source: "package",
        value: "hello",
        redactedPaths: [],
      },
      {
        key: "field.secret",
        configured: true,
        secret: true,
        source: "package",
        value: { user: "alice", token: "********" },
        redactedPaths: ["/token"],
      },
      {
        key: "whole.secret",
        configured: true,
        secret: true,
        source: "package",
        value: undefined,
        redactedPaths: [""],
      },
      {
        key: "unconfigured.secret",
        configured: false,
        secret: true,
        source: "default",
        value: undefined,
        redactedPaths: [],
      },
    ];

    const mockCtx: any = {
      req: { method: "GET" },
      url: new URL("http://localhost/config"),
      pathname: "/config",
      corsHeaders: {},
      options: { maxBodyBytes: 1024 * 1024 },
      service: {
        discovery: {
          listPackages: async () => [{ id: "test-pkg", config: {} }],
        },
        management: {
          config: {
            list: async () => mockViews,
          },
        },
      },
      activePolicy: { enableManagement: true },
    };

    const res = await handleConfigRoutes(mockCtx);
    assert.ok(res);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(data.configViewVersion, 1);
    assert.strictEqual(data.items.length, 4);

    // 兼容 values 验证
    assert.strictEqual(data.values["normal.key"], "hello");
    assert.deepStrictEqual(data.values["field.secret"], { user: "alice", token: "********" });
    assert.strictEqual(data.values["whole.secret"], "********");
    assert.strictEqual(data.values["unconfigured.secret"], undefined);

    // items 真实元数据验证：未配置敏感项不伪造 configured: true
    const unconfItem = data.items.find((i: any) => i.key === "unconfigured.secret");
    assert.strictEqual(unconfItem.configured, false);
    assert.strictEqual(unconfItem.secret, true);
    assert.deepStrictEqual(unconfItem.redactedPaths, []);
  });

  it("HTTP PUT 校验失败返回 400 且保留 CONFIG_VALUE_INVALID 错误码", async () => {
    const mockCtx: any = {
      req: new Request("http://localhost/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: "age",
          value: "not-a-number",
        }),
      }),
      url: new URL("http://localhost/config"),
      pathname: "/config",
      corsHeaders: {},
      options: { maxBodyBytes: 1024 * 1024 },
      service: {
        discovery: {
          listPackages: async () => [{ id: "test-pkg" }],
        },
        management: {
          config: {
            set: async () => {
              const err: any = new Error("Validation failed");
              err.code = CONFIG_VALUE_INVALID;
              throw err;
            },
          },
        },
      },
      activePolicy: { enableManagement: true },
    };

    const res = await handleConfigRoutes(mockCtx);
    assert.ok(res);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.ok, false);
    assert.strictEqual(data.error.code, CONFIG_VALUE_INVALID);
  });

  it("HTTP 路由操作拒绝模板键", async () => {
    const mockCtx: any = {
      req: new Request("http://localhost/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: "service.*.token",
          value: "sample",
        }),
      }),
      url: new URL("http://localhost/config"),
      pathname: "/config",
      corsHeaders: {},
      options: { maxBodyBytes: 1024 * 1024 },
      service: {
        discovery: {
          listPackages: async () => [{ id: "test-pkg" }],
        },
        management: {
          config: {
            set: async () => {},
          },
        },
      },
      activePolicy: { enableManagement: true },
    };

    const res = await handleConfigRoutes(mockCtx);
    assert.ok(res);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.error.code, INVALID_ARGUMENT);
  });

  it("客户端归一化新版协议并合并本地增强保护", () => {
    const newResponse = {
      ok: true,
      configViewVersion: 1,
      packageId: "pkg.remote",
      items: [
        {
          key: "app.settings",
          configured: true,
          secret: false,
          source: "package",
          value: { env: "prod", internalKey: "secret_123" },
          redactedPaths: [],
        },
      ],
      values: {
        "app.settings": { env: "prod", internalKey: "secret_123" },
      },
    };

    // 本地声明将 internalKey 标记为敏感字段
    const localDeclarations = {
      "app.settings": {
        schema: {
          type: "object" as const,
          properties: {
            env: { type: "string" as const },
            internalKey: { type: "string" as const, secret: true },
          },
        },
      },
    };

    const normalized = normalizeRemoteConfigResponse(newResponse, { localDeclarations });
    assert.strictEqual(normalized.configViewVersion, 1);
    const item = normalized.items[0];
    assert.strictEqual(item.secret, true);
    assert.deepStrictEqual(item.value, {
      env: "prod",
      internalKey: "********",
    });
    assert.deepStrictEqual(item.redactedPaths, ["/internalKey"]);
    assert.deepStrictEqual(normalized.values["app.settings"], {
      env: "prod",
      internalKey: "********",
    });
  });

  it("客户端归一化旧版协议对未声明键安全降级隐藏并触发告警", () => {
    const legacyResponse = {
      ok: true,
      values: {
        "legacy.declared": "safe_val",
        "legacy.masked": "********",
        "legacy.unknown": "raw_sensitive_data",
      },
      declared: {
        "legacy.declared": { type: "string" },
        "legacy.masked": { type: "string", secret: true },
      },
    };

    const warnings: string[] = [];
    const normalized = normalizeRemoteConfigResponse(legacyResponse, {
      onWarning: (msg) => warnings.push(msg),
    });

    // 捕获到未声明键的警告
    assert.ok(warnings.some((message) => message.includes("legacy.unknown")));

    // 未声明键 fail-closed 隐藏
    const unknownItem = normalized.items.find((i: any) => i.key === "legacy.unknown");
    assert.strictEqual(unknownItem.secret, true);
    assert.strictEqual(unknownItem.value, undefined);
    assert.deepStrictEqual(unknownItem.redactedPaths, [""]);
    assert.strictEqual(unknownItem.source, "remote");

    // 旧版掩码项丢弃伪值并指向根
    const maskedItem = normalized.items.find((i: any) => i.key === "legacy.masked");
    assert.strictEqual(maskedItem.secret, true);
    assert.strictEqual(maskedItem.value, undefined);
    assert.deepStrictEqual(maskedItem.redactedPaths, [""]);

    // 兼容 values 同步脱敏
    assert.strictEqual(normalized.values["legacy.unknown"], "********");
    assert.strictEqual(normalized.values["legacy.masked"], "********");
    assert.strictEqual(normalized.values["legacy.declared"], "safe_val");
  });
});
