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
 * 1. 提供 TypeScript 泛型推导支持（入参类型 `I` 与出参类型 `O`）。
 * 2. 支持直接传入执行 Handler 函数：`defineAction(async (input, ctx) => { ... })`。
 * 3. 支持传入包含 `run` 执行函数的 ActionDefinition 对象。
 * 
 * @param handlerOrDefinition Action 执行函数或 Action 定义对象
 * @returns 经过标准化的 ActionDefinition 对象
 */
export function defineAction<I = unknown, O = unknown>(
  handler: ActionHandler<I, O>
): ActionDefinition<I, O>;
export function defineAction<I = unknown, O = unknown>(
  definition: Partial<ActionDefinition<I, O>> & { run: ActionHandler<I, O> }
): ActionDefinition<I, O>;
export function defineAction<I = unknown, O = unknown>(
  arg: ActionHandler<I, O> | (Partial<ActionDefinition<I, O>> & { run: ActionHandler<I, O> })
): ActionDefinition<I, O> {
  if (typeof arg === "function") {
    const def: ActionDefinition<I, O> = {
      id: "",
      run: arg,
    };
    (arg as any).run = arg;
    (arg as any).id = "";
    return def;
  }
  if (!arg || typeof arg !== "object") {
    throw new Error("Action definition must be a function or an object");
  }
  if (typeof (arg as any).id !== "undefined") {
    if (typeof (arg as any).id !== "string" || (arg as any).id.trim() === "") {
      throw new Error("Action definition must have a non-empty string 'id'");
    }
  }
  if (typeof arg.run !== "function") {
    throw new Error("Action definition must have a 'run' function");
  }
  return {
    ...arg,
    id: arg.id || "",
  } as ActionDefinition<I, O>;
}
