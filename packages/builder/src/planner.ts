import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  assertPathWithinRoot,
  type ActionDockManifest,
  type ActionManifestEntry,
  loadManifest,
  loadProjectConfig,
  type ProjectConfig,
  resolveActionProjectSync,
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
  LockfileInfo,
  PlaybookPlanEntry,
  SelectionPlan,
  SelectionPlannerOptions,
} from "./types";

/**
 * 递归扫描指定目录下的文件，返回绝对路径列表。
 * 通过安全路径边界能力校验，阻止越界并避免符号链接逃逸。
 */
function walkDirectory(dir: string, rootDir: string = dir, visited = new Set<string>()): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (rootDir) {
      try {
        assertPathWithinRoot(rootDir, fullPath, "planner path");
      } catch {
        continue;
      }
    }
    let real: string;
    try {
      real = existsSync(fullPath) ? realpathSync(fullPath) : fullPath;
    } catch {
      continue;
    }
    if (rootDir) {
      try {
        assertPathWithinRoot(rootDir, real, "planner path");
      } catch {
        // 忽略并跳过指向项目根目录外部的软链接
        continue;
      }
    }
    if (visited.has(real)) {
      continue;
    }
    visited.add(real);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...walkDirectory(fullPath, rootDir, visited));
      } else if (stat.isFile()) {
        results.push(fullPath);
      }
    } catch {
      // 忽略无法访问或损坏的文件/符号链接
      continue;
    }
  }
  return results;
}

/**
 * 忽略的文件模式判断（排除测试文件、类型声明文件以及构建/版本控制等私有目录）。
 */
function isIgnoredPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  return (
    normalized.startsWith("node_modules/") ||
    normalized.includes("/node_modules/") ||
    normalized.startsWith(".git/") ||
    normalized.startsWith("dist/") ||
    normalized.startsWith(".actiondock/") ||
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".test.js") ||
    normalized.endsWith(".test.tsx") ||
    normalized.endsWith(".test.jsx") ||
    normalized.endsWith(".spec.ts") ||
    normalized.endsWith(".spec.js") ||
    normalized.endsWith(".spec.tsx") ||
    normalized.endsWith(".spec.jsx") ||
    normalized.endsWith(".d.ts")
  );
}

/**
 * 支持的包管理器锁文件候选列表。
 */
const KNOWN_LOCKFILES = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "bun.lockb",
  "bun.lock",
  "pnpm-lock.yaml",
  "yarn.lock",
];

/**
 * 读取并计算项目锁文件元数据及 SHA-256 摘要。
 */
function computeLockfileInfo(projectRoot: string, preferredLockfile?: string): LockfileInfo | undefined {
  if (preferredLockfile) {
    const lockPath = resolve(projectRoot, preferredLockfile);
    assertPathWithinRoot(projectRoot, lockPath, "lockfile");
    if (existsSync(lockPath) && statSync(lockPath).isFile()) {
      const content = readFileSync(lockPath);
      const sha256 = createHash("sha256").update(content).digest("hex");
      return {
        name: basename(lockPath),
        path: lockPath,
        sha256,
      };
    }
    throw new PlannerError(
      `Specified lockfile not found on disk: ${preferredLockfile}`,
      "LOCKFILE_NOT_FOUND"
    );
  }

  for (const lockFileName of KNOWN_LOCKFILES) {
    const lockPath = join(projectRoot, lockFileName);
    if (existsSync(lockPath)) {
      try {
        if (statSync(lockPath).isFile()) {
          const content = readFileSync(lockPath);
          const sha256 = createHash("sha256").update(content).digest("hex");
          return {
            name: lockFileName,
            path: lockPath,
            sha256,
          };
        }
      } catch {
        continue;
      }
    }
  }

  return undefined;
}

/**
 * 纯 TypeScript 解析轻量 Frontmatter 元数据，杜绝第三方 yaml 依赖。
 */
