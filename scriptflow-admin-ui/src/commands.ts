import type { SchemaFieldDefinition } from "./schema";
import { buildSchemaExecutionInput } from "./schemaExecution";
import type { ExecutionResponseView, SubmitMode } from "./types";

export type ObjectInputMode = "SCHEMA" | "JSON";

type CommandInputSource = "current-json" | "current-form" | "sample" | "empty";

export interface ResolvedCommandInput {
  note?: string;
  source: CommandInputSource;
  value: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function cmdQuote(value: string): string {
  const escaped = value
    .replace(/(\\*)"/g, "$1$1\\\"")
    .replace(/(\\+)$/g, "$1$1");
  return `"${escaped}"`;
}

function powerShellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function joinCommandLines(lines: string[]): string {
  return lines.join(" \\\n");
}

function joinSingleLineCommand(parts: string[]): string {
  return parts.join(" ");
}

function joinPowerShellScript(sections: string[]): string {
  return sections.filter((section) => section.trim().length > 0).join("\n\n");
}

function formatPowerShellCommand(command: string, args: string[]): string {
  const lines = [command + " `"];
  args.forEach((arg, index) => {
    lines.push(`  ${arg}${index < args.length - 1 ? " `" : ""}`);
  });
  return lines.join("\n");
}

function buildPowerShellHeadersSection(apiKey?: string): string {
  if (!apiKey) {
    return "";
  }
  return [
    "$headers = @{",
    `  Authorization = ${powerShellQuote(`Bearer ${apiKey}`)}`,
    "}"
  ].join("\n");
}

function buildPowerShellBodySection(payload: Record<string, unknown>): string {
  return `$body = @'\n${JSON.stringify(payload, null, 2)}\n'@`;
}

function buildPowerShellInvokeRestMethodCommand({
  apiKey,
  body,
  method,
  url
}: {
  apiKey?: string;
  body?: Record<string, unknown>;
  method: "Get" | "Post";
  url: string;
}): string {
  const sections: string[] = [];
  const headersSection = buildPowerShellHeadersSection(apiKey);
  if (headersSection) {
    sections.push(headersSection);
  }
  if (body) {
    sections.push(buildPowerShellBodySection(body));
  }

  const args = [`-Uri ${powerShellQuote(url)}`, `-Method ${method}`];
  if (body) {
    args.push(`-ContentType ${powerShellQuote("application/json")}`);
  }
  if (apiKey) {
    args.push("-Headers $headers");
  }
  if (body) {
    args.push("-Body $body");
  }
  sections.push(formatPowerShellCommand("Invoke-RestMethod", args));
  return joinPowerShellScript(sections);
}

function buildCliCommandPrefix({
  apiKey,
  origin
}: {
  apiKey?: string;
  origin: string;
}): string[] {
  const lines = [
    "java -jar scriptflow-cli.jar",
    `  --base-url ${shellQuote(origin)}`
  ];
  if (apiKey) {
    lines.push(`  --token ${shellQuote(apiKey)}`);
  }
  return lines;
}

function buildCmdCliCommandPrefix({
  apiKey,
  origin
}: {
  apiKey?: string;
  origin: string;
}): string[] {
  const parts = [
    "java -jar scriptflow-cli.jar",
    `--base-url ${cmdQuote(origin)}`
  ];
  if (apiKey) {
    parts.push(`--token ${cmdQuote(apiKey)}`);
  }
  return parts;
}

export function buildExecutionInputFromValues(
  fields: SchemaFieldDefinition[],
  values: Record<string, unknown> | undefined
): Record<string, unknown> {
  return buildSchemaExecutionInput(fields, values);
}

export function buildExecutionInputExample(
  fields: SchemaFieldDefinition[]
): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((result, field) => {
    if (field.kind === "enum") {
      result[field.name] = field.enumValues?.[0] ?? "";
      return result;
    }
    if (field.kind === "boolean") {
      result[field.name] = true;
      return result;
    }
    if (field.kind === "integer" || field.kind === "number") {
      result[field.name] = 1;
      return result;
    }
    result[field.name] = `${field.name}-example`;
    return result;
  }, {});
}

function parseCommandJson(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value || "{}");
  if (!isRecord(parsed)) {
    throw new Error("JSON 顶层必须是对象");
  }
  return parsed;
}

