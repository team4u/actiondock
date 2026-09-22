import { readFile } from "node:fs/promises";
import type { JsonValue } from "@actiondock/sdk";
import {
  inputConflict,
  inputFileNotFound,
  inputFileReadFailed,
  invalidJson,
} from "./flat-errors";
import { decodeFlatInput } from "./flat-decode";
import type { FlatParserOptions } from "./flat-parser";
import type { FlatMaterializerOptions } from "./flat-materializer";

/**
 * 剔除 UTF-8 文本起始处的 BOM 字节标记（\uFEFF）。
 *
 * @param text 原始输入文本
 */
export function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

/**
 * 从标准输入流中完整读取全部数据并转换为 UTF-8 字符串。
 *
 * @param stream 标准输入可读流，默认为 process.stdin
 */
export async function readStdin(
  stream: NodeJS.ReadableStream = process.stdin
): Promise<string> {
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
  flatArgs?: string[];
  stdin?: NodeJS.ReadableStream;
  flatOptions?: FlatParserOptions & FlatMaterializerOptions;
}

/**
 * 解析完整 JSON 文档字符串。
 * 若解析失败抛出 INVALID_JSON 异常。
 *
 * @param text 待解析文本
 * @param source 输入源描述（如 --input、--input-file 路径或 stdin）
 */
export function parseJson(text: string, source: string): JsonValue {
  const cleaned = stripBom(text);
  try {
    return JSON.parse(cleaned);
  } catch (err: unknown) {
    throw invalidJson(
      `Invalid JSON input from ${source}: ${err instanceof Error ? err.message : String(err)}`,
      { source }
    );
  }
}

/**
 * 统一解析 Action 执行入参。
 *
 * 规则：
 * - flatArgs、input、inputFile 三者互斥，若同时指定多于一种则抛出 INPUT_CONFLICT。
 * - 统一空数组处理：若 flatArgs 为空数组，视为未指定。
 * - 若指定 flatArgs 则调用 decodeFlatInput。
 * - 若指定 input 则解析内联 JSON（支持 BOM 剥离）。
 * - 若指定 inputFile 则读取文件或从 stdin 读取并解析。
 * - 若均未指定则返回 {}。
 *
 * @param options 输入解析选项
 * @returns 解析后的 JSON 对象
 */
export async function resolveActionInput(
  options: ResolveActionInputOptions
): Promise<JsonValue> {
  const hasFlat = (options.flatArgs?.length ?? 0) > 0;
  const hasInput = options.input !== undefined;
  const hasInputFile = options.inputFile !== undefined;

  let specifiedCount = 0;
  if (hasFlat) specifiedCount++;
  if (hasInput) specifiedCount++;
  if (hasInputFile) specifiedCount++;

  if (specifiedCount > 1) {
    throw inputConflict(
      "Input options conflict: flatArgs, input, and inputFile are mutually exclusive",
      {
        hasFlatArgs: hasFlat,
        hasInput,
        hasInputFile,
      }
    );
  }

  if (hasFlat) {
    return decodeFlatInput(options.flatArgs!, options.flatOptions);
  }

  if (hasInput) {
    return parseJson(options.input!, "--input");
  }

  if (hasInputFile) {
    let text: string;
    if (options.inputFile === "-") {
      try {
        text = await readStdin(options.stdin || process.stdin);
      } catch (err: unknown) {
        throw inputFileReadFailed("stdin", err);
      }
      return parseJson(text, "stdin");
    }

    try {
      text = await readFile(options.inputFile!, "utf8");
    } catch (err: any) {
      if (err && err.code === "ENOENT") {
        throw inputFileNotFound(options.inputFile!);
      }
      throw inputFileReadFailed(options.inputFile!, err);
    }
    return parseJson(text, options.inputFile!);
  }

  return {};
}
