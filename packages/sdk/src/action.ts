import type { ActionDefinition } from "./types";

/**
 * 辅助函数：声明并定义一个强类型的 Action 动作。
 * 
 * 职责：
 * 1. 提供 TypeScript 泛型推导支持（入参类型 `I` 与出参类型 `O`）。
 * 2. 在声明期进行防御性基础结构校验，确保包含非空的字符串 `id` 和可执行的 `run` 函数。
 * 
 * @param definition 包含 id, description, inputSchema, outputSchema, run 的 Action 定义对象
 * @returns 经过校验的 ActionDefinition 原对象
 * @throws {Error} 若 definition 不是对象、缺失 id 或缺失 run 函数
 * 
 * @example
 * ```ts
 * export default defineAction({
 *   id: "sample.greet",
 *   description: "向指定用户打招呼",
 *   async run(input: { name: string }, ctx) {
 *     return { message: `Hello, ${input.name}!` };
 *   }
 * });
 * ```
 */
export function defineAction<I = unknown, O = unknown>(
  definition: ActionDefinition<I, O>
): ActionDefinition<I, O> {
  if (!definition || typeof definition !== "object") {
    throw new Error("Action definition must be an object");
  }
  if (!definition.id || typeof definition.id !== "string") {
    throw new Error("Action definition must have a string 'id'");
  }
  if (typeof definition.run !== "function") {
    throw new Error(`Action '${definition.id}' must have a 'run' function`);
  }
  return definition;
}
