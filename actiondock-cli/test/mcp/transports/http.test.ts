import http from "node:http";

import { describe, expect, it } from "vitest";

import {
  deriveRequestContext,
  extractBearerToken,
  extractQueryToken
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

/**
 * Start a throwaway backend stub on an ephemeral port that records the
 * Authorization header it receives, so a derived client's downstream call can
 * be observed end-to-end. Returns the URL plus a teardown helper.
 */
async function recordingBackend(): Promise<{
  serverUrl: string;
  received: () => (string | undefined)[];
  close: () => Promise<void>;
}> {
  const received: (string | undefined)[] = [];
  const backend = http.createServer((req, res) => {
    received.push(req.headers.authorization);
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({ status: 200, msg: "ok", data: [] })
    );
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const address = backend.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    serverUrl: `http://127.0.0.1:${port}`,
    received: () => received,
    close: () => new Promise((resolve) => backend.close(() => resolve()))
  };
}

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

describe("extractQueryToken", () => {
  it("reads the access_token query parameter", () => {
    expect(extractQueryToken(new URL("http://h/mcp?access_token=adk_q1"))).toBe("adk_q1");
  });

  it("trims surrounding whitespace in the value", () => {
    expect(extractQueryToken(new URL("http://h/mcp?access_token=%20adk_q1%20"))).toBe("adk_q1");
  });

  it("returns undefined when access_token is absent", () => {
    expect(extractQueryToken(new URL("http://h/mcp"))).toBeUndefined();
    expect(extractQueryToken(new URL("http://h/mcp?token=adk_q1"))).toBeUndefined();
  });

  it("returns undefined for an empty access_token value", () => {
    expect(extractQueryToken(new URL("http://h/mcp?access_token="))).toBeUndefined();
    expect(extractQueryToken(new URL("http://h/mcp?access_token=%20%20"))).toBeUndefined();
  });
});

describe("deriveRequestContext", () => {
  it("forwards the caller's bearer token from the header downstream", async () => {
    const backend = await recordingBackend();
    try {
      const ctx: HttpTransportContext = { serverUrl: backend.serverUrl, policy: httpCtx.policy };
      const { client } = deriveRequestContext(
        ctx,
        reqWithHeader("Bearer adk_header_secret"),
        new URL("http://h/mcp")
      );
      await client.scripts.list();
      expect(backend.received()).toEqual(["Bearer adk_header_secret"]);
    } finally {
      await backend.close();
    }
  });

  it("falls back to access_token query param when no Authorization header is set", async () => {
    // The ChatGPT path: client cannot set headers, so the token rides the URL.
    const backend = await recordingBackend();
    try {
      const ctx: HttpTransportContext = { serverUrl: backend.serverUrl, policy: httpCtx.policy };
      const { client } = deriveRequestContext(
        ctx,
        reqWithHeader(undefined),
        new URL("http://h/mcp?access_token=adk_query_secret")
      );
      await client.scripts.list();
      expect(backend.received()).toEqual(["Bearer adk_query_secret"]);
    } finally {
      await backend.close();
    }
  });

  it("prefers the header over the query param when both are present", async () => {
    const backend = await recordingBackend();
    try {
      const ctx: HttpTransportContext = { serverUrl: backend.serverUrl, policy: httpCtx.policy };
      const { client } = deriveRequestContext(
        ctx,
        reqWithHeader("Bearer adk_header_secret"),
        new URL("http://h/mcp?access_token=adk_query_secret")
      );
      await client.scripts.list();
      expect(backend.received()).toEqual(["Bearer adk_header_secret"]);
    } finally {
      await backend.close();
    }
  });

  it("builds an anonymous client (no Authorization) when neither source yields a token", async () => {
    // No header, no query param → forward nothing; the backend decides.
    const backend = await recordingBackend();
    try {
      const ctx: HttpTransportContext = { serverUrl: backend.serverUrl, policy: httpCtx.policy };
      const { client } = deriveRequestContext(
        ctx,
        reqWithHeader(undefined),
        new URL("http://h/mcp")
      );
      await client.scripts.list();
      expect(backend.received()).toEqual([undefined]);
    } finally {
      await backend.close();
    }
  });

  it("ignores a non-bearer Authorization header but still falls back to the query param", async () => {
    const backend = await recordingBackend();
    try {
      const ctx: HttpTransportContext = { serverUrl: backend.serverUrl, policy: httpCtx.policy };
      const { client } = deriveRequestContext(
        ctx,
        reqWithHeader("Basic dXNlcjpwYXNz"),
        new URL("http://h/mcp?access_token=adk_query_secret")
      );
      await client.scripts.list();
      expect(backend.received()).toEqual(["Bearer adk_query_secret"]);
    } finally {
      await backend.close();
    }
  });
});
