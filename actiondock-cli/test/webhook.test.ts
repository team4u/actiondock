import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActionDockCliError } from "../src/lib/error.js";
import type { WebhookDefinition } from "../src/lib/types.js";
import {
  mergeDefinitionPatch,
  mergeWebhookDefinition,
  parseDefinitionInput,
  parseOptionalObject,
  parseWebhookRequest,
  resolveEnabledFlag,
} from "../src/lib/webhook.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-wh-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeTmpFile(data: unknown): string {
  const file = path.join(tmpDir, "input.json");
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
}

const defaultLabels = {
  jsonFlag: "`--definition-json`",
  fileFlag: "`--definition-file`"
};

const sampleWebhook: WebhookDefinition = {
  id: "wh-1",
  key: "test-key",
  name: "Test Webhook",
  description: "A test webhook",
  enabled: true,
  transport: {
    type: "HTTP",
    endpointPath: "/hook/test",
    contentTypes: ["application/json"]
  },
  sampleRequest: {
    method: "POST",
    headers: { "content-type": ["application/json"] },
    query: {},
    rawBody: '{"hello":"world"}',
    contentType: "application/json"
  }
};

// ---------------------------------------------------------------------------
// parseDefinitionInput
// ---------------------------------------------------------------------------
describe("parseDefinitionInput", () => {
  it("parses valid JSON string into object", () => {
    const result = parseDefinitionInput<WebhookDefinition>(
      JSON.stringify({ id: "wh-1", key: "k" }),
      undefined,
      defaultLabels
    );
    expect(result.id).toBe("wh-1");
    expect(result.key).toBe("k");
  });

  it("parses from file", () => {
    const file = writeTmpFile({ id: "wh-2", name: "FromFile" });
    const result = parseDefinitionInput<WebhookDefinition>(undefined, file, defaultLabels);
    expect(result.id).toBe("wh-2");
    expect(result.name).toBe("FromFile");
  });

  it("throws when both json and file are provided", () => {
    const file = writeTmpFile({});
    expect(() => parseDefinitionInput("{}", file, defaultLabels)).toThrow(ActionDockCliError);
  });

  it("throws when neither json nor file is provided", () => {
    expect(() => parseDefinitionInput(undefined, undefined, defaultLabels)).toThrow(ActionDockCliError);
  });

  it("throws when parsed value is not an object", () => {
    expect(() => parseDefinitionInput("42", undefined, defaultLabels)).toThrow(ActionDockCliError);
  });

  it("throws when parsed value is empty object", () => {
    expect(() => parseDefinitionInput("{}", undefined, defaultLabels)).toThrow(ActionDockCliError);
  });

  it("throws when parsed value is an array", () => {
    expect(() => parseDefinitionInput("[1,2,3]", undefined, defaultLabels)).toThrow(ActionDockCliError);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseDefinitionInput("{invalid", undefined, defaultLabels)).toThrow(ActionDockCliError);
  });
});

// ---------------------------------------------------------------------------
// parseOptionalObject
// ---------------------------------------------------------------------------
describe("parseOptionalObject", () => {
  it("returns undefined when both inputs are undefined", () => {
    expect(parseOptionalObject(undefined, undefined, defaultLabels)).toBeUndefined();
  });

  it("parses valid JSON object", () => {
    const result = parseOptionalObject<{ foo: string }>('{"foo":"bar"}', undefined, defaultLabels);
    expect(result).toEqual({ foo: "bar" });
  });

  it("parses from file", () => {
    const file = writeTmpFile({ hello: "world" });
    const result = parseOptionalObject<{ hello: string }>(undefined, file, defaultLabels);
    expect(result).toEqual({ hello: "world" });
  });

  it("throws when value is not an object", () => {
    expect(() => parseOptionalObject("42", undefined, defaultLabels)).toThrow(ActionDockCliError);
  });

  it("throws when value is an array", () => {
    expect(() => parseOptionalObject("[1,2]", undefined, defaultLabels)).toThrow(ActionDockCliError);
  });
});