export function getCommandInputSourceLabel(source: "current-json" | "current-form" | "sample" | "empty"): string {
  switch (source) {
    case "current-json":
      return "当前 JSON 输入";
    case "current-form":
      return "当前表单输入";
    case "sample":
      return "示例请求体";
    default:
      return "空对象";
  }
}

export function resolveExecutionCommandInput({
  fields,
  formValues,
  inputMode,
  jsonInput
}: {
  fields: SchemaFieldDefinition[];
  formValues?: Record<string, unknown>;
  inputMode: ObjectInputMode;
  jsonInput: string;
}): ResolvedCommandInput {
  return resolveCommandObjectInput({
    fields,
    formValues,
    inputMode,
    jsonInput,
    fallbackValue: buildExecutionInputExample(fields),
    emptyFallbackNote: "当前未填写执行入参，已回退到示例请求体。",
    emptyNoFallbackNote: "当前脚本没有可推导的执行入参示例，已使用空对象。",
    invalidFallbackNote: "当前 JSON 非法，已回退到示例请求体。",
    invalidNoFallbackNote: "当前 JSON 非法，且没有可推导的示例请求体，已使用空对象。"
  });
}

export function resolveCommandObjectInput({
  fields,
  formValues,
  inputMode,
  jsonInput,
  fallbackValue,
  emptyFallbackNote,
  emptyNoFallbackNote,
  invalidFallbackNote,
  invalidNoFallbackNote
}: {
  fields: SchemaFieldDefinition[];
  formValues?: Record<string, unknown>;
  inputMode: ObjectInputMode;
  jsonInput: string;
  fallbackValue?: Record<string, unknown>;
  emptyFallbackNote: string;
  emptyNoFallbackNote?: string;
  invalidFallbackNote: string;
  invalidNoFallbackNote?: string;
}): ResolvedCommandInput {
  const example = buildExecutionInputExample(fields);
  const resolvedFallbackValue = fallbackValue ?? example;
  const hasExample = Object.keys(resolvedFallbackValue).length > 0;

  if (inputMode === "SCHEMA" && fields.length > 0) {
    const currentFormInput = buildExecutionInputFromValues(fields, formValues);
    if (Object.keys(currentFormInput).length > 0) {
      return {
        source: "current-form",
        value: currentFormInput
      };
    }
    if (hasExample) {
      return {
        note: emptyFallbackNote,
        source: "sample",
        value: resolvedFallbackValue
      };
    }
    return {
      note: emptyNoFallbackNote,
      source: "empty",
      value: {}
    };
  }

  const trimmed = jsonInput.trim();
  if (!trimmed || trimmed === "{}") {
    if (hasExample) {
      return {
        note: emptyFallbackNote,
        source: "sample",
        value: resolvedFallbackValue
      };
    }
    return {
      source: "empty",
      value: {}
    };
  }

  try {
    const parsed = parseCommandJson(trimmed);
    if (Object.keys(parsed).length > 0) {
      return {
        source: "current-json",
        value: parsed
      };
    }
    if (hasExample) {
      return {
        note: emptyFallbackNote,
        source: "sample",
        value: resolvedFallbackValue
      };
    }
    return {
      source: "empty",
      value: {}
    };
  } catch {
    if (hasExample) {
      return {
        note: invalidFallbackNote,
        source: "sample",
        value: resolvedFallbackValue
      };
    }
    return {
      note: invalidNoFallbackNote,
      source: "empty",
      value: {}
    };
  }
}

export function buildScriptDetailCurlCommand({
  apiKey,
  origin,
  scriptId
}: {
  apiKey?: string;
  origin: string;
  scriptId: string;
}): string {
  const lines = ["curl -X GET"];
  if (apiKey) {
    lines.push(`  -H ${shellQuote(`Authorization: Bearer ${apiKey}`)}`);
  }
  lines.push(`  ${shellQuote(`${origin}/api/scripts/${scriptId}`)}`);
  return joinCommandLines(lines);
}

