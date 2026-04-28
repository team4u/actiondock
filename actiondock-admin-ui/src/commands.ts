import type { SchemaFieldDefinition } from "./schema";
import { buildSchemaExecutionInput, buildSchemaFieldExampleValues } from "./schemaExecution";
import type { CommandPreset } from "./components/CommandPanel";
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

function powerShellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function joinCommandLines(lines: string[]): string {
  return lines.join(" \\\n");
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

function buildPowerShellJsonRequestSection({
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
  args.push("-UseBasicParsing");
  if (body) {
    args.push(`-ContentType ${powerShellQuote("application/json; charset=utf-8")}`);
  }
  if (apiKey) {
    args.push("-Headers $headers");
  }
  if (body) {
    args.push("-Body $body");
  }
  sections.push(`$response = ${formatPowerShellCommand("Invoke-WebRequest", args)}`);
  sections.push([
    "$stream = $response.RawContentStream",
    "if ($stream.CanSeek) {",
    "  $stream.Position = 0",
    "}",
    "$reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true)",
    "try {",
    "  $json = $reader.ReadToEnd()",
    "} finally {",
    "  $reader.Dispose()",
    "}",
    "$json | ConvertFrom-Json | ConvertTo-Json -Depth 100"
  ].join("\n"));
  return joinPowerShellScript(sections);
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
  return buildSchemaFieldExampleValues(fields);
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
  return buildPowerShellJsonRequestSection({
    apiKey,
    method: "Get",
    url: `${origin}/api/scripts/${scriptId}`
  });
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
  return buildPowerShellJsonRequestSection({
    apiKey,
    method: "Get",
    url: `${origin}/api/schema/${scriptId}`
  });
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
  return buildPowerShellJsonRequestSection({
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
  return buildPowerShellJsonRequestSection({
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

export function buildCommandPresets(presets: CommandPreset[]): CommandPreset[] {
  return presets.filter((item) => item.command.trim().length > 0);
}

export function buildHttpCommandPresets(params: {
  keyPrefix: string;
  httpBash: string;
  httpPowerShell: string;
}): CommandPreset[] {
  return buildCommandPresets([
    { key: `${params.keyPrefix}-http-bash`, family: "HTTP", environment: "bash/zsh", command: params.httpBash },
    { key: `${params.keyPrefix}-http-powershell`, family: "HTTP", environment: "PowerShell", command: params.httpPowerShell }
  ]);
}