function parseSimpleFrontmatter(raw: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = raw.split(/\r?\n/);
  let currentListKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("- ") && currentListKey) {
      const item = trimmed.slice(2).trim().replace(/^["']|["']$/g, "");
      if (!Array.isArray(result[currentListKey])) {
        result[currentListKey] = [];
      }
      result[currentListKey].push(item);
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (value === "") {
        currentListKey = key;
        result[key] = [];
      } else {
        currentListKey = null;
        result[key] = value;
      }
    }
  }

  return result;
}

/**
 * 纯文本解析 Playbook Markdown 文件，提取轻量 Frontmatter，不执行任何业务代码。
 */
function parsePlaybookFile(filePath: string): PlaybookPlanEntry | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (match) {
      const parsed = parseSimpleFrontmatter(match[1]);
      const id = parsed.id || basename(filePath.replace(/\\/g, "/"), ".md");
      return {
        id,
        filePath,
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
        description: parsed.description,
      };
    }
    return {
      id: basename(filePath.replace(/\\/g, "/"), ".md"),
      filePath,
      actions: [],
    };
  } catch {
    return null;
  }
}

/**
 * 静态加载项目目录下的 Playbook 列表并合并 actiondock.json 声明。
 */
function loadProjectPlaybooks(
  projectRoot: string,
  playbooksDir = "playbooks",
  config?: ProjectConfig,
  manifest?: ActionDockManifest
): Map<string, PlaybookPlanEntry> {
  const map = new Map<string, PlaybookPlanEntry>();
  const dir = join(projectRoot, playbooksDir);
  if (existsSync(dir)) {
    const files = walkDirectory(dir, projectRoot).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const pb = parsePlaybookFile(file);
      if (pb) {
        map.set(pb.id, pb);
      }
    }
  }

  // 合并 actiondock.json / manifest / config 中声明的 playbooks
  const declaredPlaybooks: Record<string, any> = {
    ...((config as any)?.playbooks || {}),
    ...((manifest as any)?.playbooks || {}),
  };

  for (const [id, rawPb] of Object.entries(declaredPlaybooks)) {
    if (typeof rawPb === "object" && rawPb !== null) {
      const existing = map.get(id);
      const filePath = rawPb.entry
        ? resolve(projectRoot, rawPb.entry)
        : existing?.filePath || join(dir, `${id}.md`);
      const actions = Array.from(
        new Set([
          ...(existing?.actions || []),
          ...(Array.isArray(rawPb.actions) ? rawPb.actions : []),
        ])
      );
      const description = rawPb.description || existing?.description;

      map.set(id, {
        id,
        filePath,
        actions,
        description,
      });
    }
  }

  return map;
}

/**
 * 构造备用清单映射，仅读取文件系统条目与配置声明，杜绝 AST 源码分析与动态代码执行。
 */
