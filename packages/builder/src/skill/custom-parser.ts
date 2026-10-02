import { BuilderError } from "../errors";

/**
 * 复合技能自定义说明书（SKILL.custom.md）的槽位，
 * 决定自定义段落插入到官方模板生成结果中的位置。
 */
export type CompositeCustomSlot =
  | "intro"
  | "after-init"
  | "after-describe"
  | "after-actions"
  | "after-playbooks"
  | "after-invoke"
  | "append";

export const COMPOSITE_CUSTOM_SLOTS: readonly CompositeCustomSlot[] = [
  "intro",
  "after-init",
  "after-describe",
  "after-actions",
  "after-playbooks",
  "after-invoke",
  "append",
];

/** 工作区内约定俗成的复合技能自定义说明书文件名。 */
export const COMPOSITE_CUSTOM_DECLARATION_FILE = "SKILL.custom.md";

export interface CompositeCustomSection {
  slot: CompositeCustomSlot;
  content: string;
}

export interface CompositeCustomDeclaration {
  /** 自定义说明书 frontmatter 中声明的 description 覆盖值 */
  description?: string;
  sections: CompositeCustomSection[];
}

export const CUSTOM_SLOT_MARKER_PATTERN = /^\s*<!--\s*actiondock:slot\s+([a-zA-Z][a-zA-Z0-9-]*)\s*-->\s*$/;

/**
 * 解析自定义说明书正文：以 `<!-- actiondock:slot <name> -->` 标记行分段。
 * 首个标记之前的内容归入 `append` 槽位；未知槽位名直接抛错，避免拼写错误被静默吞掉。
 */
export function parseCustomSections(source: string): CompositeCustomSection[] {
  const sections: CompositeCustomSection[] = [];
  let currentSlot: CompositeCustomSlot = "append";
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join("\n").trim();
    buffer = [];
    if (content) {
      sections.push({ slot: currentSlot, content });
    }
  };

  for (const line of source.split(/\r?\n/)) {
    const match = line.match(CUSTOM_SLOT_MARKER_PATTERN);
    if (match) {
      flush();
      const slot = match[1] as CompositeCustomSlot;
      if (!COMPOSITE_CUSTOM_SLOTS.includes(slot)) {
        throw new BuilderError(
          `Unknown ActionDock custom slot '${match[1]}'. Valid slots: ${COMPOSITE_CUSTOM_SLOTS.join(", ")}`,
          "UNKNOWN_CUSTOM_SLOT"
        );
      }
      currentSlot = slot;
      continue;
    }
    buffer.push(line);
  }
  flush();

  return sections;
}

/**
 * 解析复合技能自定义说明书文件：支持 YAML frontmatter 中的 `description` 覆盖，
 * 正文按槽位标记解析为自定义段落。
 */
export function parseCustomSkillDeclaration(source: string): CompositeCustomDeclaration {
  let body = source;
  let description: string | undefined;

  const frontmatter = source.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (frontmatter) {
    body = source.slice(frontmatter[0].length);
    const descLine = frontmatter[1].match(/^description:[ \t]*(.+?)[ \t]*$/m);
    if (descLine) {
      description = descLine[1].replace(/^["']/g, "").replace(/["']$/g, "");
    }
  }

  return { description, sections: parseCustomSections(body) };
}
