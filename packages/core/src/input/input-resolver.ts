import type { JsonValue } from "@actiondock/sdk";
import {
  inputConflict,
  inputFileNotFound,
  inputFileReadFailed,
  inputLimitExceeded,
  invalidJson,
  InputError,
  FlatInputError,
} from "./flat-errors";
import { decodeFlatInput } from "./flat-decode";
import type { FlatParserOptions } from "./flat-parser";
import type { FlatMaterializerOptions } from "./flat-materializer";
import {
  validateJsonValue,
  DEFAULT_MAX_JSON_DEPTH,
} from "../json/value-validator";
import { scanJsonDepth } from "./json-depth-scanner";
import { decodeUtf8Strict, stripBom } from "./utf8";
import {
  readRegularFileBounded,
  DEFAULT_MAX_INPUT_BYTES,
} from "./file-input";
import { readStdinBounded } from "./stdin-input";

export { stripBom } from "./utf8";

/**
 * 输入解析策略配置。
 */
export interface InputResolutionPolicy {
  /** 最大允许输入字节数（默认 10MB） */
  maxInputBytes?: number;
  /** 最大允许 JSON 嵌套深度（默认 256） */
  maxJsonDepth?: number;
  /** 是否启用严格 UTF-8 校验（默认 true） */
  strictUtf8?: boolean;
  /** 是否对面向 Agent 的错误信息进行脱敏（默认 false） */
  sanitizeInputErrors?: boolean;
  /** 是否仅允许字节流输入（默认 false） */
  byteStreamOnly?: boolean;
}

/**
 * 从标准输入流中完整读取全部数据并转换为 UTF-8 字符串（保持历史接口兼容）。
 *
 * @param stream 标准输入可读流，默认为 process.stdin
 */
export async function readStdin(
  stream: NodeJS.ReadableStream = process.stdin
): Promise<string> {
  return readStdinBounded(stream, { strictUtf8: false });
}

/**
 * Action 执行输入解析选项。
 */
export interface ResolveActionInputOptions {
  input?: string;
  inputFile?: string;
  flatArgs?: string[];
  stdin?: NodeJS.ReadableStream;
  flatOptions?: FlatParserOptions & FlatMaterializerOptions;
  policy?: InputResolutionPolicy;
  signal?: AbortSignal;
}

/**
 * 针对面向 Agent 场景对结构化输入错误进行隐私脱敏。
 *
 * 脱敏准则：
 * - details.source 严格收敛为稳定枚举："flat" | "inline-json" | "file" | "stdin"。
 * - 严禁在错误信息和 details 中回显原始 token、原始 JSON 内容、文件绝对路径及异常堆栈。
 * - INPUT_FILE_NOT_FOUND 输出固定为：code: "INPUT_FILE_NOT_FOUND", message: "Input file not found", details: { source: "file" }。
 */
