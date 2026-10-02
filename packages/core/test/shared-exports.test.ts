import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createMcpEndpointHandler,
  readBodyWithLimit,
  RequestTooLargeError,
  resolveCorsHeaders,
  verifyBearerToken,
  DEFAULT_MAX_BODY_BYTES,
} from "@actiondock/core/server";
import { createNonClosingStorageView } from "@actiondock/core/package";

describe("共享导出面验证", () => {
  it("server 子路径导出 readBodyWithLimit 与 RequestTooLargeError", () => {
    assert.strictEqual(typeof readBodyWithLimit, "function");
    assert.strictEqual(typeof RequestTooLargeError, "function");
    assert.strictEqual(typeof resolveCorsHeaders, "function");
    assert.strictEqual(typeof verifyBearerToken, "function");
    assert.strictEqual(DEFAULT_MAX_BODY_BYTES, 1024 * 1024);
  });

  it("package 子路径导出 createNonClosingStorageView", () => {
    assert.strictEqual(typeof createNonClosingStorageView, "function");
  });

  it("createNonClosingStorageView 拦截 close 并转发其余成员", () => {
    const storage: any = {
      value: 42,
      getValue() { return this.value; },
      close() { throw new Error("should not close"); },
    };
    const view = createNonClosingStorageView(storage);
    assert.strictEqual(view.getValue(), 42);
    assert.doesNotThrow(() => view.close());
    assert.strictEqual(view !== storage, true);
  });

  it("createMcpEndpointHandler 鉴权失败产出标准 401 JSON", async () => {
    const handler = createMcpEndpointHandler(async () => new Response("ok"), { token: "secret" });
    const res = await handler(new Request("http://x/mcp", { method: "POST" }));
    assert.strictEqual(res!.status, 401);
    const body: any = await res!.json();
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error.code, "UNAUTHORIZED");
    assert.strictEqual(body.error.message, "Invalid or missing Bearer token");
  });

  it("createMcpEndpointHandler 超限请求产出 413 JSON", async () => {
    const handler = createMcpEndpointHandler(async () => new Response("ok"), {
      token: "secret",
      maxBodyBytes: 16,
    });
    const res = await handler(new Request("http://x/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Length": "9999" },
      body: "a".repeat(9999),
    }));
    assert.strictEqual(res!.status, 413);
    const body: any = await res!.json();
    assert.strictEqual(body.error.code, "REQUEST_TOO_LARGE");
    assert.strictEqual(body.error.message, "Request body exceeds maximum allowed size");
  });

  it("createMcpEndpointHandler 委托方接收重建后的 Request", async () => {
    let captured: Request | undefined;
    const handler = createMcpEndpointHandler(async (req) => {
      captured = req;
      return new Response("delegated");
    }, { token: "secret" });
    const res = await handler(new Request("http://x/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    }));
    assert.strictEqual(res!.status, 200);
    assert.strictEqual(await res!.text(), "delegated");
    assert.strictEqual(captured!.method, "POST");
    const text = await new Response(captured!.body).text();
    assert.deepStrictEqual(JSON.parse(text), { hello: "world" });
  });

  it("createMcpEndpointHandler 委托返回 null 时透传 null 交回调用方", async () => {
    const handler = createMcpEndpointHandler(async () => null, { token: undefined });
    const res = await handler(new Request("http://x/mcp", { method: "GET" }));
    assert.strictEqual(res, null);
  });

  it("createMcpEndpointHandler 支持 CORS 合并模式与 JSON-RPC 401 定制", async () => {
    const handler = createMcpEndpointHandler(async () => new Response("ok", {
      headers: { "X-Origin": "mcp" },
    }), {
      token: "secret",
      corsOrigins: ["https://app.example"],
      corsApplyMode: "merge",
      unauthorizedResponse: (cors) => new Response(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Unauthorized" },
        id: null,
      }), { status: 401, headers: { "Content-Type": "application/json", ...cors } }),
    });

    // JSON-RPC 401 形态
    const unauthorized = await handler(new Request("http://x/mcp", { method: "POST" }));
    assert.strictEqual(unauthorized!.status, 401);
    const errBody: any = await unauthorized!.json();
    assert.strictEqual(errBody.jsonrpc, "2.0");
    assert.strictEqual(errBody.error.code, -32000);

    // CORS 合并模式
    const ok = await handler(new Request("http://x/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer secret", Origin: "https://app.example" },
      body: "{}",
    }));
    assert.strictEqual(ok!.headers.get("Access-Control-Allow-Origin"), "https://app.example");
    assert.strictEqual(ok!.headers.get("X-Origin"), "mcp");
  });
});
