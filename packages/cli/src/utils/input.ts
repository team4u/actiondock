import { readFile } from "node:fs/promises";
import type { JsonValue } from "@actiondock/sdk";
import { ArgumentError } from "../errors";

/**
 * 获取异常的标准描述信息。
 *
 * @param err 待提取消息的异常对象
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * 剔除 UTF-8 文本起始处的 BOM 字节标记（\uFEFF）。
 *
 * @param text 原始输入文本
 */
export function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

/**
 * 统一解析 JSON 字符串为标准 JSON 值对象，并在失败时抛出结构化参数异常。
 *
 * @param text 待解析文本内容
 * @param source 输入源描述（如 "--input"、"stdin" 或文件物理路径）
 */
export function parseJson(text: string, source: string): JsonValue {
  try {
    return JSON.parse(stripBom(text));
  } catch (err: unknown) {
    throw new ArgumentError(
      `Invalid JSON input from ${source}: ${getErrorMessage(err)}`,
      undefined,
      "INVALID_JSON"
    );
  }
}

/**
 * 从标准输入流中完整读取全部数据并转换为 UTF-8 字符串。
 *
 * @param stream 标准输入可读流，默认为 process.stdin
 */
export async function readStdin(stream: NodeJS.ReadableStream = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any));
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Action 执行输入解析选项。
 */
export interface ResolveActionInputOptions {
  input?: string;
  inputFile?: string;
  stdin?: NodeJS.ReadableStream;
}

/**
 * 统一解析 Action 执行入参。
 *
 * 遵循确定性入参契约：
 * - 当未指定任何输入参数时，默认返回空对象 `{}`。
 * - 简单输入通过 `--input` 传递内联 JSON 字符串。
 * - 复杂输入或标准输入通过 `--input-file` 传递（`-` 表示标准输入 stdin）。
 * - 严禁同时指定 `--input` 与 `--input-file`，检测到冲突时明确抛出参数错误。
 *
 * @param options 输入解析选项
 */
export async function resolveActionInput(options: ResolveActionInputOptions): Promise<JsonValue> {
  if (options.input !== undefined && options.inputFile !== undefined) {
    throw new ArgumentError(
      "--input and --input-file cannot be used together",
      undefined,
      "INPUT_CONFLICT"
    );
  }

  if (options.input !== undefined) {
    return parseJson(options.input, "--input");
  }

  if (options.inputFile !== undefined) {
    let text: string;
    if (options.inputFile === "-") {
      try {
        text = await readStdin(options.stdin || process.stdin);
      } catch (err: unknown) {
        throw new ArgumentError(
          `Failed to read stdin: ${getErrorMessage(err)}`,
          undefined,
          "INPUT_FILE_READ_FAILED"
        );
      }
      return parseJson(text, "stdin");
    }

    try {
      text = await readFile(options.inputFile, "utf8");
    } catch (err: any) {
      if (err && err.code === "ENOENT") {
        throw new ArgumentError(
          `Input file not found: ${options.inputFile}`,
          undefined,
          "INPUT_FILE_NOT_FOUND"
        );
      }
      throw new ArgumentError(
        `Failed to read input file '${options.inputFile}': ${getErrorMessage(err)}`,
        undefined,
        "INPUT_FILE_READ_FAILED"
      );
    }

    return parseJson(text, options.inputFile);
  }

  return {};
}
