/**
 * 构建模块基础错误类。
 */
export class BuilderError extends Error {
  public readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "BuilderError";
    this.code = code;
  }
}

/**
 * 构建规划阶段抛出的错误。
 */
export class PlannerError extends BuilderError {
  public override readonly code: string;

  constructor(message: string, code = "PLANNER_ERROR") {
    super(message, code);
    this.name = "PlannerError";
    this.code = code;
  }
}