// ---------------------------------------------------------------------------
// parseWebhookRequest
// ---------------------------------------------------------------------------
describe("parseWebhookRequest", () => {
  it("parses a full payload from JSON string", () => {
    const result = parseWebhookRequest(
      JSON.stringify({
        method: "POST",
        path: "/api/test",
        headers: { "content-type": ["application/json"] },
        query: { page: ["1"] },
        rawBody: '{"test":true}',
        contentType: "application/json"
      }),
      undefined
    );
    expect(result.method).toBe("POST");
    expect(result.path).toBe("/api/test");
    expect(result.headers).toEqual({ "content-type": ["application/json"] });
    expect(result.query).toEqual({ page: ["1"] });
    expect(result.rawBody).toBe('{"test":true}');
    expect(result.contentType).toBe("application/json");
  });

  it("returns empty object when no input provided", () => {
    const result = parseWebhookRequest(undefined, undefined);
    expect(result).toEqual({});
  });

  it("coerces non-array header values to single-element arrays", () => {
    const result = parseWebhookRequest(
      JSON.stringify({ headers: { "x-custom": "value" } }),
      undefined
    );
    expect(result.headers).toEqual({ "x-custom": ["value"] });
  });

  it("coerces numeric header values to strings in arrays", () => {
    const result = parseWebhookRequest(
      JSON.stringify({ headers: { "x-count": 42 } }),
      undefined
    );
    expect(result.headers).toEqual({ "x-count": ["42"] });
  });

  it("handles null headers by returning empty object", () => {
    const result = parseWebhookRequest(
      JSON.stringify({ headers: null }),
      undefined
    );
    expect(result.headers).toEqual({});
  });

  it("handles null query by returning empty object", () => {
    const result = parseWebhookRequest(
      JSON.stringify({ query: null }),
      undefined
    );
    expect(result.query).toEqual({});
  });

  it("throws when headers is a non-object non-null value", () => {
    expect(() => parseWebhookRequest(JSON.stringify({ headers: "bad" }), undefined)).toThrow(ActionDockCliError);
  });

  it("throws when query is a non-object non-null value", () => {
    expect(() => parseWebhookRequest(JSON.stringify({ query: 123 }), undefined)).toThrow(ActionDockCliError);
  });

  it("ignores unknown fields in payload", () => {
    const result = parseWebhookRequest(
      JSON.stringify({ method: "GET", unknown: "field" }),
      undefined
    );
    expect(result.method).toBe("GET");
    expect((result as Record<string, unknown>).unknown).toBeUndefined();
  });

  it("reads payload from file", () => {
    const file = writeTmpFile({ method: "PUT", path: "/from-file" });
    const result = parseWebhookRequest(undefined, file);
    expect(result.method).toBe("PUT");
    expect(result.path).toBe("/from-file");
  });
});

// ---------------------------------------------------------------------------
// mergeWebhookDefinition
// ---------------------------------------------------------------------------
describe("mergeWebhookDefinition", () => {
  it("applies top-level overrides to a base definition", () => {
    const result = mergeWebhookDefinition(sampleWebhook, {
      name: "Updated",
      description: "Updated desc",
      enabled: false
    });
    expect(result.name).toBe("Updated");
    expect(result.description).toBe("Updated desc");
    expect(result.enabled).toBe(false);
    // Other fields remain
    expect(result.id).toBe("wh-1");
    expect(result.key).toBe("test-key");
  });

  it("sets transport type via transportType override", () => {
    const result = mergeWebhookDefinition(sampleWebhook, { transportType: "HTTPS" });
    expect(result.transport?.type).toBe("HTTPS");
    // Other transport fields preserved
    expect(result.transport?.endpointPath).toBe("/hook/test");
  });

  it("creates transport object if not present", () => {
    const base: WebhookDefinition = { id: "wh-1" };
    const result = mergeWebhookDefinition(base, { transportType: "HTTP" });
    expect(result.transport?.type).toBe("HTTP");
  });

  it("does not mutate the base object", () => {
    const baseCopy = JSON.parse(JSON.stringify(sampleWebhook));
    mergeWebhookDefinition(sampleWebhook, { name: "Changed" });
    expect(sampleWebhook).toEqual(baseCopy);
  });

  it("leaves fields unchanged when override is undefined", () => {
    const result = mergeWebhookDefinition(sampleWebhook, {});
    expect(result.name).toBe("Test Webhook");
    expect(result.enabled).toBe(true);
  });

  it("overrides id", () => {
    const result = mergeWebhookDefinition(sampleWebhook, { id: "wh-new" });
    expect(result.id).toBe("wh-new");
  });

  it("overrides key", () => {
    const result = mergeWebhookDefinition(sampleWebhook, { key: "new-key" });
    expect(result.key).toBe("new-key");
  });
});