function sanitizeError(
  err: unknown,
  source: "flat" | "inline-json" | "file" | "stdin"
): unknown {
  if (err instanceof InputError) {
    const code = err.code;
    const rawDetails =
      err.details && typeof err.details === "object" && !Array.isArray(err.details)
        ? (err.details as Record<string, unknown>)
        : {};
    const reason =
      (rawDetails.reason as string) ||
      (code === "INPUT_FILE_NOT_FOUND" ? undefined : "SYNTAX_ERROR");

    if (code === "INPUT_FILE_NOT_FOUND") {
      return new InputError("INPUT_FILE_NOT_FOUND", "Input file not found", {
        source: "file",
      });
    }

    if (code === "INPUT_FILE_READ_FAILED") {
      const msg =
        source === "stdin"
          ? "Failed to read input from stdin"
          : "Failed to read input file";
      return new InputError("INPUT_FILE_READ_FAILED", msg, {
        source,
        ...(rawDetails.reason ? { reason: rawDetails.reason } : {}),
      });
    }

    if (code === "INPUT_CONFLICT") {
      return new InputError(
        "INPUT_CONFLICT",
        "Input options conflict: multiple input modes specified",
        { reason: "MULTIPLE_INPUT_MODES" }
      );
    }

    if (code === "INPUT_LIMIT_EXCEEDED") {
      return new InputError("INPUT_LIMIT_EXCEEDED", "Input limit exceeded", {
        source,
        reason: (rawDetails.reason as string) || "MAX_INPUT_BYTES",
      });
    }

    if (code === "FLAT_INPUT_LIMIT_EXCEEDED") {
      return new FlatInputError(
        "FLAT_INPUT_LIMIT_EXCEEDED",
        "Flat input limit exceeded",
        {
          source: "flat",
          reason: (rawDetails.reason as string) || "MAX_MATERIALIZED_BYTES",
        }
      );
    }

    if (code === "INVALID_FLAT_ARGUMENT") {
      return new FlatInputError(
        "INVALID_FLAT_ARGUMENT",
        "Invalid flat argument",
        {
          source: "flat",
          reason: (rawDetails.reason as string) || "INVALID_ARGUMENT",
        }
      );
    }

    if (code === "INPUT_PATH_CONFLICT") {
      return new FlatInputError(
        "INPUT_PATH_CONFLICT",
        "Input path conflict",
        {
          source: "flat",
          reason: (rawDetails.reason as string) || "PATH_CONFLICT",
        }
      );
    }

    if (code === "INVALID_JSON_LITERAL") {
      return new FlatInputError(
        "INVALID_JSON_LITERAL",
        "Invalid JSON literal",
        {
          source: "flat",
          reason: (rawDetails.reason as string) || "SYNTAX_ERROR",
        }
      );
    }

    if (code === "INVALID_JSON") {
      let msg = "Invalid JSON syntax";
      if (reason === "INVALID_UTF8") {
        msg = "Invalid UTF-8 encoding in JSON input";
      } else if (reason === "MAX_JSON_DEPTH") {
        msg = "Max JSON depth limit exceeded";
      } else if (reason === "NON_FINITE_NUMBER") {
        msg = "Number is non-finite or NaN";
      } else if (reason === "INVALID_JSON_VALUE") {
        msg = "Invalid JSON value";
      }
      return new InputError("INVALID_JSON", msg, {
        source,
        reason,
      });
    }

    return new InputError(code, "Input validation failed", {
      source,
      ...(rawDetails.reason ? { reason: rawDetails.reason } : {}),
    });
  }

  return err;
}

/**
 * 解析完整 JSON 文档字符串。
 * 若解析失败抛出 INVALID_JSON 异常。
 *
 * @param text 待解析文本
 * @param source 输入源描述（如 --input、文件路径或 stdin）
 * @param policy 解析策略选项
 */
export function parseJson(
  text: string,
  source: string,
  policy?: InputResolutionPolicy
): JsonValue {
  const maxDepth = policy?.maxJsonDepth ?? DEFAULT_MAX_JSON_DEPTH;
  const maxBytes = policy?.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;

  // 1. 检查原始字节长度
  const byteLen = Buffer.byteLength(text, "utf8");
  if (byteLen > maxBytes) {
    throw inputLimitExceeded(
      `Input size (${byteLen} bytes) exceeds limit of ${maxBytes} bytes`,
      { reason: "MAX_INPUT_BYTES" }
    );
  }

  // 2. 剥离单个开头的 BOM
  const cleaned = stripBom(text);

  // 3. 空白 / 纯 BOM / 空字符串显式判定为语法错误
  if (cleaned.trim() === "") {
    throw invalidJson(
      `Invalid JSON input from ${source}: Unexpected end of JSON input`,
      { source, reason: "SYNTAX_ERROR" }
    );
  }

  // 4. JSON 结构深度预检
  const depthRes = scanJsonDepth(cleaned, maxDepth);
  if (!depthRes.valid) {
    throw invalidJson(
      `Invalid JSON input from ${source}: Max JSON depth limit (${maxDepth}) exceeded`,
      { source, reason: "MAX_JSON_DEPTH" }
    );
  }

  // 5. 完整 JSON 解析
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err: unknown) {
    throw invalidJson(
      `Invalid JSON input from ${source}: ${err instanceof Error ? err.message : String(err)}`,
      { source, reason: "SYNTAX_ERROR" }
    );
  }

  // 6. JSON 值结构有限性与合法性校验
  const valRes = validateJsonValue(parsed, { maxDepth });
  if (!valRes.valid) {
    throw invalidJson(
      `Invalid JSON input from ${source}: ${valRes.reason}`,
      { source, reason: valRes.code, path: valRes.path }
    );
  }

  return parsed as JsonValue;
}

