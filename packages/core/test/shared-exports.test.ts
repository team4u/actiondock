import { describe, expect, it } from "bun:test";
import {
  createMcpEndpointHandler,
  readBodyWithLimit,
  RequestTooLargeError,
  resolveCorsHeaders,
  verifyBearerToken,
  DEFAULT_MAX_BODY_BYTES,
} from "@actiondock/core/server";
import {
  createNonClosingStorageView,
  NodeProcessExecutor,
} from "@actiondock/core/package";

describe("共享导出面验证", () => {
  it("server 子路径导出 readBodyWithLimit 与 RequestTooLargeError", () => {
    expect(typeof readBodyWithLimit).toBe("function");
    expect(typeof RequestTooLargeError).toBe("function");
    expect(typeof resolveCorsHeaders).toBe("function");
    expect(typeof verifyBearerToken).toBe("function");
    expect(DEFAULT_MAX_BODY_BYTES).toBe(1024 * 1024);
  });

  it("package 子路径导出 createNonClosingStorageView 与 NodeProcessExecutor", () => {
    expect(typeof createNonClosingStorageView).toBe("function");
    expect(typeof NodeProcessExecutor).toBe("function");
  });

  it("createNonClosingStorageView 拦截 close 并转发其余成员", () => {
    const storage: any = {
      value: 42,
      getValue() { return this.value; },
      close() { throw new Error("should not close"); },
    };
    const view = createNonClosingStorageView(storage);
    expect(view.getValue()).toBe(42);
    expect(() => view.close()).not.toThrow();
    expect(view !== storage).toBe(true);
  });

  it("createMcpEndpointHandler 鉴权失败产出标准 401 JSON", async () => {
    const handler = createMcpEndpointHandler(async () => new Response("ok"), { token: "secret" });
    const res = await handler(new Request("http://x/mcp", { method: "POST" }));
    expect(res!.status).toBe(401);
    const body: any = await res!.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toBe("Invalid or missing Bearer token");
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
    expect(res!.status).toBe(413);
    const body: any = await res!.json();
    expect(body.error.code).toBe("REQUEST_TOO_LARGE");
    expect(body.error.message).toBe("Request body exceeds maximum allowed size");
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
    expect(res!.status).toBe(200);
    expect(await res!.text()).toBe("delegated");
    expect(captured!.method).toBe("POST");
    const text = await new Response(captured!.body).text();
    expect(JSON.parse(text)).toEqual({ hello: "world" });
  });

  it("createMcpEndpointHandler 委托返回 null 时透传 null 交回调用方", async () => {
    const handler = createMcpEndpointHandler(async () => null, { token: undefined });
    const res = await handler(new Request("http://x/mcp", { method: "GET" }));
    expect(res).toBeNull();
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
    expect(unauthorized!.status).toBe(401);
    const errBody: any = await unauthorized!.json();
    expect(errBody.jsonrpc).toBe("2.0");
    expect(errBody.error.code).toBe(-32000);

    // CORS 合并模式
    const ok = await handler(new Request("http://x/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer secret", Origin: "https://app.example" },
      body: "{}",
    }));
    expect(ok!.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example");
    expect(ok!.headers.get("X-Origin")).toBe("mcp");
  });

  it("NodeProcessExecutor 可实例化并执行命令", async () => {
    const executor = new NodeProcessExecutor();
    const result = await executor.exec("echo", ["hello"]);
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe("hello");
  });
});
