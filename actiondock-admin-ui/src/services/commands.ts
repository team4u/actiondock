import type { SchemaFieldDefinition } from "../services/schema";
import { buildSchemaExecutionInput, buildSchemaFieldExampleValues } from "../services/schemaExecution";
import type { CommandPreset } from "../components/execution/CommandPanel";
import type { ExecutionResponseView, SubmitMode } from "../shared/types";

export type ObjectInputMode = "SCHEMA" | "JSON";

type CommandInputSource = "current-json" | "current-form" | "sample" | "empty";
type CliEnvironment = "bash/zsh" | "PowerShell";

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

function quoteCliValue(value: string, environment: CliEnvironment): string {
  return environment === "PowerShell" ? powerShellQuote(value) : shellQuote(value);
}

function buildCliCommand(command: string, args: string[], environment: CliEnvironment): string {
  const firstFlagIndex = args.findIndex((arg) => arg.startsWith("--"));
  const positionalArgs = (firstFlagIndex < 0 ? args : args.slice(0, firstFlagIndex)).join(" ");
  const flagArgs = firstFlagIndex < 0 ? [] : args.slice(firstFlagIndex);
  const commandWithPositionals = positionalArgs ? `${command} ${positionalArgs}` : command;
  return [commandWithPositionals, ...flagArgs].join(" ");
}

function buildCliFlag(
  name: string,
  value: string | number | boolean,
  environment: CliEnvironment
): string {
  if (typeof value === "boolean") {
    return value ? `--${name}` : `--${name} ${quoteCliValue("false", environment)}`;
  }
  return `--${name} ${quoteCliValue(String(value), environment)}`;
}

function buildCliCommonFlags(params: {
  apiKey?: string;
  environment: CliEnvironment;
  includeJson?: boolean;
}): string[] {
  const result: string[] = [];
  if (params.apiKey) {
    result.push(buildCliFlag("token", params.apiKey, params.environment));
  }
  if (params.includeJson ?? false) {
    result.push("--json");
  }
  return result;
}

function isFlatCliValue(value: unknown): value is string | number | boolean {
  return typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function splitCliInputObject(input: Record<string, unknown>): {
  flatEntries: Array<[string, string | number | boolean]>;
  jsonRemainder: Record<string, unknown>;
} {
  const flatEntries: Array<[string, string | number | boolean]> = [];
  const jsonRemainder: Record<string, unknown> = {};

  Object.entries(input).forEach(([key, value]) => {
    if (isFlatCliValue(value)) {
      flatEntries.push([key, value]);
      return;
    }
    jsonRemainder[key] = value;
  });

  return { flatEntries, jsonRemainder };
}

function buildCliObjectInputFlags(params: {
  input: Record<string, unknown>;
  jsonFlagName: string;
  environment: CliEnvironment;
}): string[] {
  const { input, jsonFlagName, environment } = params;
  const { flatEntries, jsonRemainder } = splitCliInputObject(input);
  const result = flatEntries.map(([name, value]) => buildCliFlag(name, value, environment));

  if (Object.keys(jsonRemainder).length > 0) {
    result.push(buildCliFlag(jsonFlagName, JSON.stringify(jsonRemainder), environment));
  }

  return result;
}

function buildCliJsonValueFlag(params: {
  flagName: string;
  value: unknown;
  environment: CliEnvironment;
}): string[] {
  return [buildCliFlag(params.flagName, JSON.stringify(params.value), params.environment)];
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
  lines.push(`  ${shellQuote(`${origin}/api/scripts/${scriptId}/published`)}`);
  return joinCommandLines(lines);
}

export function buildCapabilityDetailCurlCommand({
  apiKey,
  capabilityId,
  origin
}: {
  apiKey?: string;
  capabilityId: string;
  origin: string;
}): string {
  const lines = ["curl -X GET"];
  if (apiKey) {
    lines.push(`  -H ${shellQuote(`Authorization: Bearer ${apiKey}`)}`);
  }
  lines.push(`  ${shellQuote(`${origin}/api/scripts/${capabilityId}`)}`);
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
    url: `${origin}/api/scripts/${scriptId}/published`
  });
}

export function buildCapabilityDetailPowerShellCommand({
  apiKey,
  capabilityId,
  origin
}: {
  apiKey?: string;
  capabilityId: string;
  origin: string;
}): string {
  return buildPowerShellJsonRequestSection({
    apiKey,
    method: "Get",
    url: `${origin}/api/scripts/${capabilityId}`
  });
}

