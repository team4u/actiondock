import { describe, expect, it } from "vitest";
import type { SchemaFieldDefinition } from "../schema";
import {
  buildAutoCsvMapping,
  buildDraftFromCsvSource,
  buildDraftFromObjectRows,
  parseCsvSource,
  parseJsonArraySource,
  parseJsonLinesSource
} from "./parser";

const simpleFields: SchemaFieldDefinition[] = [
  {
    name: "orderId",
    label: "订单号",
    kind: "string",
    required: true
  },
  {
    name: "dryRun",
    label: "演练模式",
    kind: "boolean",
    required: false
  },
  {
    name: "retryCount",
    label: "重试次数",
    kind: "integer",
    required: false
  }
];

describe("batch parser", () => {
  it("parses JSON array input", () => {
    const rows = parseJsonArraySource('[{"orderId":"A001"},{"orderId":"A002"}]');
    expect(rows).toEqual([{ orderId: "A001" }, { orderId: "A002" }]);
  });

  it("rejects non-object JSONL rows", () => {
    expect(() => parseJsonLinesSource('{"orderId":"A001"}\n123')).toThrow("第 2 行必须是对象");
  });

  it("builds CSV mappings and coerces typed values", () => {
    const csv = parseCsvSource("orderId,dryRun,retryCount\nA001,true,2\nA002,false,3");
    const mapping = buildAutoCsvMapping(csv.headers, simpleFields);
    const draft = buildDraftFromCsvSource({
      csv,
      mapping,
      supportedFields: simpleFields,
      unsupportedFields: []
    });

    expect(draft.summary.validCount).toBe(2);
    expect(draft.items[0]?.input).toEqual({
      orderId: "A001",
      dryRun: true,
      retryCount: 2
    });
  });

  it("flags required and enum-like mismatches via object draft validation", () => {
    const draft = buildDraftFromObjectRows(
      [{ dryRun: "true" as unknown as boolean }],
      simpleFields
    );

    expect(draft.summary.invalidCount).toBe(1);
    expect(draft.items[0]?.errors.join("；")).toContain("订单号 必填");
    expect(draft.items[0]?.errors.join("；")).toContain("演练模式 类型应为 boolean");
  });

  it("warns on unmapped CSV columns", () => {
    const csv = parseCsvSource("orderId,reason\nA001,补偿");
    const draft = buildDraftFromCsvSource({
      csv,
      mapping: { orderId: "orderId", reason: null },
      supportedFields: simpleFields,
      unsupportedFields: []
    });

    expect(draft.items[0]?.warnings).toContain("列 reason 未映射，将忽略该值");
  });
});
