import type { JsonValue } from "@actiondock/sdk";
import { parseFlatAssignments, type FlatParserOptions } from "./flat-parser";
import {
  materializeFlatInput,
  type FlatMaterializerOptions,
} from "./flat-materializer";

/**
 * 将扁平入参字符串列表解码并物化为标准 JSON 值对象。
 *
 * @param tokens 扁平入参字符串列表
 * @param options 解析与物化安全阈值选项
 * @returns 物化后的 JSON 值对象
 */
export function decodeFlatInput(
  tokens: string[],
  options?: FlatParserOptions & FlatMaterializerOptions
): JsonValue {
  const assignments = parseFlatAssignments(tokens, options);
  return materializeFlatInput(assignments, options);
}

export * from "./flat-errors";
export * from "./flat-parser";
export * from "./flat-materializer";
export * from "./input-resolver";
