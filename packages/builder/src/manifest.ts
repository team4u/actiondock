import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BuilderError } from "./errors";
import { getInternalDependencyVersion } from "./fs-utils";
import type { ActionDependency, PlaybookPlanEntry } from "./types";

/**
 * actiondock.json 清单组装与依赖协议校验的单一实现。
 * pack / build / exporter 三个模块的清单拼装与 file: 协议校验全部收敛至此，
 * 字段顺序属于产物字节级契约的一部分，严禁调整。
 */

/**
 * 构造单个 Action 的清单声明项（字段顺序为产物契约的一部分）。
 */
export function serializeManifestAction(action: ActionDependency): Record<string, unknown> {
  return {
    entry: action.entry,
    description: action.description,
    inputSchema: action.inputSchema,
    outputSchema: action.outputSchema,
    uses: action.uses,
    tags: action.tags,
    annotations: action.annotations,
  };
}

/**
 * 构造 Playbook 集合的清单字典。
 */
export function serializeManifestPlaybooks(
  playbooks: PlaybookPlanEntry[],
  playbooksDir: string
): Record<string, unknown> {
  const manifestPlaybooks: Record<string, unknown> = {};
  for (const pb of playbooks) {
    const fileName = pb.filePath.replace(/\\/g, "/").split("/").pop()!;
    manifestPlaybooks[pb.id] = {
      entry: `${playbooksDir}/${fileName}`,
      ...(pb.description ? { description: pb.description } : {}),
      ...(pb.actions && pb.actions.length > 0 ? { actions: pb.actions } : {}),
    };
  }
  return manifestPlaybooks;
}

/**
 * manifest 拼装选项。
 */
export interface SerializePlanManifestOptions {
  /** 是否包含 $schema 声明字段（npm pack 产物包含，目录型产物不包含） */
  includeSchema?: boolean;
  /** config 字段是否前置于 actions 之前（npm pack 产物的历史字段顺序） */
  configBeforeActions?: boolean;
  /** 附加 actionsDir / playbooksDir 目录字段（源码型 Skill 导出需要） */
  includeDirs?: { actionsDir?: string; playbooksDir?: string };
  /** Action 入口改写映射（npm pack 用于指向编译后的 .js/.mjs 入口） */
  actionEntryOverride?: (action: ActionDependency) => string;
  /** 是否为包含命名空间分隔符的 Action ID 附加短 ID 别名（源码型 Skill 导出需要） */
  aliasShortIds?: boolean;
  /** 是否省略空 config 键（源码型 Skill 导出保持旧版字节级行为：未声明时省略） */
  omitEmptyConfig?: boolean;
  /** 是否输出 playbooks 声明（npm pack 产物历史行为不输出，需显式关闭） */
  includePlaybooks?: boolean;
}

/**
 * 将 SelectionPlan 组装为 actiondock.json 清单对象。
 * 标准字段顺序：schemaVersion、id、name、version、description、
 * actionsDir、playbooksDir、actions、playbooks、config、files、assets。
 */
export function serializePlanManifest(
  plan: {
    packageId: string;
    packageName: string;
    version: string;
    description?: string;
    actions: ActionDependency[];
    playbooks: PlaybookPlanEntry[];
    playbooksDir?: string;
    files?: string[];
    assets?: string[];
    configDefs?: Record<string, unknown>;
  },
  options: SerializePlanManifestOptions = {}
): Record<string, unknown> {
  const manifestActions: Record<string, unknown> = {};
  for (const act of plan.actions) {
    const serialized = serializeManifestAction(act);
    if (options.actionEntryOverride) {
      serialized.entry = options.actionEntryOverride(act);
    }
    manifestActions[act.id] = serialized;
    if (options.aliasShortIds && act.id.includes("/")) {
      const shortId = act.id.slice(act.id.lastIndexOf("/") + 1);
      if (!manifestActions[shortId]) {
        manifestActions[shortId] = serialized;
      }
    }
  }

  const manifestPlaybooks = serializeManifestPlaybooks(
    plan.playbooks,
    options.includeDirs?.playbooksDir || plan.playbooksDir || "playbooks"
  );

  const manifest: Record<string, unknown> = {};
  if (options.includeSchema) {
    manifest.$schema = "https://actiondock.dev/schema/v2.json";
  }
  manifest.schemaVersion = 2;
  manifest.id = plan.packageId;
  manifest.name = plan.packageName;
  manifest.version = plan.version;
  manifest.description = plan.description;
  if (options.includeDirs?.actionsDir) {
    manifest.actionsDir = options.includeDirs.actionsDir;
  }
  if (options.includeDirs?.playbooksDir) {
    manifest.playbooksDir = options.includeDirs.playbooksDir;
  }
  manifest.actions = manifestActions;
  if (Object.keys(manifestPlaybooks).length > 0 && options.includePlaybooks !== false) {
    manifest.playbooks = manifestPlaybooks;
  }
  if (plan.configDefs) {
    manifest.config = plan.configDefs;
  } else if (!options.omitEmptyConfig) {
    manifest.config = {};
  }
  if (plan.files && plan.files.length > 0) {
    manifest.files = plan.files;
  }
  if (plan.assets && plan.assets.length > 0) {
    manifest.assets = plan.assets;
  }

  if (options.configBeforeActions) {
    // npm pack 产物的历史字段顺序：config 前置于 actions
    const ordered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(manifest)) {
      if (key === "actions") {
        ordered.config = manifest.config;
        ordered.actions = value;
        continue;
      }
      if (key === "config") {
        continue;
      }
      ordered[key] = value;
    }
    return ordered;
  }

  return manifest;
}

