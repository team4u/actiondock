import { ActionDockError, INVALID_ARGUMENT } from "../errors";
import { assertConcreteConfigKey } from "../project/config-declarations";
import { parseJson } from "./input-resolver";

/** 配置赋值只识别等号左侧的 :=，不物化路径，也不把解析失败回退为字符串。 */
export function parseConfigOverrideAssignment(pair: string): { key: string; value: unknown } {
  const equals = pair.indexOf("=");
  if (equals < 0) {
    throw new ActionDockError(INVALID_ARGUMENT, "Expected configuration assignment 'KEY=value' or 'KEY:=json'");
  }
  const json = equals > 0 && pair[equals - 1] === ":";
  const key = pair.slice(0, json ? equals - 1 : equals);
  assertConcreteConfigKey(key);
  const rawValue = pair.slice(equals + 1);
  if (!json) return { key, value: rawValue };
  try {
    return { key, value: parseJson(rawValue, "configuration override") };
  } catch {
    // JSON.parse 和通用输入校验的诊断可能含输入片段，不能直接回显或挂载 cause。
    throw new ActionDockError(INVALID_ARGUMENT, `Invalid JSON configuration override for '${key}'`);
  }
}
