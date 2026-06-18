import http from "node:http";

import { describe, expect, it } from "vitest";

import {
  deriveRequestContext,
  extractBearerToken
} from "../../../src/mcp/transports/http.js";
import { defaultPolicy } from "../../../src/mcp/types.js";
import type { HttpTransportContext } from "../../../src/mcp/transports/http.js";

/**
 * Minimal IncomingMessage-like stub carrying only the fields
 * {@link deriveRequestContext} reads (headers + nothing else).
 */
function reqWithHeader(authorization: string | undefined): http.IncomingMessage {
  return { headers: { authorization } } as unknown as http.IncomingMessage;
}

const httpCtx: HttpTransportContext = {
  serverUrl: "http://127.0.0.1:5999",
  policy: defaultPolicy()
};

describe("extractBearerToken", () => {
  it("extracts the bare token from a standard Bearer header", () => {
    expect(extractBearerToken("Bearer adk_abc_def")).toBe("adk_abc_def");
  });

  it("matches the scheme case-insensitively", () => {
    expect(extractBearerToken("bearer adk_abc_def")).toBe("adk_abc_def");
    expect(extractBearerToken("BEARER adk_abc_def")).toBe("adk_abc_def");
  });

  it("trims surrounding whitespace around scheme and token", () => {
    expect(extractBearerToken("   Bearer    adk_abc_def   ")).toBe("adk_abc_def");
  });

  it("returns undefined when the header is absent", () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
  });

  it("returns undefined for a non-bearer scheme", () => {
    expect(extractBearerToken("Basic dXNlcjpwYXNz")).toBeUndefined();
  });

  it("returns undefined for an empty/malformed bearer header", () => {
    expect(extractBearerToken("Bearer ")).toBeUndefined();
    expect(extractBearerToken("Bearer")).toBeUndefined();
  });
});

describe("deriveRequestContext", () => {
  it("builds a context whose client forwards the caller's bearer token downstream", async () => {
    // Spin up a real backend stub that records the Authorization header it
    // receives, then point the derived client at it. This proves end-to-end
    // that the request's token reaches the ActionDock backend.
    const receivedAuth: (string | undefined)[] = [];
    const backend = http.createServer((req, res) => {
      receivedAuth.push(req.headers.authorization);
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ status: 200, msg: "ok", data: [] })
      );
    });
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const address = backend.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const serverUrl = `http://127.0.0.1:${port}`;

    const ctx: HttpTransportContext = { serverUrl, policy: httpCtx.policy };
    const { client } = deriveRequestContext(ctx, reqWithHeader("Bearer adk_forwarded_secret"));

    try {
      await client.scripts.list();
      expect(receivedAuth).toEqual(["Bearer adk_forwarded_secret"]);
    } finally {
      backend.close();
    }
  });

  it("builds an anonymous client (no Authorization header) when the caller sends no token", async () => {
    // The key guarantee: a caller that authenticates with nothing must NOT have
    // a Bearer header synthesized downstream — the backend decides, not us.
    const receivedAuth: (string | undefined)[] = [];
    const backend = http.createServer((req, res) => {
      receivedAuth.push(req.headers.authorization);
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ status: 200, msg: "ok", data: [] })
      );
    });
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const address = backend.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const serverUrl = `http://127.0.0.1:${port}`;

    const ctx: HttpTransportContext = { serverUrl, policy: httpCtx.policy };
    const { client } = deriveRequestContext(ctx, reqWithHeader(undefined));

    try {
      await client.scripts.list();
      expect(receivedAuth).toEqual([undefined]);
    } finally {
      backend.close();
    }
  });

  it("ignores a non-bearer Authorization header (treats as anonymous)", async () => {
    const receivedAuth: (string | undefined)[] = [];
    const backend = http.createServer((req, res) => {
      receivedAuth.push(req.headers.authorization);
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ status: 200, msg: "ok", data: [] })
      );
    });
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const address = backend.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const serverUrl = `http://127.0.0.1:${port}`;

    const ctx: HttpTransportContext = { serverUrl, policy: httpCtx.policy };
    const { client } = deriveRequestContext(ctx, reqWithHeader("Basic dXNlcjpwYXNz"));

    try {
      await client.scripts.list();
      // Basic auth is not a bearer token, so we forward nothing — backend
      // applies its own (token-required) policy and the client stays anonymous.
      expect(receivedAuth).toEqual([undefined]);
    } finally {
      backend.close();
    }
  });
});
