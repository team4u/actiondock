import { prettyJson } from "./utils";

export interface ParsedGeneratedScript {
  id?: string;
  name?: string;
  source: string;
  inputSchemaText: string;
  outputSchemaText: string;
}

type SectionKind = "id" | "name" | "source" | "inputSchema" | "outputSchema";
type FieldKind = "string" | "number" | "integer" | "boolean";

interface CodeBlock {
  language: string;
  content: string;
}

const SECTION_HEADING_PATTERN = /^###\s+(.+?)\s*$/gm;
const CODE_BLOCK_PATTERN = /```([^\n`]*)\n([\s\S]*?)```/g;

function normalizeLineBreaks(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function resolveSectionKind(title: string): SectionKind | null {
  const value = title.trim();

  if (/^脚本\s*ID$/i.test(value)) {
    return "id";
  }
  if (/^脚本名称$/i.test(value)) {
    return "name";
  }
  if (/^Groovy\s*脚本$/i.test(value)) {
    return "source";
  }
  if (/^Input\s*Schema(?:\s*[（(]输入参数[）)])?$/i.test(value)) {
    return "inputSchema";
  }
  if (/^Output\s*Schema(?:\s*[（(]输出结果[）)])?$/i.test(value)) {
    return "outputSchema";
  }

  return null;
}

function getSectionLabel(kind: SectionKind): string {
  switch (kind) {
    case "id":
      return "脚本 ID";
    case "name":
      return "脚本名称";
    case "source":
      return "Groovy 脚本";
    case "inputSchema":
      return "Input Schema";
    case "outputSchema":
      return "Output Schema";
    default:
      return "未知段落";
  }
}

function collectSections(text: string): Map<SectionKind, string> {
  const matches = Array.from(text.matchAll(SECTION_HEADING_PATTERN));
  if (matches.length === 0) {
    return new Map();
  }

  const sections = new Map<SectionKind, string>();

  matches.forEach((match, index) => {
    const kind = resolveSectionKind(match[1] ?? "");
    if (!kind) {
      return;
    }
    if (sections.has(kind)) {
      throw new Error(`检测到重复段落：${getSectionLabel(kind)}`);
    }

    const start = (match.index ?? 0) + match[0].length;
    const end = index < matches.length - 1 ? (matches[index + 1].index ?? text.length) : text.length;
    sections.set(kind, text.slice(start, end).trim());
  });

  return sections;
}

function collectCodeBlocks(text: string): CodeBlock[] {
  return Array.from(text.matchAll(CODE_BLOCK_PATTERN))
    .map((match) => ({
      language: (match[1] ?? "").trim().toLowerCase(),
      content: (match[2] ?? "").trim()
    }))
    .filter((block) => block.content);
}

function extractOptionalText(sections: Map<SectionKind, string>, kind: "id" | "name"): string | undefined {
  const content = sections.get(kind);
  if (content === undefined) {
    return undefined;
  }

  const firstLine = content
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    throw new Error(`${getSectionLabel(kind)} 不能为空`);
  }

  return firstLine;
}

function extractSectionCodeBlock(
  sections: Map<SectionKind, string>,
  kind: "source" | "inputSchema" | "outputSchema",
  expectedLanguage: "groovy" | "json"
): string | undefined {
  const content = sections.get(kind);
  if (!content) {
    return undefined;
  }

  const blocks = collectCodeBlocks(content);
  if (blocks.length === 0) {
    throw new Error(`${getSectionLabel(kind)} 缺少 ${expectedLanguage} 代码块`);
  }

  const matched = blocks.find((block) => block.language === expectedLanguage);
  if (!matched) {
    throw new Error(`${getSectionLabel(kind)} 代码块语言必须是 ${expectedLanguage}`);
  }

  return matched.content;
}

function looksLikeGroovySource(text: string): boolean {
  const value = text.trim();
  if (!value) {
    return false;
  }
  return /\breturn\b/.test(value) || /\bdef\b/.test(value) || /\binput(?:\s*\.|\s*\[|\s*\.get\s*\()/.test(value);
}

function extractSource(text: string, sections: Map<SectionKind, string>): string {
  const sourceFromSection = extractSectionCodeBlock(sections, "source", "groovy");
  if (sourceFromSection) {
    return sourceFromSection;
  }

  const sourceFromBlock = collectCodeBlocks(text).find((block) => block.language === "groovy");
  if (sourceFromBlock) {
    return sourceFromBlock.content;
  }

  if (looksLikeGroovySource(text)) {
    return text.trim();
  }

  if (sections.size > 0) {
    throw new Error(`缺少段落：${getSectionLabel("source")}`);
  }

  throw new Error("未找到可识别的 Groovy 源码");
}

function inferInputFields(source: string): Map<string, FieldKind> {
  const fields = new Map<string, FieldKind>();
  const patterns = [
    /\binput\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g,
    /\binput\s*\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g
  ];

  patterns.forEach((pattern) => {
    for (const match of source.matchAll(pattern)) {
      const fieldName = match[1]?.trim();
      if (fieldName) {
        fields.set(fieldName, "string");
      }
    }
  });

  return fields;
}

function splitTopLevelEntries(content: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | "\"" | null = null;
  let escaping = false;

  for (let index = 0; index < content.length; index += 1) {
    const current = content[index];

    if (quote) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (current === "\\") {
        escaping = true;
        continue;
      }
      if (current === quote) {
        quote = null;
      }
      continue;
    }

    if (current === "'" || current === "\"") {
      quote = current;
      continue;
    }
    if (current === "[" || current === "(" || current === "{") {
      depth += 1;
      continue;
    }
    if (current === "]" || current === ")" || current === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (current === "," && depth === 0) {
      const entry = content.slice(start, index).trim();
      if (entry) {
        entries.push(entry);
      }
      start = index + 1;
    }
  }

  const tail = content.slice(start).trim();
  if (tail) {
    entries.push(tail);
  }

  return entries;
}

function inferLiteralKind(expression: string): FieldKind | null {
  const value = expression.trim();
  if (!value) {
    return null;
  }
  if (/^(true|false)$/.test(value)) {
    return "boolean";
  }
  if (/^[-+]?\d+$/.test(value)) {
    return "integer";
  }
  if (/^[-+]?(?:\d+\.\d*|\d*\.\d+)(?:[eE][-+]?\d+)?$/.test(value)) {
    return "number";
  }
  if (value.startsWith("'") || value.startsWith("\"")) {
    return "string";
  }
  return null;
}

function mergeField(fields: Map<string, FieldKind>, fieldName: string, nextKind: FieldKind): void {
  const previousKind = fields.get(fieldName);
  if (!previousKind || previousKind === nextKind) {
    fields.set(fieldName, nextKind);
    return;
  }
  fields.set(fieldName, "string");
}

function inferOutputFields(source: string): Map<string, FieldKind> {
  const fields = new Map<string, FieldKind>();

  for (const match of source.matchAll(/\breturn\s*\[([\s\S]*?)\]/g)) {
    const body = match[1]?.trim() ?? "";
    splitTopLevelEntries(body).forEach((entry) => {
      const parsed = entry.match(/^\s*(?:["']?([A-Za-z_][A-Za-z0-9_]*)["']?)\s*:\s*([\s\S]+)$/);
      if (!parsed) {
        return;
      }

      const fieldName = parsed[1];
      const valueExpression = parsed[2].trim();
      if (valueExpression.startsWith("[") || valueExpression.startsWith("{")) {
        return;
      }

      mergeField(fields, fieldName, inferLiteralKind(valueExpression) ?? "string");
    });
  }

  return fields;
}

function buildSchemaText(fields: Map<string, FieldKind>): string {
  const properties = Array.from(fields.entries()).reduce<Record<string, unknown>>((result, [fieldName, kind]) => {
    result[fieldName] = { type: kind };
    return result;
  }, {});

  return prettyJson({
    type: "object",
    properties
  });
}

function inferSchemaTexts(source: string): { inputSchemaText: string; outputSchemaText: string } {
  return {
    inputSchemaText: buildSchemaText(inferInputFields(source)),
    outputSchemaText: buildSchemaText(inferOutputFields(source))
  };
}

function shouldUseInferredSchema(schemaText: string | undefined): boolean {
  if (!schemaText) {
    return true;
  }

  try {
    const parsed = JSON.parse(schemaText);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return false;
    }

    const properties = (parsed as Record<string, unknown>).properties;
    if (!properties || Array.isArray(properties) || typeof properties !== "object") {
      return true;
    }

    return Object.keys(properties as Record<string, unknown>).length === 0;
  } catch {
    return false;
  }
}

export function parseGeneratedScriptText(text: string): ParsedGeneratedScript {
  const normalizedText = normalizeLineBreaks(text).trim();
  if (!normalizedText) {
    throw new Error("请先粘贴 generate-script 输出或 Groovy 源码");
  }

  const sections = collectSections(normalizedText);
  const source = extractSource(normalizedText, sections);
  const explicitInputSchema = extractSectionCodeBlock(sections, "inputSchema", "json");
  const explicitOutputSchema = extractSectionCodeBlock(sections, "outputSchema", "json");
  const inferred = inferSchemaTexts(source);

  return {
    id: extractOptionalText(sections, "id"),
    name: extractOptionalText(sections, "name"),
    source,
    inputSchemaText:
      shouldUseInferredSchema(explicitInputSchema) || !explicitInputSchema
        ? inferred.inputSchemaText
        : explicitInputSchema,
    outputSchemaText: shouldUseInferredSchema(explicitOutputSchema)
      || !explicitOutputSchema
      ? inferred.outputSchemaText
      : explicitOutputSchema
  };
}
