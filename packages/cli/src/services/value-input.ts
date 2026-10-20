import type { JsonValue } from "@actiondock/sdk";
import { hasValueInput, resolveValueInput, type ResolveValueInputOptions } from "@actiondock/core/project";
import type { CliContext } from "../types";

export type StoredValueInput = Pick<ResolveValueInputOptions, "value" | "flatArgs" | "fromStdin" | "stdinField">;
export { hasValueInput as hasStoredValueInput } from "@actiondock/core/project";

/** CLI 只负责接入输入流与可选交互提示，解码语义统一委托核心。 */
export async function resolveStoredValue(
  input: StoredValueInput,
  context?: CliContext,
  prompt?: () => Promise<string>
): Promise<JsonValue> {
  const source = !hasValueInput(input) && prompt ? { value: await prompt() } : input;
  return resolveValueInput({
    ...source,
    stdin: context?.stdin,
    signal: context?.control?.signal,
    policy: { sanitizeInputErrors: true },
  });
}
