import type { JsonSchema } from "@actiondock/sdk";
import { fromJsonSchema } from "@modelcontextprotocol/server";

/**
 * 将 ActionDock 标准 JSON Schema 归一化为 MCP 标准 Tool Schema。
 * 布尔分支已穷尽（true / false / 对象），无其余可达路径。
 *
 * @param schema 原始 JSON Schema 定义
 * @param injectExecution 是否向 schema 注入适配层的 execution 执行控制包装字段：
 *   入参 schema 需要注入（客户端借此声明执行模式与超时），
 *   出参 schema 不注入（实际 structuredContent 不含该字段，注入会与真实返回结构不符）
 */
export function toMcpSchema(schema?: JsonSchema, injectExecution = true) {
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
  const properties = (cloned.properties ?? {}) as Record<string, unknown>;
  if ((cloned.type === "object" || cloned.properties) && injectExecution) {
    cloned.properties = properties;
    properties.execution = {
      type: "object",
      description: "Execution options",
      properties: {
        mode: { type: "string", enum: ["sync", "async"] },
        timeoutMs: { type: "number" },
      },
    };
  }
  return fromJsonSchema(cloned as Exclude<JsonSchema, boolean>);
}