// ---------------------------------------------------------------------------
// mergeDefinitionPatch (deep merge)
// ---------------------------------------------------------------------------
describe("mergeDefinitionPatch", () => {
  it("deep merges nested objects", () => {
    const base = { transport: { type: "HTTP", endpointPath: "/old" }, name: "test" };
    const patch = { transport: { endpointPath: "/new" } };
    const result = mergeDefinitionPatch(base, patch);
    expect(result.transport).toEqual({ type: "HTTP", endpointPath: "/new" });
    expect(result.name).toBe("test");
  });

  it("replaces non-object values", () => {
    const base = { name: "old", count: 1 };
    const result = mergeDefinitionPatch(base, { name: "new" });
    expect(result.name).toBe("new");
    expect(result.count).toBe(1);
  });

  it("replaces arrays entirely rather than merging", () => {
    const base = { tags: ["a", "b"] };
    const result = mergeDefinitionPatch(base, { tags: ["c"] });
    expect(result.tags).toEqual(["c"]);
  });

  it("does not mutate the base", () => {
    const base = { transport: { type: "HTTP" } };
    const baseCopy = JSON.parse(JSON.stringify(base));
    mergeDefinitionPatch(base, { transport: { type: "HTTPS" } });
    expect(base).toEqual(baseCopy);
  });

  it("deep clones values from the patch", () => {
    const patchObj = { nested: { value: "x" } };
    const result = mergeDefinitionPatch({}, patchObj);
    patchObj.nested.value = "y";
    expect((result as Record<string, unknown>).nested).toEqual({ value: "x" });
  });

  it("deep clones arrays from the patch", () => {
    const arr = [1, 2, 3];
    const result = mergeDefinitionPatch({}, { items: arr });
    arr.push(4);
    expect((result as Record<string, Record<string, unknown>>).items).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// resolveEnabledFlag
// ---------------------------------------------------------------------------
describe("resolveEnabledFlag", () => {
  it("returns true when enabledFlag is set", () => {
    expect(resolveEnabledFlag({ enabledFlag: true, disabledFlag: false })).toBe(true);
  });

  it("returns false when disabledFlag is set", () => {
    expect(resolveEnabledFlag({ enabledFlag: false, disabledFlag: true })).toBe(false);
  });

  it("returns fallback when neither flag is set", () => {
    expect(resolveEnabledFlag({ enabledFlag: false, disabledFlag: false, fallback: true })).toBe(true);
    expect(resolveEnabledFlag({ enabledFlag: false, disabledFlag: false, fallback: false })).toBe(false);
  });

  it("returns undefined when no flags and no fallback", () => {
    expect(resolveEnabledFlag({ enabledFlag: false, disabledFlag: false })).toBeUndefined();
  });

  it("throws when both enabled and disabled flags are true", () => {
    expect(() => resolveEnabledFlag({ enabledFlag: true, disabledFlag: true })).toThrow(ActionDockCliError);
  });

  it("uses enabledFlag even when fallback is false", () => {
    expect(resolveEnabledFlag({ enabledFlag: true, disabledFlag: false, fallback: false })).toBe(true);
  });
});