export function buildScriptDetailCliCommand({
  apiKey,
  draft = false,
  environment,
  origin,
  scriptId
}: {
  apiKey?: string;
  draft?: boolean;
  environment: CliEnvironment;
  origin: string;
  scriptId: string;
}): string {
  return buildCliCommand("actiondock script get", [
    quoteCliValue(scriptId, environment),
    ...(draft ? ["--draft"] : []),
    ...buildCliCommonFlags({ apiKey, environment })
  ], environment);
}

export function buildCapabilityDetailCliCommand({
  apiKey,
  capabilityId,
  draft = false,
  environment
}: {
  apiKey?: string;
  capabilityId: string;
  draft?: boolean;
  environment: CliEnvironment;
}): string {
  return buildCliCommand("actiondock script get", [
    quoteCliValue(capabilityId, environment),
    ...(draft ? ["--draft"] : []),
    ...buildCliCommonFlags({ apiKey, environment })
  ], environment);
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

export function buildToolSchemaCliCommand({
  apiKey,
  draft = false,
  environment,
  origin,
  scriptId
}: {
  apiKey?: string;
  draft?: boolean;
  environment: CliEnvironment;
  origin: string;
  scriptId: string;
}): string {
  return buildCliCommand("actiondock script schema", [
    quoteCliValue(scriptId, environment),
    ...(draft ? ["--draft"] : []),
    ...buildCliCommonFlags({ apiKey, environment })
  ], environment);
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
        input,
        ...(mode === "SYNC" ? {} : { mode })
      })
    )}`
  );
  lines.push(`  ${shellQuote(`${origin}/api/scripts/${scriptId}/execute`)}`);
  return joinCommandLines(lines);
}

export function buildCapabilityExecuteCurlCommand({
  apiKey,
  capabilityId,
  draft = false,
  input,
  mode,
  origin
}: {
  apiKey?: string;
  capabilityId: string;
  draft?: boolean;
  input: Record<string, unknown>;
  mode: SubmitMode;
  origin: string;
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
        input,
        draft,
        ...(mode === "SYNC" ? {} : { mode })
      })
    )}`
  );
  lines.push(`  ${shellQuote(`${origin}/api/scripts/${capabilityId}/execute`)}`);
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
      input,
      ...(mode === "SYNC" ? {} : { mode })
    },
    method: "Post",
    url: `${origin}/api/scripts/${scriptId}/execute`
  });
}

export function buildCapabilityExecutePowerShellCommand({
  apiKey,
  capabilityId,
  draft = false,
  input,
  mode,
  origin
}: {
  apiKey?: string;
  capabilityId: string;
  draft?: boolean;
  input: Record<string, unknown>;
  mode: SubmitMode;
  origin: string;
}): string {
  return buildPowerShellJsonRequestSection({
    apiKey,
    body: {
      input,
      draft,
      ...(mode === "SYNC" ? {} : { mode })
    },
    method: "Post",
    url: `${origin}/api/scripts/${capabilityId}/execute`
  });
}

export function buildExecuteCliCommand({
  apiKey,
  draft = false,
  environment,
  input,
  mode,
  origin,
  scriptId
}: {
  apiKey?: string;
  draft?: boolean;
  environment: CliEnvironment;
  input: Record<string, unknown>;
  mode: SubmitMode;
  origin: string;
  scriptId: string;
}): string {
  return buildCliCommand("actiondock script run", [
    quoteCliValue(scriptId, environment),
    ...(draft ? ["--draft"] : []),
    ...buildCliCommonFlags({ apiKey, environment }),
    ...(mode === "SYNC" ? [] : [buildCliFlag("mode", mode.toLowerCase(), environment)]),
    ...buildCliObjectInputFlags({
      input,
      jsonFlagName: "input-json",
      environment
    })
  ], environment);
}

export function buildCapabilityExecuteCliCommand({
  apiKey,
  capabilityId,
  draft = false,
  environment,
  input,
  mode
}: {
  apiKey?: string;
  capabilityId: string;
  draft?: boolean;
  environment: CliEnvironment;
  input: Record<string, unknown>;
  mode: SubmitMode;
}): string {
  return buildCliCommand("actiondock script run", [
    quoteCliValue(capabilityId, environment),
    ...(draft ? ["--draft"] : []),
    ...buildCliCommonFlags({ apiKey, environment }),
    ...(mode === "SYNC" ? [] : [buildCliFlag("mode", mode.toLowerCase(), environment)]),
    ...buildCliObjectInputFlags({
      input,
      jsonFlagName: "input-json",
      environment
    })
  ], environment);
}

