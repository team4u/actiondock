import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import YAML from "yaml";
import {
  type ActionDockManifest,
  type ActionManifestEntry,
  loadManifest,
  loadProjectConfig,
  type PlaybookDefinition,
  type ProjectConfig,
  validateManifest,
} from "@actiondock/core";
import { PlannerError } from "./errors";
import type {
  ActionDependency,
  AssetDependency,
  BuildPlan,
  BuildPlanDependencies,
  BuildPlannerOptions,
  ExternalDependency,
  PlaybookPlanEntry,
} from "./types";

/**
 * 递归扫描指定目录下的文件，返回绝对路径列表。
 */
function walkDirectory(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...walkDirectory(fullPath));
    } else if (stat.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * 纯文本解析 Playbook Markdown 文件，提取 YAML Frontmatter，不执行任何业务代码。
 */
function parsePlaybookFile(filePath: string): PlaybookPlanEntry | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (match) {
      const parsed = YAML.parse(match[1]) || {};
      const id = parsed.id || basename(filePath, ".md");
      return {
        id,
        filePath,
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
        description: parsed.description,
      };
    }
    return {
      id: basename(filePath, ".md"),
      filePath,
      actions: [],
    };
  } catch {
    return null;
  }
}

/**
 * 静态加载项目目录下的 Playbook 列表。
 */
function loadProjectPlaybooks(projectRoot: string, playbooksDir = "playbooks"): Map<string, PlaybookPlanEntry> {
  const map = new Map<string, PlaybookPlanEntry>();
  const dir = join(projectRoot, playbooksDir);
  if (!existsSync(dir)) return map;

  const files = walkDirectory(dir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const pb = parsePlaybookFile(file);
    if (pb) {
      map.set(pb.id, pb);
    }
  }
  return map;
}

/**
 * 静态扫描 actions 目录生成备用清单，杜绝动态 import 与代码执行。
 */
function generateStaticManifest(projectRoot: string, actionsDir = "actions"): ActionDockManifest {
  const dir = join(projectRoot, actionsDir);
  const actions: Record<string, ActionManifestEntry> = {};

  if (existsSync(dir)) {
    const files = walkDirectory(dir).filter(
      (f) =>
        (f.endsWith(".ts") || f.endsWith(".js")) &&
        !f.endsWith(".d.ts") &&
        !f.endsWith(".test.ts") &&
        !f.endsWith(".spec.ts")
    );

    for (const file of files) {
      const relPath = relative(projectRoot, file);
      const filename = basename(file);
      const actionId = filename.replace(/\.(ts|js)$/, "");

      // 静态正则提取 id 与 uses，不执行模块代码
      let parsedId = actionId;
      const uses: string[] = [];
      try {
        const source = readFileSync(file, "utf-8");
        const idMatch = source.match(/id\s*:\s*["'`]([^"'`]+)["'`]/);
        if (idMatch && idMatch[1]) {
          parsedId = idMatch[1];
        }
        const usesMatch = source.match(/uses\s*:\s*\[([^\]]*)\]/);
        if (usesMatch && usesMatch[1]) {
          const rawItems = usesMatch[1].split(",");
          for (const raw of rawItems) {
            const clean = raw.trim().replace(/^["'`]|["'`]$/g, "");
            if (clean) {
              uses.push(clean);
            }
          }
        }
      } catch {
        // 忽略文件读取异常
      }

      actions[parsedId] = {
        entry: relPath,
        description: `Action ${parsedId}`,
        uses,
      };
    }
  }

  return {
    schemaVersion: 1,
    actions,
  };
}

/**
 * 收集项目根目录 package.json 中声明的外部 npm 依赖。
 */
function extractExternalDependencies(projectRoot: string): ExternalDependency[] {
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return [];

  try {
    const raw = readFileSync(pkgPath, "utf-8");
    const parsed = JSON.parse(raw);
    const deps: ExternalDependency[] = [];

    if (parsed.dependencies && typeof parsed.dependencies === "object") {
      for (const [name, versionRange] of Object.entries(parsed.dependencies)) {
        deps.push({
          name,
          versionRange: String(versionRange),
          isDev: false,
        });
      }
    }

    if (parsed.devDependencies && typeof parsed.devDependencies === "object") {
      for (const [name, versionRange] of Object.entries(parsed.devDependencies)) {
        deps.push({
          name,
          versionRange: String(versionRange),
          isDev: true,
        });
      }
    }

    return deps;
  } catch {
    return [];
  }
}

