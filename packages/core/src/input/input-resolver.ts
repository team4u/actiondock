import type { JsonValue } from "@actiondock/sdk";
import {
  inputConflict,
  inputLimitExceeded,
  inputPathConflict,
  invalidFlatArgument,
  invalidJson,
  InputError,
  FlatInputError,
} from "./flat-errors";
import {
  isFlatPathPropertyName,
  isForbiddenActionInputPropertyName,
} from "./flat-predicates";
import { decodeFlatInput } from "./flat-decode";
import type { FlatParserOptions } from "./flat-parser";
import type { FlatMaterializerOptions } from "./flat-materializer";
import {
  assertTopLevelLeafAvailable,
  assertMaterializedInputWithinLimits,
} from "./flat-materializer";
import {
  validateJsonValue,
  DEFAULT_MAX_JSON_DEPTH,
} from "../value-validator";
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
  /** 原始 stdin 文本模式：保留开头 BOM，UTF-8 编码失败视为读取失败（默认 false，仅作用于 stdinField） */
  stdinRawText?: boolean;
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
  /** 将 stdin 完整原始文本绑定为指定顶层入参字段的字符串值（与 input / inputFile 互斥，可与 flatArgs 组合） */
  stdinField?: string;
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
 * 检测单个扁平 token 是否占用 stdin 绑定目标字段。
 *
 * 判定范围（在读 stdin 与执行业务之前）：
 * - 目标字段本身：重复赋值（DUPLICATE_ASSIGNMENT）；
 * - 目标字段的任意嵌套路径：叶/容器冲突（LEAF_CONTAINER_CONFLICT）。
 *
 * @param token 扁平赋值 token
 * @param field stdin 绑定的目标字段名
 */
function detectFlatTokenFieldConflict(
  token: string,
  field: string
): FlatInputError | null {
  const colonEqIndex = token.indexOf(":=");
  const eqIndex = token.indexOf("=");
  let opIndex = -1;
  if (colonEqIndex !== -1 && (eqIndex === -1 || colonEqIndex < eqIndex)) {
    opIndex = colonEqIndex;
  } else if (eqIndex !== -1) {
    opIndex = eqIndex;
  }
  const rawPath = opIndex === -1 ? token : token.slice(0, opIndex);

  if (rawPath !== field && !rawPath.startsWith(`${field}.`)) return null;

  return inputPathConflict(
    `Input path conflict at "${rawPath}": field "${field}" is already bound to stdin text via --stdin-field`,
    { path: rawPath, reason: rawPath === field ? "DUPLICATE_ASSIGNMENT" : "LEAF_CONTAINER_CONFLICT" }
  );
}

/**
 * 校验 stdin 字段绑定名是否为合法安全顶层属性名。
 *
 * 拒绝空、纯空白、危险属性（`__proto__`、`constructor`、`prototype`）与
 * 不符合扁平命名段规范（含点分嵌套路径）的表达，错误为 INVALID_FLAT_ARGUMENT。
 *
 * @param field 用户提供的字段名
 */
