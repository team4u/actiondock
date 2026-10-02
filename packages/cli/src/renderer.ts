import type {
  Envelope,
  CliContext,
} from "./types";
import { formatError } from "./errors";

export * from "./renderers/project";
export * from "./renderers/action";
export * from "./renderers/playbook";
export * from "./renderers/config";
export * from "./renderers/state";
export * from "./renderers/runs";

/**
 * 构造标准成功结果信封。
 * 
 * @param data 业务数据载荷
 * @param meta 附加元数据
 */
export function createSuccessEnvelope<T>(data: T, meta?: Record<string, unknown>): Envelope<T> {
  const result: Envelope<T> = {
    ok: true,
    data,
  };
  if (meta && Object.keys(meta).length > 0) {
    result.meta = meta;
  }
  return result;
}

/**
 * 构造标准失败结果信封。
 * 
 * @param code 错误码
 * @param message 错误描述信息
 * @param details 附加错误细节
 * @param meta 附加元数据
 */
export function createErrorEnvelope(
  code: string,
  message: string,
  details?: unknown,
  meta?: Record<string, unknown>,
  hint?: string
): Envelope<never> {
  const effectiveHint =
    hint ??
    (details && typeof details === "object" && typeof (details as any).hint === "string"
      ? (details as any).hint
      : undefined);

  const result: Envelope<never> = {
    ok: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
  if (effectiveHint !== undefined) {
    result.hint = effectiveHint;
  }
  if (meta && Object.keys(meta).length > 0) {
    result.meta = meta;
  }
  return result;
}

/**
 * 序列化数据为格式化 JSON 字符串。
 * 
 * @param data 待序列化数据
 * @param pretty 是否美化格式
 */
export function formatJson(data: unknown, pretty: boolean = true): string {
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}

/**
 * 标准输出写入辅助方法。
 */
export function writeStdout(message: string, context?: CliContext): void {
  if (context?.stdout) {
    context.stdout(message);
  } else {
    console.log(message);
  }
}

/**
 * 标准错误写入辅助方法。
 */
export function writeStderr(message: string, context?: CliContext): void {
  if (context?.stderr) {
    context.stderr(message);
  } else {
    console.error(message);
  }
}

/**
 * 统一根据输出模式进行渲染输出。
 */
export function renderResult<T>(
  data: T,
  options: {
    json?: boolean;
    humanFormatter?: () => string;
    context?: CliContext;
  }
): void {
  const isJson = Boolean(options.json);

  if (isJson) {
    writeStdout(formatJson(data), options.context);
  } else {
    if (options.humanFormatter) {
      writeStdout(options.humanFormatter(), options.context);
    } else {
      writeStdout(typeof data === "string" ? data : formatJson(data), options.context);
    }
  }
}

/**
 * 统一渲染异常输出。
 */
export function renderError(
  err: unknown,
  options: {
    json?: boolean;
    context?: CliContext;
  }
): void {
  const formatted = formatError(err);
  const isMachine = Boolean(options.json);

  if (isMachine) {
    const errorEnv = createErrorEnvelope(
      formatted.code,
      formatted.message,
      formatted.details,
      undefined,
      formatted.hint
    );
    writeStdout(formatJson(errorEnv), options.context);
  } else {
    writeStderr(`Error: ${formatted.message}`, options.context);
    if (formatted.hint) {
      writeStderr(formatted.hint, options.context);
    }
  }
}
