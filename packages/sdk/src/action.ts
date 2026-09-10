import type { ActionContext, ActionDefinition } from "./types";

/**
 * Action 核心业务执行函数签名。
 */
export type ActionHandler<I = unknown, O = unknown> = (
  input: I,
  ctx: ActionContext
) => Promise<O> | O;

/**
 * 辅助函数：声明并定义一个强类型的 Action 动作。
 * 
 * 职责：
 * - 提供 TypeScript 泛型推导支持（入参类型 I 与出参类型 O）。
 * - 支持直接传入执行处理函数：defineAction(async (input, ctx) => { ... })。
 * - 支持传入包含 run 执行函数的纯执行对象。
 * 
 * @param handlerOrDefinition Action 执行函数或 Action 定义对象
 * @returns 经过标准化的 ActionDefinition 对象
 */
export function defineAction<I = unknown, O = unknown>(
  handler: ActionHandler<I, O>
): ActionDefinition<I, O>;
export function defineAction<I = unknown, O = unknown>(
  definition: { run: ActionHandler<I, O> }
): ActionDefinition<I, O>;
export function defineAction<I = unknown, O = unknown>(
  arg: ActionHandler<I, O> | { run: ActionHandler<I, O> }
): ActionDefinition<I, O> {
  if (typeof arg === "function") {
    return {
      run: arg,
    };
  }
  if (!arg || typeof arg !== "object" || typeof arg.run !== "function") {
    throw new Error("Action definition must be a function or an object with a run function");
  }
  return {
    run: arg.run,
  };
}
