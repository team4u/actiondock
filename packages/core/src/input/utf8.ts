import type { InputValidationSource } from "./flat-errors";
import { mapInputValidationFailure } from "./validation-mapper";

/**
 * 校验并严格解码字节序列为合法 UTF-8 字符串。
 * 使用 TextDecoder("utf-8", { fatal: true }) 拦截非法编码字节并抛出结构化 INVALID_JSON 异常。
 *
 * @param bytes 待解码的原始字节数据
 * @param source 输入校验来源（默认为 full-json-inline）
 * @returns 解码后的 UTF-8 文本
 * @throws InputError 当包含非法 UTF-8 字节序列时抛出 INVALID_JSON 异常
 */
export function decodeUtf8Strict(
  bytes: Uint8Array | Buffer,
  source: InputValidationSource = "full-json-inline"
): string {
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    return decoder.decode(bytes);
  } catch (err: unknown) {
    throw mapInputValidationFailure(source, {
      valid: false,
      code: "INVALID_UTF8",
      reason: `Invalid UTF-8 encoding: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

/**
 * 仅剥离输入字符串起始处的恰好一个 U+FEFF BOM。
 * 若存在双重 BOM（\uFEFF\uFEFF），仅剥离首个，第二个保留给后续 JSON 解析器以触发 SYNTAX_ERROR。
 *
 * @param text 原始输入文本
 * @returns 剥离首个 BOM 后的文本
 */
export function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) {
    return text.slice(1);
  }
  return text;
}