export function buildScriptDetailPowerShellCommand({
  apiKey,
  origin,
  scriptId
}: {
  apiKey?: string;
  origin: string;
  scriptId: string;
}): string {
  return buildPowerShellInvokeRestMethodCommand({
    apiKey,
    method: "Get",
    url: `${origin}/api/scripts/${scriptId}`
  });
}

export function buildScriptDetailCliCommand({
  apiKey,
  origin,
  scriptId
}: {
  apiKey?: string;
  origin: string;
  scriptId: string;
}): string {
  const lines = buildCliCommandPrefix({ apiKey, origin });
  lines.push(`  scripts get ${shellQuote(scriptId)}`);
  return joinCommandLines(lines);
}

export function buildScriptDetailCmdCliCommand({
  apiKey,
  origin,
  scriptId
}: {
  apiKey?: string;
  origin: string;
  scriptId: string;
}): string {
  const parts = buildCmdCliCommandPrefix({ apiKey, origin });
  parts.push("scripts", "get", cmdQuote(scriptId));
  return joinSingleLineCommand(parts);
}

export function buildToolDetailCurlCommand({
  apiKey,
  origin,
  scriptId
}: {
  apiKey?: string;
  origin: string;
  scriptId: string;
}): string {
  const lines = ["curl -X GET"];
  if (apiKey) {
    lines.push(`  -H ${shellQuote(`Authorization: Bearer ${apiKey}`)}`);
  }
  lines.push(`  ${shellQuote(`${origin}/api/schema/${scriptId}`)}`);
  return joinCommandLines(lines);
}

export function buildToolDetailPowerShellCommand({
  apiKey,
  origin,
  scriptId
}: {
  apiKey?: string;
  origin: string;
  scriptId: string;
}): string {
  return buildPowerShellInvokeRestMethodCommand({
    apiKey,
    method: "Get",
    url: `${origin}/api/schema/${scriptId}`
  });
}

export function buildToolDetailCliCommand({
  apiKey,
  origin,
  scriptId
}: {
  apiKey?: string;
  origin: string;
  scriptId: string;
}): string {
  const lines = buildCliCommandPrefix({ apiKey, origin });
  lines.push(`  scripts schema ${shellQuote(scriptId)}`);
  return joinCommandLines(lines);
}

export function buildToolDetailCmdCliCommand({
  apiKey,
  origin,
  scriptId
}: {
  apiKey?: string;
  origin: string;
  scriptId: string;
}): string {
  const parts = buildCmdCliCommandPrefix({ apiKey, origin });
  parts.push("scripts", "schema", cmdQuote(scriptId));
  return joinSingleLineCommand(parts);
}

export function buildExecuteCurlCommand({
  apiKey,
  input,
  mode,
  origin,
  scriptId
}: {
  apiKey?: string;
  input: Record<string, unknown>;
  mode: SubmitMode;
  origin: string;
  scriptId: string;
}): string {
  const lines = [
    "curl -X POST",
    `  -H ${shellQuote("Content-Type: application/json")}`
  ];
  if (apiKey) {
    lines.push(`  -H ${shellQuote(`Authorization: Bearer ${apiKey}`)}`);
  }
  lines.push(
    `  -d ${shellQuote(
      JSON.stringify({
        scriptId,
        input,
        mode
      })
    )}`
  );
  lines.push(`  ${shellQuote(`${origin}/api/executions`)}`);
  return joinCommandLines(lines);
}

export function buildExecutePowerShellCommand({
  apiKey,
  input,
  mode,
  origin,
  scriptId
}: {
  apiKey?: string;
  input: Record<string, unknown>;
  mode: SubmitMode;
  origin: string;
  scriptId: string;
}): string {
  return buildPowerShellInvokeRestMethodCommand({
    apiKey,
    body: {
      scriptId,
      input,
      mode
    },
    method: "Post",
    url: `${origin}/api/executions`
  });
}

export function buildExecuteCliCommand({
  apiKey,
  input,
  mode,
  origin,
  scriptId
}: {
  apiKey?: string;
  input: Record<string, unknown>;
  mode: SubmitMode;
  origin: string;
  scriptId: string;
}): string {
  const lines = buildCliCommandPrefix({ apiKey, origin });
  lines.push("  executions submit");
  lines.push(`  --script-id ${shellQuote(scriptId)}`);
  lines.push(`  --input ${shellQuote(JSON.stringify(input))}`);
  lines.push(`  --mode ${mode}`);
  return joinCommandLines(lines);
}

