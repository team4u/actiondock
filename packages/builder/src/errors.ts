/**
 * Builder 模块基础错误类。
 */
export class BuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuilderError";
  }
}

/**
 * 构建规划阶段抛出的错误。
 */
export class PlannerError extends BuilderError {
  public readonly code: string;

  constructor(message: string, code = "PLANNER_ERROR") {
    super(message);
    this.name = "PlannerError";
    this.code = code;
  }
}

/**
 * 编译器参数与目标平台校验错误。
 */
export class CompilerValidationError extends BuilderError {
  public readonly code: string;
  public readonly target?: string;

  constructor(message: string, options: { code?: string; target?: string } = {}) {
    super(message);
    this.name = "CompilerValidationError";
    this.code = options.code || "COMPILER_VALIDATION_ERROR";
    this.target = options.target;
  }
}

/**
 * 编译器调用执行失败错误。包含标准化错误码与详情。
 */
export class CompilerError extends BuilderError {
  public readonly code: string;
  public readonly exitCode: number;
  public readonly rawError: string;
  public readonly details: string[];
  public readonly target?: string;

  constructor(
    message: string,
    options: {
      code: string;
      exitCode: number;
      rawError: string;
      details?: string[];
      target?: string;
    }
  ) {
    super(message);
    this.name = "CompilerError";
    this.code = options.code;
    this.exitCode = options.exitCode;
    this.rawError = options.rawError;
    this.details = options.details || [];
    this.target = options.target;
  }
}
