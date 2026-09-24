import { readStdinBounded, stripBom } from "@actiondock/core/project";

export {
  resolveActionInput,
  type ResolveActionInputOptions,
  parseJson,
  InputError,
  FlatInputError,
  buildActionInputAdvice,
  formatActionDetail,
} from "@actiondock/core/project";

// BOM 剥离单一事实源转引：core 已提供逐字一致的实现，此处仅保留导出面兼容。
export { stripBom };

/**
 * 从标准输入流中完整读取全部数据并转换为 UTF-8 字符串。
 * 底层委托 core 的有界读取实现：保持宽松 UTF-8 解码语义与 BOM 剥离行为，
 * 同时获得默认 10MB 输入上限保护，超限时抛出结构化 INPUT_LIMIT_EXCEEDED 异常。
 */
export async function readStdin(
  stream: NodeJS.ReadableStream = process.stdin
): Promise<string> {
  return stripBom(await readStdinBounded(stream, { strictUtf8: false }));
}