function assertStdinFieldName(field: string): void {
  const problem = (() => {
    if (field.length === 0) return "empty";
    if (field.trim() !== field || field.trim().length === 0) return "whitespace";
    if (isForbiddenActionInputPropertyName(field)) return "forbidden";
    if (field.includes(".")) return "dotted";
    if (!isFlatPathPropertyName(field)) return "invalid";
    return null;
  })();

  if (problem === null) return;

  const reason =
    problem === "forbidden"
      ? "FORBIDDEN_PROPERTY"
      : problem === "dotted"
        ? "INVALID_DOT_NOTATION"
        : "INVALID_SEGMENT";
  throw invalidFlatArgument(
    `Invalid --stdin-field name (length: ${field.length}): must be a non-empty top-level property name without dot notation`,
    { length: field.length, reason }
  );
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
 * - hasStdinField: options.stdinField !== undefined
 * - flat / inline JSON / file JSON 三者仍保持原有严格互斥；
 * - stdinField 可与 flatArgs 组合（正文绑定到字段 + 扁平补充其他字段），
 *   但与 inline JSON、file JSON（含 inputFile="-"）任何来源严格互斥；
 * - 若四者均为 false，返回默认 {}。
 * - flatArgs = [] 视为未指定。
 * - options.input === "" 为显式 Full JSON 模式，进入解析并得到 INVALID_JSON / SYNTAX_ERROR，不可退化为 {}。
 * - 显式空 JSON 输入（--input ""、0 字节文件、空 stdin、纯空白、纯 BOM）统一返回 INVALID_JSON / SYNTAX_ERROR。
 * - stdinField 的 stdin 读取为原始文本绑定：不做 JSON 解析、不剥 BOM、保留首尾空白，空 stdin 得到空字符串。
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
  const hasStdinField = options.stdinField !== undefined;

  // stdin 字段绑定与完整 JSON 来源（内联 / 文件 / stdin JSON）严格互斥
  if (hasStdinField && (hasInlineJson || hasFileJson)) {
    const err = inputConflict(
      "Input options conflict: --stdin-field binds raw stdin text to an action input field and cannot be combined with inline JSON (-i/--input) or file input (-f/--input-file).",
      {
        reason: "MULTIPLE_INPUT_MODES",
        hasFlatArgs: effectiveFlat,
        hasInput: hasInlineJson,
        hasInputFile: hasFileJson,
        hasStdinField,
      }
    );
    if (options.policy?.sanitizeInputErrors) {
      throw sanitizeError(err, "stdin");
    }
    throw err;
  }

  // 原有三种完整输入模式之间的严格互斥保持不变
  let modeCount = 0;
  if (effectiveFlat) modeCount++;
  if (hasInlineJson) modeCount++;
  if (hasFileJson) modeCount++;

  if (modeCount > 1) {
    const err = inputConflict(
      "Input options conflict: flat arguments (-- key=val), inline JSON (-i/--input), and file (-f/--input-file) are mutually exclusive. Specify only one input mode.",
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

  if (modeCount === 0 && !hasStdinField) {
    return {};
  }

  const policy = options.policy;
  const maxBytes = policy?.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;

  // 0. stdin 原始文本字段绑定模式（可与 flatArgs 组合）
  if (hasStdinField) {
    const field = options.stdinField!;
    try {
      assertStdinFieldName(field);

      // 冲突检测与扁平完整解码均先于 stdin 读取：
      // 目标字段占用冲突与任何已知的 flat 语法/路径/字面量错误在读 stdin 前拒绝，
      // 不因等待上游 EOF 而挂起；解码结果复用，读取后不再重复解码。
      let result: Record<string, JsonValue> = {};
      if (effectiveFlat) {
        for (const token of options.flatArgs!) {
          const conflict = detectFlatTokenFieldConflict(token, field);
          if (conflict) {
            throw conflict;
          }
        }
        result = decodeFlatInput(options.flatArgs!, options.flatOptions) as Record<string, JsonValue>;
        assertTopLevelLeafAvailable(result, field);
      }

      const text = await readStdinBounded(options.stdin || process.stdin, {
        maxInputBytes: maxBytes,
        signal: options.signal,
        byteStreamOnly: policy?.byteStreamOnly,
        strictUtf8: policy?.strictUtf8 ?? true,
        rawText: policy?.stdinRawText ?? true,
      });

      // 绑定后对最终入参执行既有实体化结构/总大小校验：
      // stdin 源字节上限（maxInputBytes）与最终对象序列化上限
      // （flatOptions.maxMaterializedSizeBytes，默认 10MiB）各自独立生效，
      // 正文中的引号/反斜杠转义放大亦被最终上限拦截。
      result[field] = text;
      assertMaterializedInputWithinLimits(result, options.flatOptions);
      return result;
    } catch (err) {
      if (policy?.sanitizeInputErrors) {
        throw sanitizeError(err, "stdin");
      }
      throw err;
    }
  }

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