export function buildPluginInvokeCurlCommand({
  action,
  apiKey,
  args,
  configName,
  origin,
  pluginId,
  responseView,
  scriptInput
}: {
  action: string;
  apiKey?: string;
  args: Record<string, unknown>;
  configName?: string;
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
        responseView: responseView ?? "RESULT",
        ...(configName ? { configName } : {})
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
  configName,
  origin,
  pluginId,
  responseView,
  scriptInput
}: {
  action: string;
  apiKey?: string;
  args: Record<string, unknown>;
  configName?: string;
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
      responseView: responseView ?? "RESULT",
      ...(configName ? { configName } : {})
    },
    method: "Post",
    url: `${origin}/api/plugins/${pluginId}/actions/${action}/invoke`
  });
}

export function buildPluginInvokeCliCommand({
  action,
  apiKey,
  args,
  configName,
  environment,
  origin,
  pluginId,
  responseView,
  scriptInput
}: {
  action: string;
  apiKey?: string;
  args: Record<string, unknown>;
  configName?: string;
  environment: CliEnvironment;
  origin: string;
  pluginId: string;
  responseView?: ExecutionResponseView;
  scriptInput: Record<string, unknown>;
}): string {
  return buildCliCommand("actiondock plugin invoke", [
    quoteCliValue(pluginId, environment),
    quoteCliValue(action, environment),
    ...buildCliCommonFlags({ apiKey, environment }),
    ...(responseView && responseView !== "RESULT"
      ? [buildCliFlag("response-view", responseView.toLowerCase(), environment)]
      : []),
    ...(configName ? [buildCliFlag("config-name", configName, environment)] : []),
    ...buildCliObjectInputFlags({
      input: args,
      jsonFlagName: "args-json",
      environment
    }),
    ...(Object.keys(scriptInput).length > 0
      ? buildCliJsonValueFlag({
          flagName: "script-input-json",
          value: scriptInput,
          environment
        })
      : [])
  ], environment);
}

export function buildSharedStatePutCliCommand({
  apiKey,
  environment,
  expiresAt,
  key,
  namespace,
  origin,
  secret,
  value
}: {
  apiKey?: string;
  environment: CliEnvironment;
  expiresAt?: string | null;
  key: string;
  namespace: string;
  origin: string;
  secret: boolean;
  value: unknown;
}): string {
  return buildCliCommand("actiondock state put", [
    quoteCliValue(namespace, environment),
    quoteCliValue(key, environment),
    ...buildCliCommonFlags({ apiKey, environment }),
    ...buildCliJsonValueFlag({
      flagName: "value-json",
      value,
      environment
    }),
    ...(secret ? ["--secret"] : []),
    ...(expiresAt ? [buildCliFlag("expires-at", expiresAt, environment)] : [])
  ], environment);
}

export function buildSharedStateCasCliCommand({
  apiKey,
  environment,
  expectedVersion,
  expiresAt,
  key,
  namespace,
  origin,
  secret,
  value
}: {
  apiKey?: string;
  environment: CliEnvironment;
  expectedVersion: number;
  expiresAt?: string | null;
  key: string;
  namespace: string;
  origin: string;
  secret: boolean;
  value: unknown;
}): string {
  return buildCliCommand("actiondock state cas", [
    quoteCliValue(namespace, environment),
    quoteCliValue(key, environment),
    ...buildCliCommonFlags({ apiKey, environment }),
    buildCliFlag("expected-version", expectedVersion, environment),
    ...buildCliJsonValueFlag({
      flagName: "value-json",
      value,
      environment
    }),
    ...(secret ? ["--secret"] : []),
    ...(expiresAt ? [buildCliFlag("expires-at", expiresAt, environment)] : [])
  ], environment);
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

export function buildCliCommandPresets(params: {
  keyPrefix: string;
  cliBash: string;
  cliPowerShell: string;
}): CommandPreset[] {
  return buildCommandPresets([
    { key: `${params.keyPrefix}-cli-bash`, family: "CLI", environment: "bash/zsh", command: params.cliBash },
    { key: `${params.keyPrefix}-cli-powershell`, family: "CLI", environment: "PowerShell", command: params.cliPowerShell }
  ]);
}