/**
 * 校验依赖字典中不存在 file: 本地协议声明，违规即抛出 BuilderError。
 */
export function assertNoFileProtocolDeps(
  dependencies: Record<string, unknown> | undefined,
  context: string
): void {
  if (!dependencies || typeof dependencies !== "object") return;
  for (const [depName, depVer] of Object.entries(dependencies)) {
    if (String(depVer).startsWith("file:")) {
      throw new BuilderError(
        `Unsupported file: dependency for '${depName}'. Runtime dependencies must not use file: protocol in ${context}.`
      );
    }
  }
}

/** 依赖名最后一段（scoped 包名去除命名空间前缀） */
function lastSegment(name: string): string {
  return name.split("/").pop()!;
}

/**
 * 解析 workspace: 依赖的真实版本号。
 * @actiondock/* 内部依赖直接采用内部版本规则；显式约束直接剥离前缀；
 * workspace:* 则在本地 node_modules 与 monorepo packages 目录中搜索目标包版本。
 */
export function resolveWorkspaceDepVersion(root: string, depName: string, ver: string): string {
  if (depName.startsWith("@actiondock/")) {
    return getInternalDependencyVersion();
  }

  const stripped = ver.replace(/^workspace:/, "").trim();
  if (stripped && stripped !== "*" && stripped !== "^" && stripped !== "~") {
    return stripped;
  }

  const candidates = [
    resolve(root, "node_modules", depName, "package.json"),
    resolve(root, "packages", depName, "package.json"),
    resolve(root, "packages", lastSegment(depName), "package.json"),
    resolve(root, "..", depName, "package.json"),
    resolve(root, "..", lastSegment(depName), "package.json"),
    resolve(root, "..", "packages", depName, "package.json"),
    resolve(root, "..", "packages", lastSegment(depName), "package.json"),
    resolve(root, "..", "..", "packages", depName, "package.json"),
    resolve(root, "..", "..", "packages", lastSegment(depName), "package.json"),
  ];

  for (const cand of candidates) {
    if (existsSync(cand)) {
      try {
        const pkgData = JSON.parse(readFileSync(cand, "utf-8"));
        if (pkgData.version) {
          const prefix = stripped === "~" ? "~" : "^";
          return `${prefix}${pkgData.version}`;
        }
      } catch {
        // 忽略单个依赖解析异常
      }
    }
  }

  throw new BuilderError(
    `Failed to resolve workspace dependency '${depName}' (${ver}) in '${root}'. Target package version could not be found.`
  );
}

/**
 * 读取并解析 package.json，解析失败抛出 BuilderError。
 */
export function readPackageJson(pkgJsonPath: string): Record<string, any> {
  try {
    return JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  } catch (err: any) {
    throw new BuilderError(`Invalid package.json in ${pkgJsonPath}: ${err?.message || String(err)}`);
  }
}

/**
 * 规范化导出用 package.json：导出 ./actiondock.json，设定 node 引擎约束与 ESM 类型。
 * 返回新对象，不改动传入源。
 */
export function normalizePkgExportsAndEngines(pkg: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = { ...pkg, type: "module" };

  let currentExports: Record<string, unknown> = {};
  if (typeof normalized.exports === "object" && normalized.exports !== null) {
    currentExports = { ...(normalized.exports as Record<string, unknown>) };
  } else if (typeof normalized.exports === "string") {
    currentExports["."] = normalized.exports;
  }
  currentExports["./actiondock.json"] = "./actiondock.json";
  normalized.exports = currentExports;

  const currentEngines: Record<string, string> = {
    ...(typeof normalized.engines === "object" && normalized.engines !== null
      ? (normalized.engines as Record<string, string>)
      : {}),
  };
  if (!currentEngines.node) {
    currentEngines.node = ">=24.12.0";
  }
  normalized.engines = currentEngines;

  return normalized;
}
