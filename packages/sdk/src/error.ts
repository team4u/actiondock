import type { RuntimeError } from "./types";

/**
 * 标准 Action 运行时结构化错误，实现 RuntimeError 规范。
 */
export class ActionRuntimeError extends Error implements RuntimeError {
  public code: string;
  public details?: unknown;

  constructor(error: RuntimeError) {
    super(error.message);
    this.name = "ActionRuntimeError";
    this.code = error.code;
    this.details = error.details;
    Object.setPrototypeOf(this, ActionRuntimeError.prototype);
  }
}
