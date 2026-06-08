import { ActionDockCliError } from "./error.js";
import { buildInputFromSchema, collectDynamicFlags, parseInputObject } from "./input.js";
import { extractSchemaFields } from "./schema.js";
import type { ActionDockClient } from "./client.js";

export function resolveScheduleEnabled(params: {
  enabledFlag: boolean;
  disabledFlag: boolean;
  fallback: boolean;
}): boolean {
  if (params.enabledFlag && params.disabledFlag) {
    throw new ActionDockCliError("`--schedule-enabled` 和 `--schedule-disabled` 不能同时使用。", 2);
  }
  if (params.enabledFlag) {
    return true;
  }
  if (params.disabledFlag) {
    return false;
  }
  return params.fallback;
}

export async function buildScheduleInput(params: {
  client: ActionDockClient;
  scriptId: string;
  argv: string[];
  positionals: string[];
  inputJson: string | undefined;
  inputFile: string | undefined;
  existingInput?: Record<string, unknown>;
  booleanFlags?: Iterable<string>;
  valueFlags?: Iterable<string>;
}): Promise<Record<string, unknown>> {
  const script = await params.client.scripts.get(params.scriptId, false);
  const schema = script.published?.inputSchema ?? script.inputSchema;
  const fields = extractSchemaFields(schema);
  const baseInput = {
    ...(params.existingInput ?? {}),
    ...parseInputObject(params.inputJson, params.inputFile)
  };
  const dynamicFlags = collectDynamicFlags(params.argv, {
    positionals: params.positionals,
    booleanFlags: params.booleanFlags,
    valueFlags: params.valueFlags
  });

  return buildInputFromSchema(baseInput, dynamicFlags, fields).input;
}
