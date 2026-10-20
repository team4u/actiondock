import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleConfigRoutes } from "../src/server/routes/config";
import { normalizeRemoteConfigResponse } from "../src/client/config";
import { CONFIG_VALUE_INVALID, INVALID_ARGUMENT, PROTOCOL_UNSUPPORTED } from "../src/errors";
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

  it("客户端归一化旧协议响应被拒绝，不再安全降级或猜测来源", () => {
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

    // 旧服务端响应缺少 configViewVersion: 1 与真实元数据，必须明确拒绝而不是猜测来源。
    assert.throws(
      () => normalizeRemoteConfigResponse(legacyResponse),
      (err: any) => err.code === PROTOCOL_UNSUPPORTED
    );
    // 历史数组视图同样不再接受。
    assert.throws(
      () => normalizeRemoteConfigResponse([{ key: "KEY", value: "raw" }]),
      (err: any) => err.code === PROTOCOL_UNSUPPORTED
    );
  });

  it("新协议视图缺失元数据、非法来源或状态不自洽时拒绝", () => {
    // 缺失 items：响应结构不完整，同属协议契约错误
    assert.throws(
      () => normalizeRemoteConfigResponse({ configViewVersion: 1, values: { KEY: "raw" } }),
      (err: any) => err.code === PROTOCOL_UNSUPPORTED
    );
    // 非法 source（旧 remote 别名与任意字符串）：必须拒绝而不是透传或猜测
    for (const badSource of ["remote", "project", "overrides", "legacy", 1]) {
      assert.throws(
        () => normalizeRemoteConfigResponse({
          configViewVersion: 1,
          packageId: "config.remote",
          declared: {},
          items: [{ key: "KEY", source: badSource, configured: true, secret: false, value: "raw", redactedPaths: [] }],
        }),
        (err: any) => err.code === PROTOCOL_UNSUPPORTED,
        `source ${String(badSource)} 应被拒绝`
      );
    }
    // source null 但宣称已配置或携带生效值/隐藏路径：状态不自洽
    assert.throws(
      () => normalizeRemoteConfigResponse({
        configViewVersion: 1,
        packageId: "config.remote",
        declared: {},
        items: [{ key: "KEY", source: null, configured: true, secret: false, value: undefined, redactedPaths: [] }],
      }),
      (err: any) => err.code === PROTOCOL_UNSUPPORTED
    );
    // source default 却宣称已配置：状态不自洽
    assert.throws(
      () => normalizeRemoteConfigResponse({
        configViewVersion: 1,
        packageId: "config.remote",
        declared: {},
        items: [{ key: "KEY", source: "default", configured: true, secret: false, value: "x", redactedPaths: [] }],
      }),
      (err: any) => err.code === PROTOCOL_UNSUPPORTED
    );
    // 显式来源却宣称未配置：状态不自洽
    assert.throws(
      () => normalizeRemoteConfigResponse({
        configViewVersion: 1,
        packageId: "config.remote",
        declared: {},
        items: [{ key: "KEY", source: "package", configured: false, secret: false, value: "x", redactedPaths: [] }],
      }),
      (err: any) => err.code === PROTOCOL_UNSUPPORTED
    );
    // 合法 null 视图：未命中即未配置，无值无路径
    const nullView = normalizeRemoteConfigResponse({
      configViewVersion: 1,
      packageId: "config.remote",
      declared: {},
      items: [{ key: "KEY", source: null, configured: false, secret: false, value: undefined, redactedPaths: [] }],
    });
    assert.strictEqual(nullView.items[0].source, null);
    assert.strictEqual(nullView.items[0].configured, false);
    assert.strictEqual(nullView.items[0].value, undefined);

    // 声明有来源却无值且无根隐藏路径：不合法；default 同样适用
    for (const missingValueSource of ["package", "default", "env"] as const) {
      assert.throws(
        () => normalizeRemoteConfigResponse({
          configViewVersion: 1,
          packageId: "config.remote",
          declared: {},
          items: [{ key: "KEY", source: missingValueSource, configured: missingValueSource !== "default", secret: false, value: undefined, redactedPaths: [] }],
        }),
        (err: any) => err.code === PROTOCOL_UNSUPPORTED,
        `source ${missingValueSource} 缺值且无根路径应被拒绝`
      );
    }
    // 整项隐藏省略 value 但携带根隐藏路径：合法
    const hiddenView = normalizeRemoteConfigResponse({
      configViewVersion: 1,
      packageId: "config.remote",
      declared: {},
      items: [{ key: "KEY", source: "package", configured: true, secret: true, value: undefined, redactedPaths: [""] }],
    });
    assert.strictEqual(hiddenView.items[0].value, undefined);
    assert.deepEqual(hiddenView.items[0].redactedPaths, [""]);
  });
});
