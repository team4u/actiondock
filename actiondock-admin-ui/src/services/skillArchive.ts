import JSZip from "jszip";
import type { SkillArchiveEntry, SkillValidationResult } from "../shared/types";

export interface ParsedSkillArchive {
  file: File;
  validation: SkillValidationResult;
  files: SkillArchiveEntry[];
  textFiles: Record<string, string>;
  rootName?: string;
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "skill";
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(content);
  if (!match) {
    return {};
  }
  const result: { name?: string; description?: string } = {};
  match[1].split(/\r?\n/).forEach((line) => {
    const index = line.indexOf(":");
    if (index <= 0) {
      return;
    }
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key === "name" && value) {
      result.name = value;
    } else if (key === "description" && value) {
      result.description = value;
    }
  });
  return result;
}

function resolveArchiveRoot(zip: JSZip): string | undefined {
  const rootNames = new Set(
    Object.keys(zip.files)
      .map((name) => name.split("/")[0])
      .filter(Boolean)
  );
  if (rootNames.size !== 1) {
    return undefined;
  }
  return [...rootNames][0];
}

function stripRootPath(path: string, rootName?: string): string {
  if (!rootName) {
    return path;
  }
  if (path === rootName) {
    return "";
  }
  if (path.startsWith(`${rootName}/`)) {
    return path.slice(rootName.length + 1);
  }
  return path;
}

export async function parseSkillArchive(file: File): Promise<ParsedSkillArchive> {
  const zip = await JSZip.loadAsync(file);
  const rootName = resolveArchiveRoot(zip);
  const skillJsonPath = rootName ? `${rootName}/skill.json` : "skill.json";
  const skillMdPath = rootName ? `${rootName}/SKILL.md` : "SKILL.md";
  const skillJsonEntry = zip.file(skillJsonPath);
  const skillMdEntry = zip.file(skillMdPath);
  if (!skillMdEntry) {
    throw new Error("Skill 压缩包缺少 SKILL.md");
  }

  const manifest = skillJsonEntry ? JSON.parse(await skillJsonEntry.async("text")) as Record<string, unknown> : {};
  const skillMdContent = await skillMdEntry.async("text");
  const frontmatter = parseSkillFrontmatter(skillMdContent);
  const textFiles: Record<string, string> = {};
  const files: SkillArchiveEntry[] = [];

  await Promise.all(
    Object.values(zip.files).map(async (entry) => {
      const relative = stripRootPath(entry.name, rootName);
      if (!relative) {
        return;
      }
      if (entry.dir) {
        files.push({ path: relative, directory: true });
        return;
      }
      const buffer = await entry.async("arraybuffer");
      const bytes = new Uint8Array(buffer);
      const contentType = relative.endsWith(".md")
        ? "text/markdown"
        : relative.endsWith(".json")
          ? "application/json"
          : relative.endsWith(".txt")
            ? "text/plain"
            : relative.endsWith(".png")
              ? "image/png"
              : relative.endsWith(".jpg") || relative.endsWith(".jpeg")
                ? "image/jpeg"
                : undefined;
      files.push({
        path: relative,
        directory: false,
        size: bytes.byteLength,
        contentType
      });
      if (!contentType || contentType.startsWith("text/") || contentType === "application/json") {
        textFiles[relative] = await entry.async("text");
      }
    })
  );

  return {
    file,
    rootName,
    validation: {
      skillId: normalizeText(manifest.skillId) ?? normalizeText(rootName) ?? slugify(frontmatter.name ?? "skill"),
      displayName: normalizeText(manifest.displayName) ?? frontmatter.name ?? normalizeText(manifest.skillId) ?? "skill",
      version: normalizeText(manifest.version) ?? "1.0.0",
      description: normalizeText(manifest.description) ?? frontmatter.description ?? "",
      owner: normalizeText(manifest.owner),
      tags: normalizeStringArray(manifest.tags),
      riskLevel: normalizeText(manifest.riskLevel),
      entrypointPath: normalizeText(manifest.entrypointPath) ?? "SKILL.md",
      digest: normalizeText(manifest.digest) ?? "",
      warnings: skillJsonEntry ? [] : ["标准 Skill 未包含 ActionDock skill.json，将按标准 Skill 默认元数据解析。"],
      manifestPresent: Boolean(skillJsonEntry)
    },
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    textFiles
  };
}

export async function buildEditableSkillArchive(params: {
  base: ParsedSkillArchive;
  skillId: string;
  displayName: string;
  version: string;
  description: string;
  skillMarkdown: string;
}): Promise<File> {
  const { base, skillId, displayName, version, description, skillMarkdown } = params;
  const inputZip = await JSZip.loadAsync(base.file);
  const nextZip = new JSZip();

  await Promise.all(
    Object.values(inputZip.files).map(async (entry) => {
      if (entry.dir) {
        return;
      }
      const relative = stripRootPath(entry.name, base.rootName);
      if (!relative || relative === "skill.json" || relative === "SKILL.md") {
        return;
      }
      nextZip.file(`${skillId}/${relative}`, await entry.async("uint8array"));
    })
  );

  nextZip.file(`${skillId}/SKILL.md`, skillMarkdown);
  nextZip.file(
    `${skillId}/skill.json`,
    JSON.stringify(
      {
        schemaVersion: 1,
        skillId,
        displayName,
        version,
        description,
        owner: base.validation.owner,
        tags: base.validation.tags,
        riskLevel: base.validation.riskLevel,
        entrypointPath: "SKILL.md"
      },
      null,
      2
    )
  );

  const archive = await nextZip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return new File([archive], `${skillId}.zip`, { type: "application/zip" });
}
