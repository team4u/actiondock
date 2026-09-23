export {
  resolveActionInput,
  type ResolveActionInputOptions,
  parseJson,
  InputError,
  FlatInputError,
  buildActionInputAdvice,
  formatActionDetail,
} from "@actiondock/core/package";

/**
 * 剔除 UTF-8 字符串头部的 BOM 标记字符。
 */
export function stripBom(content: string): string {
  if (typeof content === "string" && content.charCodeAt(0) === 0xfeff) {
    return content.slice(1);
  }
  return content;
}

/**
 * 从标准输入流中完整读取全部数据并转换为 UTF-8 字符串。
 */
export async function readStdin(
  stream: NodeJS.ReadableStream = process.stdin
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return stripBom(Buffer.concat(chunks).toString("utf-8"));
}
