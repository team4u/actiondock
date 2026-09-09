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

  if (typeof schema === "object" && schema !== null) {
    const cloned = JSON.parse(JSON.stringify(schema));
    if (cloned.type === "object" || cloned.properties) {
      cloned.properties = cloned.properties || {};
      cloned.properties.__async = { type: "boolean", description: "Execute action asynchronously" };
      cloned.properties.execution = {
        type: "object",
        description: "Execution options",
        properties: {
          mode: { type: "string", enum: ["sync", "async"] },
          timeoutMs: { type: "number" },
        },
      };
    }
    return fromJsonSchema(cloned);
  }

  return fromJsonSchema(schema as Record<string, unknown>);
}
