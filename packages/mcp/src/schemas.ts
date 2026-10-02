import type { JsonSchema } from "@actiondock/sdk";
import { fromJsonSchema } from "@modelcontextprotocol/server";

/**
 * 将 ActionDock 标准 JSON Schema 归一化为 MCP 标准 Tool Schema。
 * 布尔分支已穷尽（true / false / 对象），无其余可达路径。
 *
 * @param schema 原始 JSON Schema 定义
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

  // JSON Schema 为纯数据结构，structuredClone 深拷贝避免污染调用方原始定义；布尔分支已穷尽，收窄为对象模式
  const cloned = structuredClone(schema) as Record<string, unknown>;
  return fromJsonSchema(cloned as Exclude<JsonSchema, boolean>);
}
