import { describe, expect, it } from "vitest";
import type { SchemaFieldDefinition } from "../services/schema";
import {
  buildBatchSourceExample,
  buildBatchSourceGuidance
} from "./sourceGuidance";

const fields: SchemaFieldDefinition[] = [
  {
    name: "orderId",
    label: "订单号",
    kind: "string",
    required: true,
    examples: ["A001"]
  },
  {
    name: "retryCount",
    label: "重试次数",
    kind: "integer",
    required: false,
    defaultValue: 1
  },
  {
    name: "payload",
    label: "负载",
    kind: "object",
    required: false,
    children: [
      {
        name: "code",
        label: "编码",
        kind: "string",
        required: true,
        examples: ["ok"]
      }
    ]
  }
];

describe("batch source guidance", () => {
  it("builds a valid JSON array example", () => {
    const example = buildBatchSourceExample("JSON_ARRAY", fields);
    const parsed = JSON.parse(example);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty("orderId");
  });

  it("builds JSONL as object-per-line", () => {
    const example = buildBatchSourceExample("JSONL", fields);
    const lines = example.split("\n");

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toHaveProperty("orderId");
    expect(JSON.parse(lines[1] ?? "")).toHaveProperty("payload");
  });

  it("limits CSV examples to simple top-level fields", () => {
    const example = buildBatchSourceExample("CSV", fields);

    expect(example).toContain("orderId,retryCount");
    expect(example).not.toContain("payload");
  });

  it("mentions JSON-only fields in CSV guidance", () => {
    const guidance = buildBatchSourceGuidance({
      sourceType: "CSV",
      supportedFields: fields,
      jsonOnlyFieldLabels: ["负载"]
    });

    expect(guidance.cautions.join("；")).toContain("负载");
  });
});