/**
 * 统一解析 Action 执行入参。
 *
 * 输入模式仲裁规则（Input Mode Arbitration）：
 * - effectiveFlat: flatArgs 存在且 length > 0
 * - hasInlineJson: options.input !== undefined（即使为 ""）
 * - hasFileJson: options.inputFile !== undefined（包含 "-"）
 * - 最多一个为 true；若超过一个，抛出 INPUT_CONFLICT（reason: "MULTIPLE_INPUT_MODES"）。
 * - 若三个均为 false，返回默认 {}。
 * - flatArgs = [] 视为未指定。
 * - options.input === "" 为显式 Full JSON 模式，进入解析并得到 INVALID_JSON / SYNTAX_ERROR，不可退化为 {}。
 * - 显式空 JSON 输入（--input ""、0 字节文件、空 stdin、纯空白、纯 BOM）统一返回 INVALID_JSON / SYNTAX_ERROR。
 *
 * @param options 输入解析选项
 * @returns 解析后的 JSON 对象
 */
export async function resolveActionInput(
  options: ResolveActionInputOptions
): Promise<JsonValue> {
  const effectiveFlat = (options.flatArgs?.length ?? 0) > 0;
  const hasInlineJson = options.input !== undefined;
  const hasFileJson = options.inputFile !== undefined;

  let modeCount = 0;
  if (effectiveFlat) modeCount++;
  if (hasInlineJson) modeCount++;
  if (hasFileJson) modeCount++;

  if (modeCount > 1) {
    const err = inputConflict(
      "Input options conflict: flatArgs, input, and inputFile are mutually exclusive",
      {
        reason: "MULTIPLE_INPUT_MODES",
        hasFlatArgs: effectiveFlat,
        hasInput: hasInlineJson,
        hasInputFile: hasFileJson,
      }
    );
    if (options.policy?.sanitizeInputErrors) {
      throw sanitizeError(err, "flat");
    }
    throw err;
  }

  if (modeCount === 0) {
    return {};
  }

  const policy = options.policy;
  const maxBytes = policy?.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;

  // 1. 扁平入参模式
  if (effectiveFlat) {
    try {
      return decodeFlatInput(options.flatArgs!, options.flatOptions);
    } catch (err) {
      if (policy?.sanitizeInputErrors) {
        throw sanitizeError(err, "flat");
      }
      throw err;
    }
  }

  // 2. 内联 JSON 模式
  if (hasInlineJson) {
    try {
      return parseJson(options.input!, "--input", policy);
    } catch (err) {
      if (policy?.sanitizeInputErrors) {
        throw sanitizeError(err, "inline-json");
      }
      throw err;
    }
  }

  // 3. 文件 / 标准输入 JSON 模式
  if (hasFileJson) {
    const isStdin = options.inputFile === "-";

    if (isStdin) {
      try {
        const text = await readStdinBounded(options.stdin || process.stdin, {
          maxInputBytes: maxBytes,
          signal: options.signal,
          byteStreamOnly: policy?.byteStreamOnly,
          strictUtf8: policy?.strictUtf8 ?? true,
        });
        return parseJson(text, "stdin", policy);
      } catch (err) {
        if (policy?.sanitizeInputErrors) {
          throw sanitizeError(err, "stdin");
        }
        throw err;
      }
    }

    try {
      const fileBytes = await readRegularFileBounded(options.inputFile!, {
        maxInputBytes: maxBytes,
        signal: options.signal,
      });

      const text =
        policy?.strictUtf8 ?? true
          ? decodeUtf8Strict(fileBytes, "full-json-file")
          : fileBytes.toString("utf8");

      return parseJson(text, options.inputFile!, policy);
    } catch (err) {
      if (policy?.sanitizeInputErrors) {
        throw sanitizeError(err, "file");
      }
      throw err;
    }
  }

  return {};
}
