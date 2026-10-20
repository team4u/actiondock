import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { fetchRemoteConfigItem, normalizeRemoteConfigResponse } from "../src/client/config";
import { PROTOCOL_UNSUPPORTED } from "../src/errors";
import { RemoteActionDockService } from "../src/service/remote";
import type { ConfigSource, ConfigValueView } from "../src/service/types";
import { createActionDockHost } from "../src/host";
import { startActionDockServer } from "../src/server";

const sources: ConfigSource[] = ["override", "package", "global", "env", "default"];
const view = (source: ConfigSource | null, value?: any, paths: string[] = []): ConfigValueView => ({
  key: "SOURCE_REVIEW_KEY", source, configured: source !== null && source !== "default",
  secret: paths.length > 0, value, redactedPaths: paths,
});
const envelope = (item: ConfigValueView) => ({ configViewVersion: 1, items: [item] });

describe("配置来源独立验收", () => {
  it("任何有来源的视图缺失值时都必须提供根隐藏路径", () => {
    for (const source of sources) {
      for (const paths of [[], ["/password"]]) {
        assert.throws(() => normalizeRemoteConfigResponse(envelope(view(source, undefined, paths))),
          { code: PROTOCOL_UNSUPPORTED }, `${source} 不能在无值无根隐藏路径时声称命中`);
      }
      const safe = normalizeRemoteConfigResponse(envelope(view(source, undefined, [""])));
      assert.equal(safe.items[0].source, source);
      assert.equal(safe.items[0].configured, source !== "default");
      assert.deepEqual(safe.items[0].redactedPaths, [""]);
    }
  });

  it("falsy 真实值与可选秘密字段缺失均不能误判未配置", () => {
    for (const source of sources) {
      for (const value of [null, false, 0, ""]) {
        const safe = normalizeRemoteConfigResponse(envelope(view(source, value)));
        assert.equal(safe.items[0].source, source);
        assert.equal(safe.items[0].value, value);
        assert.equal(safe.items[0].configured, source !== "default");
      }
    }
    const optionalSecret = { ...view("env", { host: "h" }), secret: true };
    const safe = normalizeRemoteConfigResponse({
      ...envelope(optionalSecret),
      declared: { SOURCE_REVIEW_KEY: { schema: { type: "object", properties: { host: { type: "string" }, password: { type: "string", secret: true } } } } },
    });
    assert.deepEqual(safe.items[0].value, { host: "h" });
    assert.deepEqual(safe.items[0].redactedPaths, []);
  });

  it("null 来源只用于真正未命中，不能带任何实际值或隐藏路径", () => {
    for (const value of [null, false, 0, "", "raw-secret"]) {
      assert.throws(() => normalizeRemoteConfigResponse(envelope(view(null, value))), { code: PROTOCOL_UNSUPPORTED });
    }
    assert.throws(() => normalizeRemoteConfigResponse(envelope(view(null, undefined, [""]))), { code: PROTOCOL_UNSUPPORTED });
    const missing = normalizeRemoteConfigResponse(envelope(view(null)));
    assert.equal(missing.items[0].source, null);
    assert.equal(missing.items[0].configured, false);
  });

  it("完整响应元数据缺失统一报协议错误，不作为用户参数错误", () => {
    for (const response of [null, {}, [], { values: { KEY: "raw-secret" } }, { configViewVersion: 1 }]) {
      assert.throws(() => normalizeRemoteConfigResponse(response), { code: PROTOCOL_UNSUPPORTED });
    }
  });

  it("真实 HTTP 往返保留五种来源、null 未命中和已隐藏的敏感默认值", async (t) => {
    const key = "SOURCE_REVIEW_HTTP_ENV";
    const previous = process.env[key];
    process.env[key] = "environment-value";
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    const host = await createActionDockHost({
      inMemory: true, autoLoadCurrentProject: false,
      packages: [{
        configOverrides: { SOURCE_REVIEW_HTTP_OVERRIDE: "override-value" },
        projectConfig: { id: "source.review.http", config: {
          SOURCE_REVIEW_HTTP_OVERRIDE: {}, SOURCE_REVIEW_HTTP_PACKAGE: {}, SOURCE_REVIEW_HTTP_GLOBAL: {},
          [key]: {}, SOURCE_REVIEW_HTTP_DEFAULT: { default: "default-value" },
          SOURCE_REVIEW_HTTP_SECRET_DEFAULT: { default: "secret-default", secret: true },
          SOURCE_REVIEW_HTTP_MISSING: {},
        } },
      }],
    });
    await host.setConfig("source.review.http", "SOURCE_REVIEW_HTTP_PACKAGE", "package-value");
    await host.setConfig("global", "SOURCE_REVIEW_HTTP_GLOBAL", "global-value");
    const server = await startActionDockServer({ service: host, hostname: "127.0.0.1", port: 0, enableManagement: true });
    const remote = new RemoteActionDockService({ serverUrl: `http://127.0.0.1:${server.port}` });
    t.after(async () => { await remote.close(); await server.stop(); await host.close(); });
    for (const source of sources) {
      const concreteKey = source === "env" ? key : `SOURCE_REVIEW_HTTP_${source.toUpperCase()}`;
      const received = await remote.management!.config.get("source.review.http", concreteKey);
      assert.equal(received.source, source);
      assert.equal(received.configured, source !== "default");
    }
    const missing = await remote.management!.config.get("source.review.http", "SOURCE_REVIEW_HTTP_MISSING");
    assert.equal(missing.source, null);
    assert.equal(missing.configured, false);
    const hidden = await remote.management!.config.get("source.review.http", "SOURCE_REVIEW_HTTP_SECRET_DEFAULT");
    assert.equal(hidden.source, "default");
    assert.equal(hidden.configured, false);
    assert.equal(hidden.value, undefined);
    assert.deepEqual(hidden.redactedPaths, [""]);
    const listed = await remote.management!.config.list("source.review.http");
    assert.equal(listed.find((item) => item.key === "SOURCE_REVIEW_HTTP_OVERRIDE")!.source, "override");
    assert.equal(listed.find((item) => item.key === "SOURCE_REVIEW_HTTP_MISSING")!.source, null);
  });

  it("单键响应必须显式返回同键 item，不能接受列表或伪造未命中", async (t) => {
    let body: any;
    let requests = 0;
    const server = createServer((_req, res) => {
      requests++;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    const url = `http://127.0.0.1:${(server.address() as any).port}`;
    const remote = new RemoteActionDockService({ serverUrl: url });
    t.after(() => remote.close());
    const valid = view("package", "stored-value");
    for (const invalid of [
      { values: { SOURCE_REVIEW_KEY: "raw-secret" } },
      { configViewVersion: 1, items: [] },
      { configViewVersion: 1, items: [valid] },
      { configViewVersion: 1, item: { ...valid, key: "WRONG_KEY" } },
      { configViewVersion: 1, item: null },
    ]) {
      body = invalid;
      const before = requests;
      await assert.rejects(fetchRemoteConfigItem(url, "SOURCE_REVIEW_KEY"), { code: PROTOCOL_UNSUPPORTED });
      assert.equal(requests, before + 1, "协议错误不能触发列表回退请求");
      await assert.rejects(remote.management!.config.get("test.package", "SOURCE_REVIEW_KEY"), { code: PROTOCOL_UNSUPPORTED });
    }
    body = { configViewVersion: 1, item: view(null) };
    const missing = await remote.management!.config.get("test.package", "SOURCE_REVIEW_KEY");
    assert.equal(missing.source, null);
    assert.equal(missing.configured, false);
    body = { configViewVersion: 1, item: valid };
    const present = await remote.management!.config.get("test.package", "SOURCE_REVIEW_KEY");
    assert.equal(present.source, "package");
    assert.equal(present.value, "stored-value");
  });
});