/**
 * 构建规划器。
 * 纯声明式解析 actiondock.manifest.json 与配置，绝不执行 Action 业务代码。
 */
export class BuildPlanner {
  private projectRoot: string;

  constructor(options?: { projectRoot?: string }) {
    this.projectRoot = resolve(options?.projectRoot || process.cwd());
  }

  /**
   * 执行依赖闭包裁剪与构建规划。
   * 
   * @param options 规划参数
   * @returns 完整的 BuildPlan 结构
   */
  public plan(options?: BuildPlannerOptions): BuildPlan {
    const root = resolve(options?.projectRoot || this.projectRoot);

    // 1. 获取项目配置（优先使用传入对象，缺失则读取 actiondock.json）
    let config = options?.config;
    if (!config) {
      try {
        config = loadProjectConfig(root);
      } catch (err: any) {
        throw new PlannerError(
          `Failed to load project config: ${err.message}`,
          "CONFIG_LOAD_ERROR"
        );
      }
    }

    // 2. 获取声明式清单（优先使用传入清单，缺失则读取 actiondock.manifest.json，未提供则采用安全静态扫描回退）
    let manifest = options?.manifest;
    if (!manifest) {
      const loaded = loadManifest(root);
      if (loaded) {
        manifest = loaded;
      } else {
        manifest = generateStaticManifest(root, config.actionsDir || "actions");
      }
    }

    const validation = validateManifest(manifest);
    if (!validation.valid) {
      throw new PlannerError(
        `Invalid actiondock.manifest.json: ${(validation.errors || []).join("; ")}`,
        "INVALID_MANIFEST"
      );
    }

    // 3. 静态读取 Playbook 规程定义
    const playbooksMap = loadProjectPlaybooks(root, config.playbooksDir || "playbooks");

    // 4. 计算初始 Action 与 Playbook 集合
    const initialActionIds = new Set<string>();
    let selectedPlaybooks: PlaybookPlanEntry[] = [];

    // 若指定了 Playbook 列表，进行过滤并提取关联 Action
    if (options?.playbooks && options.playbooks.length > 0) {
      for (const pbId of options.playbooks) {
        const pb = playbooksMap.get(pbId);
        if (!pb) {
          throw new PlannerError(
            `Playbook '${pbId}' specified in build options was not found in project`,
            "PLAYBOOK_NOT_FOUND"
          );
        }
        selectedPlaybooks.push(pb);
        if (pb.actions && pb.actions.length > 0) {
          for (const act of pb.actions) {
            initialActionIds.add(act);
          }
        }
      }
    } else {
      selectedPlaybooks = Array.from(playbooksMap.values());
    }

    // 若显式指定了 Action 列表，加入集合
    if (options?.actions && options.actions.length > 0) {
      for (const actId of options.actions) {
        if (!manifest.actions[actId]) {
          throw new PlannerError(
            `Action '${actId}' specified in build options was not found in manifest`,
            "ACTION_NOT_FOUND"
          );
        }
        initialActionIds.add(actId);
      }
    }

    // 若均未显式指定，默认打包清单中的全部 Action
    if ((!options?.actions || options.actions.length === 0) && (!options?.playbooks || options.playbooks.length === 0)) {
      for (const actId of Object.keys(manifest.actions)) {
        initialActionIds.add(actId);
      }
    }

    // 5. 进行依赖闭包（uses）解析计算，自动处理环形依赖与传递依赖
    const resolvedActionIds = new Set<string>();
    const queue = Array.from(initialActionIds);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (resolvedActionIds.has(currentId)) {
        continue;
      }

      const entry = manifest.actions[currentId];
      if (!entry) {
        throw new PlannerError(
          `Action '${currentId}' referenced in dependency closure (uses) was not found in manifest`,
          "MISSING_DEPENDENCY"
        );
      }

      resolvedActionIds.add(currentId);

      if (entry.uses && Array.isArray(entry.uses)) {
        for (const depId of entry.uses) {
          if (!resolvedActionIds.has(depId)) {
            queue.push(depId);
          }
        }
      }
    }

