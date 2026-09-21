import { readFile } from "node:fs/promises";
import type { JsonValue } from "@actiondock/sdk";
import { FlatInputError, inputConflict, invalidJsonLiteral } from "./flat-errors";
import { decodeFlatInput } from "./index";

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
}

export function parseJson(text: string, source: string): JsonValue {
  const cleaned = stripBom(text);
  try {
    return JSON.parse(cleaned);
  } catch (err: unknown) {
    throw invalidJsonLiteral(
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
  let specifiedCount = 0;
  if (options.flatArgs !== undefined) specifiedCount++;
  if (options.input !== undefined) specifiedCount++;
  if (options.inputFile !== undefined) specifiedCount++;

  if (specifiedCount > 1) {
    throw inputConflict(
      "Input options conflict: flatArgs, input, and inputFile are mutually exclusive",
      {
        hasFlatArgs: options.flatArgs !== undefined,
        hasInput: options.input !== undefined,
        hasInputFile: options.inputFile !== undefined,
      }
    );
  }

  if (options.flatArgs !== undefined) {
    return decodeFlatInput(options.flatArgs);
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
        throw new FlatInputError(
          "INPUT_FILE_READ_FAILED",
          `Failed to read stdin: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      return parseJson(text, "stdin");
    }

    try {
      text = await readFile(options.inputFile, "utf8");
    } catch (err: any) {
      if (err && err.code === "ENOENT") {
        throw new FlatInputError(
          "INPUT_FILE_NOT_FOUND",
          `Input file not found: ${options.inputFile}`
        );
      }
      throw new FlatInputError(
        "INPUT_FILE_READ_FAILED",
        `Failed to read input file '${options.inputFile}': ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return parseJson(text, options.inputFile);
  }

  return {};
}