function generateFallbackManifest(
  projectRoot: string,
  actionsDir = "actions",
  config?: ProjectConfig
): ActionDockManifest {
  const dir = join(projectRoot, actionsDir);
  const actions: Record<string, ActionManifestEntry> = {};

  // 1. 若 actiondock.json 中声明了 actions 字典，读取显式声明
  const configActions = (config as any)?.actions;
  if (configActions && typeof configActions === "object") {
    for (const [id, rawEntry] of Object.entries(configActions)) {
      if (typeof rawEntry === "object" && rawEntry !== null) {
        const entry = rawEntry as Partial<ActionManifestEntry>;
        actions[id] = {
          entry: entry.entry || join(actionsDir, `${id}.ts`).replace(/\\/g, "/"),
          description: entry.description || `Action ${id}`,
          uses: Array.isArray(entry.uses) ? entry.uses : [],
          inputSchema: entry.inputSchema,
          outputSchema: entry.outputSchema,
          tags: entry.tags,
          annotations: entry.annotations,
        };
      }
    }
  }

  // 2. 若 actions 目录存在，基于文件名建立默认映射
  if (existsSync(dir)) {
    const files = walkDirectory(dir, projectRoot).filter(
      (f) =>
        (f.endsWith(".ts") || f.endsWith(".js")) &&
        !f.endsWith(".d.ts") &&
        !f.endsWith(".test.ts") &&
        !f.endsWith(".spec.ts")
    );

    for (const file of files) {
      const relPath = relative(projectRoot, file).replace(/\\/g, "/");
      const filename = basename(file);
      const actionId = filename.replace(/\.(ts|js)$/, "");
      if (!actions[actionId]) {
        actions[actionId] = {
          entry: relPath,
          description: `Action ${actionId}`,
          uses: [],
        };
      }
    }
  }

  return {
    schemaVersion: 2,
    id: config?.id || basename(projectRoot),
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
 * 声明式选择集与构建规划器 (SelectionPlanner)。
 * 仅读取 actiondock.json、锁文件与显式构建参数，彻底移除 TypeScript AST 源码扫描。
 */
export class SelectionPlanner {
  private projectRoot: string;

  constructor(options?: { projectRoot?: string }) {
    this.projectRoot = resolve(options?.projectRoot || process.cwd());
  }

  /**
   * 执行依赖闭包裁剪与构建规划。
   *
   * @param options 规划参数
   * @returns 完整的 SelectionPlan / BuildPlan 结构
   */
  public plan(options?: SelectionPlannerOptions): SelectionPlan {
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

    // 2. 获取声明式清单（优先使用传入清单，缺失则读取 actiondock.json，未提供则采用安全备用清单）
    let manifest = options?.manifest;
    if (!manifest) {
      const loaded = loadManifest(root);
      if (loaded) {
        manifest = loaded;
      } else {
        manifest = generateFallbackManifest(root, config.actionsDir || "actions", config);
      }
    }

    const validation = validateManifest(manifest, { projectRoot: root });
    if (!validation.valid) {
      throw new PlannerError(
        `Invalid actiondock.json: ${(validation.errors || []).join("; ")}`,
        "INVALID_MANIFEST"
      );
    }

    // 3. 静态读取 Playbook 规程定义
    const playbooksMap = loadProjectPlaybooks(
      root,
      config.playbooksDir || "playbooks",
      config,
      manifest
    );

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

    const manifestActions: Record<string, ActionManifestEntry> = manifest.actions || {};

    // 若显式指定了 Action 列表，加入集合
    if (options?.actions && options.actions.length > 0) {
      for (const actId of options.actions) {
        if (!manifestActions[actId]) {
          throw new PlannerError(
            `Action '${actId}' specified in build options was not found in manifest`,
            "ACTION_NOT_FOUND"
          );
        }
        initialActionIds.add(actId);
      }
    }

    // 若均未显式指定，默认包含清单中的全部 Action
    if ((!options?.actions || options.actions.length === 0) && (!options?.playbooks || options.playbooks.length === 0)) {
      for (const actId of Object.keys(manifestActions)) {
        initialActionIds.add(actId);
      }
    }

    // 当前包在 actiondock.json 中声明的顶层 uses 直接依赖
    const currentPkgUses = (config as any)?.uses;
    if (Array.isArray(currentPkgUses)) {
      for (const depId of currentPkgUses) {
        if (typeof depId === "string" && depId.trim()) {
          initialActionIds.add(depId.trim());
        }
      }
    }

    // 5. 进行依赖闭包（uses）解析计算，自动处理环形依赖与传递依赖（支持当前清单与已链接外部包）
    const resolvedActionIds = new Set<string>();
    const queue = Array.from(initialActionIds);
    const externalActionRoots = new Map<string, string>();
    const externalActionEntries = new Map<string, ActionManifestEntry>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (resolvedActionIds.has(currentId)) {
        continue;
      }

      let entry = manifestActions[currentId] || (config as any)?.actions?.[currentId];
      let entryRoot = root;

      if (!entry) {
        try {
          const resolvedExternal = resolveActionProjectSync(currentId, root);
          if (resolvedExternal && existsSync(resolvedExternal.projectRoot)) {
            const extRoot = resolvedExternal.projectRoot;
            let extConfig: ProjectConfig;
            try {
              extConfig = loadProjectConfig(extRoot);
            } catch {
              extConfig = {
                id: resolvedExternal.packageId,
                name: resolvedExternal.packageId,
                version: "0.1.0",
              };
            }
            const externalManifest = loadManifest(extRoot);
            let externalEntry =
              externalManifest?.actions?.[resolvedExternal.actionId] ||
              (extConfig as any)?.actions?.[resolvedExternal.actionId];
            if (!externalEntry) {
              const staticManifest = generateFallbackManifest(
                extRoot,
                extConfig.actionsDir || "actions",
                extConfig
              );
              externalEntry = staticManifest.actions?.[resolvedExternal.actionId];
            }
            if (externalEntry) {
              entry = externalEntry;
              entryRoot = extRoot;

              // 依赖包 actiondock.json 中声明的传递依赖闭包
              const extPkgUses = (extConfig as any)?.uses;
              if (Array.isArray(extPkgUses)) {
                for (const u of extPkgUses) {
                  if (typeof u === "string" && u.trim() && !resolvedActionIds.has(u.trim())) {
                    queue.push(u.trim());
                  }
                }
              }
            }
          }
        } catch {
          // 忽略
        }
      }

      if (!entry) {
        throw new PlannerError(
          `Action '${currentId}' referenced in dependency closure (uses) was not found in manifest or linked packages`,
          "MISSING_DEPENDENCY"
        );
      }

      if (entryRoot !== root) {
        externalActionRoots.set(currentId, entryRoot);
        externalActionEntries.set(currentId, entry);
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
      const entry = manifestActions[actId] || externalActionEntries.get(actId);
      const entryRoot = externalActionRoots.get(actId) || root;
      if (!entry) {
        throw new PlannerError(
          `Action '${actId}' entry not found`,
          "ENTRY_FILE_NOT_FOUND"
        );
      }
      const resolvedPath = resolve(entryRoot, entry.entry);
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

    // 8. 收集锁文件信息并执行校验
    const lockfileInfo = computeLockfileInfo(root, options?.lockfile);
    if (options?.expectedLockfileDigest) {
      if (!lockfileInfo) {
        throw new PlannerError(
          `Lockfile not found in project but expected digest was specified: ${options.expectedLockfileDigest}`,
          "LOCKFILE_NOT_FOUND"
        );
      }
      if (lockfileInfo.sha256 !== options.expectedLockfileDigest) {
        throw new PlannerError(
          `Lockfile digest mismatch: expected ${options.expectedLockfileDigest} but got ${lockfileInfo.sha256}`,
          "LOCKFILE_DIGEST_MISMATCH"
        );
      }
    }

    // 9. 构造声明式文件与资产依赖结构（仅依据显式声明，杜绝 AST 依赖扫描与未声明模块猜测）
    const modulesAndAssets: AssetDependency[] = [];
    const assetPathSet = new Set<string>();
    const filePathSet = new Set<string>();
    const actionPathSet = new Set(actionDependencies.map((a) => a.resolvedPath));

    // 收集 files 声明（来源：options.files、manifest.files、config.files）
    const declaredFiles = new Set<string>();
    if (options?.files && Array.isArray(options.files)) {
      for (const f of options.files) declaredFiles.add(f);
    }
    if ((manifest as any)?.files && Array.isArray((manifest as any).files)) {
      for (const f of (manifest as any).files) declaredFiles.add(f);
    }
    if ((config as any)?.files && Array.isArray((config as any).files)) {
      for (const f of (config as any).files) declaredFiles.add(f);
    }

    for (const declaredRel of declaredFiles) {
      const resolvedFile = resolve(root, declaredRel);
      assertPathWithinRoot(root, resolvedFile, "files");
      if (!existsSync(resolvedFile)) {
        throw new PlannerError(
          `File or directory declared in 'files' not found: ${declaredRel}`,
          "FILE_NOT_FOUND"
        );
      }
      const stat = statSync(resolvedFile);
      if (stat.isDirectory()) {
        const walked = walkDirectory(resolvedFile, root);
        for (const f of walked) {
          const rel = relative(root, f).replace(/\\/g, "/");
          if (!isIgnoredPath(rel) && !actionPathSet.has(f) && !filePathSet.has(rel)) {
            filePathSet.add(rel);
            modulesAndAssets.push({
              path: rel,
              resolvedPath: f,
              type: "module",
            });
          }
        }
      } else if (stat.isFile()) {
        const rel = relative(root, resolvedFile).replace(/\\/g, "/");
        if (!actionPathSet.has(resolvedFile) && !filePathSet.has(rel)) {
          filePathSet.add(rel);
          modulesAndAssets.push({
            path: rel,
            resolvedPath: resolvedFile,
            type: "module",
          });
        }
      }
    }

    // 收集 assets 声明（来源：options.assets、manifest.assets、config.assets）
    const declaredAssets = new Set<string>();
    if (options?.assets && Array.isArray(options.assets)) {
      for (const a of options.assets) declaredAssets.add(a);
    }
    if (manifest.assets && Array.isArray(manifest.assets)) {
      for (const a of manifest.assets) declaredAssets.add(a);
    }
    if ((config as any)?.assets && Array.isArray((config as any).assets)) {
      for (const a of (config as any).assets) declaredAssets.add(a);
    }

    for (const declaredRel of declaredAssets) {
      const resolvedAsset = resolve(root, declaredRel);
      assertPathWithinRoot(root, resolvedAsset, "assets");
      if (!existsSync(resolvedAsset)) {
        throw new PlannerError(
          `Asset declared in 'assets' not found: ${declaredRel}`,
          "ASSET_NOT_FOUND"
        );
      }
      const stat = statSync(resolvedAsset);
      if (stat.isDirectory()) {
        const walked = walkDirectory(resolvedAsset, root);
        for (const f of walked) {
          const rel = relative(root, f).replace(/\\/g, "/");
          if (!assetPathSet.has(rel)) {
            assetPathSet.add(rel);
            modulesAndAssets.push({
              path: rel,
              resolvedPath: f,
              type: "asset",
            });
          }
        }
      } else if (stat.isFile()) {
        const rel = relative(root, resolvedAsset).replace(/\\/g, "/");
        if (!assetPathSet.has(rel)) {
          assetPathSet.add(rel);
          modulesAndAssets.push({
            path: rel,
            resolvedPath: resolvedAsset,
            type: "asset",
          });
        }
      }
    }

    // 默认 assets 目录扫描
    const defaultAssetsDir = join(root, "assets");
    if (existsSync(defaultAssetsDir)) {
      const assetFiles = walkDirectory(defaultAssetsDir, root);
      for (const file of assetFiles) {
        const rel = relative(root, file).replace(/\\/g, "/");
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
      const rel = relative(root, pb.filePath).replace(/\\/g, "/");
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


    // 10. 外部 npm 依赖解析
    const externalDependencies = extractExternalDependencies(root);

    // 11. 生成最终 SelectionPlan / BuildPlan
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
      actionsDir: config.actionsDir || "actions",
      playbooksDir: config.playbooksDir || "playbooks",
      actions: actionDependencies,
      playbooks: selectedPlaybooks,
      dependencies,
      assets: Array.from(assetPathSet),
      files: Array.from(filePathSet),
      configDefs: config.config,
      lockfile: lockfileInfo,
      metadata: {
        plannedAt: new Date().toISOString(),
        schemaVersion: 1,
        actionCount: actionDependencies.length,
        playbookCount: selectedPlaybooks.length,
        lockfileDigest: lockfileInfo?.sha256,
      },
    };
  }

  /**
   * 静态辅助调用方法。
   */
  public static plan(options: SelectionPlannerOptions): SelectionPlan {
    const planner = new SelectionPlanner({ projectRoot: options.projectRoot });
    return planner.plan(options);
  }
}

/**
 * 构建规划器标准导出。
 */
export const BuildPlanner = SelectionPlanner;
export type BuildPlanner = SelectionPlanner;

/**
 * 快捷选择规划函数。
 */
export function selectionPlan(options: SelectionPlannerOptions): SelectionPlan {
  return SelectionPlanner.plan(options);
}

/**
 * 快捷构建规划函数标准导出。
 */
export const buildPlan = selectionPlan;