    // 6. 若指定了 Action 但未指定 Playbook，反向裁剪排除无法满足依赖的 Playbook
    if (options?.actions && options.actions.length > 0 && (!options.playbooks || options.playbooks.length === 0)) {
      selectedPlaybooks = selectedPlaybooks.filter((pb) => {
        if (!pb.actions || pb.actions.length === 0) return true;
        return pb.actions.every((a) => resolvedActionIds.has(a));
      });
    }

    // 7. 构造 Action 依赖结构
    const actionDependencies: ActionDependency[] = [];
    for (const actId of resolvedActionIds) {
      const entry = manifest.actions[actId];
      const resolvedPath = resolve(root, entry.entry);
      if (!existsSync(resolvedPath)) {
        throw new PlannerError(
          `Action '${actId}' entry file not found on disk: ${entry.entry}`,
          "ENTRY_FILE_NOT_FOUND"
        );
      }
      actionDependencies.push({
        id: actId,
        entry: entry.entry,
        resolvedPath,
        uses: entry.uses || [],
        description: entry.description,
        inputSchema: entry.inputSchema,
        outputSchema: entry.outputSchema,
        tags: entry.tags,
        annotations: entry.annotations,
      });
    }

    // 8. 构造模块与资产依赖结构
    const modulesAndAssets: AssetDependency[] = [];
    const assetPathSet = new Set<string>();

    // 清单声明资产
    if (manifest.assets && Array.isArray(manifest.assets)) {
      for (const assetRel of manifest.assets) {
        if (!assetPathSet.has(assetRel)) {
          assetPathSet.add(assetRel);
          modulesAndAssets.push({
            path: assetRel,
            resolvedPath: resolve(root, assetRel),
            type: "asset",
          });
        }
      }
    }

    // 默认 assets 目录资产扫描
    const defaultAssetsDir = join(root, "assets");
    if (existsSync(defaultAssetsDir)) {
      const assetFiles = walkDirectory(defaultAssetsDir);
      for (const file of assetFiles) {
        const rel = relative(root, file);
        if (!assetPathSet.has(rel)) {
          assetPathSet.add(rel);
          modulesAndAssets.push({
            path: rel,
            resolvedPath: file,
            type: "asset",
          });
        }
      }
    }

    // Playbook 规程文档依赖
    for (const pb of selectedPlaybooks) {
      const rel = relative(root, pb.filePath);
      modulesAndAssets.push({
        path: rel,
        resolvedPath: pb.filePath,
        type: "playbook",
      });
    }

    // 项目核心配置文件
    const configPath = join(root, "actiondock.json");
    if (existsSync(configPath)) {
      modulesAndAssets.push({
        path: "actiondock.json",
        resolvedPath: configPath,
        type: "config",
      });
    }

    const manifestPath = join(root, "actiondock.manifest.json");
    if (existsSync(manifestPath)) {
      modulesAndAssets.push({
        path: "actiondock.manifest.json",
        resolvedPath: manifestPath,
        type: "config",
      });
    }

    // 9. 外部 npm 依赖解析
    const externalDependencies = extractExternalDependencies(root);

    // 10. 生成最终 BuildPlan
    const dependencies: BuildPlanDependencies = {
      actions: actionDependencies,
      modulesAndAssets,
      external: externalDependencies,
    };

    return {
      packageId: config.id,
      packageName: config.name || config.id,
      version: config.version || "0.1.0",
      description: config.description,
      projectRoot: root,
      actions: actionDependencies,
      playbooks: selectedPlaybooks,
      dependencies,
      assets: Array.from(assetPathSet),
      configDefs: config.config,
      metadata: {
        plannedAt: new Date().toISOString(),
        schemaVersion: 1,
        actionCount: actionDependencies.length,
        playbookCount: selectedPlaybooks.length,
      },
    };
  }

  /**
   * 静态辅助调用方法。
   */
  public static plan(options: BuildPlannerOptions): BuildPlan {
    const planner = new BuildPlanner({ projectRoot: options.projectRoot });
    return planner.plan(options);
  }
}

/**
 * 快捷构建规划函数。
 */
export function buildPlan(options: BuildPlannerOptions): BuildPlan {
  return BuildPlanner.plan(options);
}