export function buildExecuteCmdCliCommand({
  apiKey,
  input,
  mode,
  origin,
  scriptId
}: {
  apiKey?: string;
  input: Record<string, unknown>;
  mode: SubmitMode;
  origin: string;
  scriptId: string;
}): string {
  const parts = buildCmdCliCommandPrefix({ apiKey, origin });
  parts.push(
    "executions",
    "submit",
    "--script-id",
    cmdQuote(scriptId),
    "--input",
    cmdQuote(JSON.stringify(input)),
    "--mode",
    mode
  );
  return joinSingleLineCommand(parts);
}

export function buildPluginInvokeCurlCommand({
  action,
  apiKey,
  args,
  origin,
  pluginId,
  responseView,
  scriptInput
}: {
  action: string;
  apiKey?: string;
  args: Record<string, unknown>;
  origin: string;
  pluginId: string;
  responseView?: ExecutionResponseView;
  scriptInput: Record<string, unknown>;
}): string {
  const lines = [
    "curl -X POST",
    `  -H ${shellQuote("Content-Type: application/json")}`
  ];
  if (apiKey) {
    lines.push(`  -H ${shellQuote(`Authorization: Bearer ${apiKey}`)}`);
  }
  lines.push(
    `  -d ${shellQuote(
      JSON.stringify({
        args,
        scriptInput,
        responseView: responseView ?? "RESULT"
      })
    )}`
  );
  lines.push(`  ${shellQuote(`${origin}/api/plugins/${pluginId}/actions/${action}/invoke`)}`);
  return joinCommandLines(lines);
}

export function buildPluginInvokePowerShellCommand({
  action,
  apiKey,
  args,
  origin,
  pluginId,
  responseView,
  scriptInput
}: {
  action: string;
  apiKey?: string;
  args: Record<string, unknown>;
  origin: string;
  pluginId: string;
  responseView?: ExecutionResponseView;
  scriptInput: Record<string, unknown>;
}): string {
  return buildPowerShellInvokeRestMethodCommand({
    apiKey,
    body: {
      args,
      scriptInput,
      responseView: responseView ?? "RESULT"
    },
    method: "Post",
    url: `${origin}/api/plugins/${pluginId}/actions/${action}/invoke`
  });
}

export function buildPluginInvokeCliCommand({
  action,
  apiKey,
  args,
  origin,
  pluginId,
  responseView,
  scriptInput
}: {
  action: string;
  apiKey?: string;
  args: Record<string, unknown>;
  origin: string;
  pluginId: string;
  responseView?: ExecutionResponseView;
  scriptInput: Record<string, unknown>;
}): string {
  const lines = buildCliCommandPrefix({ apiKey, origin });
  lines.push(`  plugins invoke ${shellQuote(pluginId)} ${shellQuote(action)}`);
  lines.push(`  --args ${shellQuote(JSON.stringify(args))}`);
  lines.push(`  --script-input ${shellQuote(JSON.stringify(scriptInput))}`);
  lines.push(`  --response-view ${responseView ?? "RESULT"}`);
  return joinCommandLines(lines);
}

export function buildPluginInvokeCmdCliCommand({
  action,
  apiKey,
  args,
  origin,
  pluginId,
  responseView,
  scriptInput
}: {
  action: string;
  apiKey?: string;
  args: Record<string, unknown>;
  origin: string;
  pluginId: string;
  responseView?: ExecutionResponseView;
  scriptInput: Record<string, unknown>;
}): string {
  const parts = buildCmdCliCommandPrefix({ apiKey, origin });
  parts.push(
    "plugins",
    "invoke",
    cmdQuote(pluginId),
    cmdQuote(action),
    "--args",
    cmdQuote(JSON.stringify(args)),
    "--script-input",
    cmdQuote(JSON.stringify(scriptInput)),
    "--response-view",
    responseView ?? "RESULT"
  );
  return joinSingleLineCommand(parts);
}
