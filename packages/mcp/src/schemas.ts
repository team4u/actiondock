import type { JsonSchema } from "@actiondock/sdk";
import { fromJsonSchema } from "@modelcontextprotocol/server";

/**
 * Normalizes an ActionDock JSON Schema into a standard MCP Tool Schema.
 */
export function toMcpSchema(schema?: JsonSchema) {
  if (schema === undefined || schema === true) {
    return fromJsonSchema({});
  }

  if (schema === false) {
    return fromJsonSchema({
      not: {},
    });
  }

  return fromJsonSchema(schema as Record<string, unknown>);
}
