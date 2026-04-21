export interface ParsedGeneratedScript {
  id: string;
  name: string;
  source: string;
  inputSchemaText: string;
  outputSchemaText: string;
}

type SectionKind = "id" | "name" | "source" | "inputSchema" | "outputSchema";

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
  const normalizedText = normalizeLineBreaks(text).trim();
  if (!normalizedText) {
    throw new Error("请先粘贴 generate-script 的完整输出");
  }

  const matches = Array.from(normalizedText.matchAll(SECTION_HEADING_PATTERN));
  if (matches.length === 0) {
    throw new Error("未找到格式标题，请粘贴 generate-script 的完整输出");
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
    const end =
      index < matches.length - 1 ? (matches[index + 1].index ?? normalizedText.length) : normalizedText.length;

    sections.set(kind, normalizedText.slice(start, end).trim());
  });

  if (sections.size === 0) {
    throw new Error("未找到 generate-script 约定的段落标题");
  }

  return sections;
}

function extractRequiredText(sections: Map<SectionKind, string>, kind: "id" | "name"): string {
  const content = sections.get(kind);
  if (content === undefined) {
    throw new Error(`缺少段落：${getSectionLabel(kind)}`);
  }

  const firstLine = content
    .split("\n")
    .map((item) => item.trim())
    .find(Boolean);

  if (!firstLine) {
    throw new Error(`${getSectionLabel(kind)} 不能为空`);
  }

  return firstLine;
}

function extractCodeBlock(
  sections: Map<SectionKind, string>,
  kind: "source" | "inputSchema" | "outputSchema",
  expectedLanguage: "groovy" | "json"
): string {
  const content = sections.get(kind);
  if (!content) {
    throw new Error(`缺少段落：${getSectionLabel(kind)}`);
  }

  const matches = Array.from(content.matchAll(CODE_BLOCK_PATTERN));
  if (matches.length === 0) {
    throw new Error(`${getSectionLabel(kind)} 缺少 ${expectedLanguage} 代码块`);
  }

  const matchedBlock = matches.find((match) => match[1].trim().toLowerCase() === expectedLanguage);
  if (!matchedBlock) {
    throw new Error(`${getSectionLabel(kind)} 代码块语言必须是 ${expectedLanguage}`);
  }

  const blockContent = matchedBlock[2].trim();
  if (!blockContent) {
    throw new Error(`${getSectionLabel(kind)} 代码块不能为空`);
  }

  return blockContent;
}

export function parseGeneratedScriptText(text: string): ParsedGeneratedScript {
  const sections = collectSections(text);

  return {
    id: extractRequiredText(sections, "id"),
    name: extractRequiredText(sections, "name"),
    source: extractCodeBlock(sections, "source", "groovy"),
    inputSchemaText: extractCodeBlock(sections, "inputSchema", "json"),
    outputSchemaText: extractCodeBlock(sections, "outputSchema", "json")
  };
}
