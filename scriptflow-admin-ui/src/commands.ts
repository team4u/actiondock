import type { SchemaFieldDefinition } from "./schema";
import type { SubmitMode } from "./types";

type ExecutionInputMode = "SCHEMA" | "JSON";

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

export function buildExecutionInputFromValues(
  fields: SchemaFieldDefinition[],
  values: Record<string, unknown> | undefined
): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((result, field) => {
    const value = values?.[field.name];
    if (value === undefined || value === null || value === "") {
      return result;
    }
    result[field.name] = value;
    return result;
  }, {});
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

export function resolveExecutionCommandInput({
  fields,
  formValues,
  inputMode,
  jsonInput
}: {
  fields: SchemaFieldDefinition[];
  formValues?: Record<string, unknown>;
  inputMode: ExecutionInputMode;
  jsonInput: string;
}): ResolvedCommandInput {
  const example = buildExecutionInputExample(fields);
  const hasExample = Object.keys(example).length > 0;

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
        note: "当前未填写执行入参，已回退到示例请求体。",
        source: "sample",
        value: example
      };
    }
    return {
      note: "当前脚本没有可推导的执行入参示例，已使用空对象。",
      source: "empty",
      value: {}
    };
  }

  const trimmed = jsonInput.trim();
  if (!trimmed || trimmed === "{}") {
    if (hasExample) {
      return {
        note: "当前未填写执行入参，已回退到示例请求体。",
        source: "sample",
        value: example
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
        note: "当前未填写执行入参，已回退到示例请求体。",
        source: "sample",
        value: example
      };
    }
    return {
      source: "empty",
      value: {}
    };
  } catch {
    if (hasExample) {
      return {
        note: "当前 JSON 非法，已回退到示例请求体。",
        source: "sample",
        value: example
      };
    }
    return {
      note: "当前 JSON 非法，且没有可推导的示例请求体，已使用空对象。",
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
  return lines.join(" \\\n");
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
  return lines.join(" \\\n");
}

export function buildScriptDetailCliCommand(scriptId: string): string {
  return `java -jar scriptflow-app-spring/target/scriptflow-app-spring.jar cli script show --id ${shellQuote(
    scriptId
  )}`;
}

export function buildExecuteCliCommand({
  input,
  mode,
  scriptId
}: {
  input: Record<string, unknown>;
  mode: SubmitMode;
  scriptId: string;
}): string {
  return [
    "java -jar scriptflow-app-spring/target/scriptflow-app-spring.jar cli run",
    `--id ${shellQuote(scriptId)}`,
    `--input ${shellQuote(JSON.stringify(input))}`,
    mode === "ASYNC" ? "--async true" : ""
  ]
    .filter(Boolean)
    .join(" ");
}
