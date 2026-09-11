import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
  assertPathWithinRoot,
  type ActionDockManifest,
  type ActionManifestEntry,
  loadManifest,
  loadPlaybooks,
  loadProjectConfig,
  type PlaybookDefinition,
  type ProjectConfig,
  resolveActionProjectSync,
  validateManifest,
} from "@actiondock/core";
import { PlannerError } from "./errors";
import { assertRelativeDependenciesIntegrity } from "./dependency-check";
import type {
  ActionDependency,
  AssetDependency,
  BuildPlanDependencies,
  ExternalDependency,
  LockfileInfo,
  PlaybookPlanEntry,
  SelectionPlan,
  SelectionPlannerOptions,
} from "./types";
import type { ProjectConfigWithDeclarations } from "./types";

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
 * 构造备用清单映射，仅读取文件系统条目与配置声明，杜绝 AST 源码分析与动态代码执行。
 */
function generateFallbackManifest(
  projectRoot: string,
  actionsDir = "actions",
  config?: ProjectConfigWithDeclarations
): ActionDockManifest {
  const dir = join(projectRoot, actionsDir);
  const actions: Record<string, ActionManifestEntry> = {};

  // 若 actiondock.json 中声明了 actions 字典，读取显式声明
  const configActions = config?.actions;
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

  // 若 actions 目录存在，基于文件名建立默认映射
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
 * 依赖闭包解析的中间产物。
 */
interface ClosureResult {
  /** 闭包内全部 Action ID（按解析顺序） */
  resolvedActionIds: Set<string>;
  /** 来自外部已链接包的 Action 根目录映射 */
  externalActionRoots: Map<string, string>;
  /** 来自外部已链接包的 Action 清单条目映射 */
  externalActionEntries: Map<string, ActionManifestEntry>;
}

/** 声明文件与资产收集的中间产物 */
interface DeclaredFilesResult {
  modulesAndAssets: AssetDependency[];
  assets: string[];
  files: string[];
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
   * 解析项目配置：优先使用传入对象，缺失则读取 actiondock.json。
   */
  private resolveConfig(root: string, options?: SelectionPlannerOptions): ProjectConfigWithDeclarations {
    if (options?.config) {
      return options.config;
    }
    try {
      return loadProjectConfig(root) as ProjectConfigWithDeclarations;
    } catch (err: any) {
      throw new PlannerError(
        `Failed to load project config: ${err.message}`,
        "CONFIG_LOAD_ERROR"
      );
    }
  }

  /**
   * 解析声明式清单：优先使用传入清单，缺失则读取 actiondock.json，仍未提供则采用安全备用清单。
   */
  private resolveManifest(
    root: string,
    config: ProjectConfigWithDeclarations,
    manifest?: ActionDockManifest
  ): ActionDockManifest {
    if (manifest) {
      return manifest;
    }
    const loaded = loadManifest(root);
    if (loaded) {
      return loaded;
    }
    return generateFallbackManifest(root, config.actionsDir || "actions", config);
  }

  /**
   * 收集 Playbook 规程定义（统一复用 core 的 loadPlaybooks，清单为唯一事实源）。
   */
  private collectPlaybooks(
    root: string,
    config: ProjectConfigWithDeclarations,
    manifest: ActionDockManifest
  ): Map<string, PlaybookPlanEntry> {
    const effectiveManifest = {
      ...(config || {}),
      ...(manifest || {}),
      playbooks: {
        ...(config?.playbooks || {}),
        ...(manifest?.playbooks || {}),
      },
    } as ActionDockManifest;

    const playbooksDefinitions = loadPlaybooks(
      root,
      config.playbooksDir || manifest?.playbooksDir || "playbooks",
      effectiveManifest
    );
    const playbooksMap = new Map<string, PlaybookPlanEntry>();
    for (const [id, def] of playbooksDefinitions.entries()) {
      playbooksMap.set(id, {
        id: def.id,
        filePath: def.filePath,
        actions: def.actions,
        description: def.description,
      });
    }
    return playbooksMap;
  }

  /**
   * 计算初始 Action 与 Playbook 集合（显式声明过滤、uses 顶层依赖与默认全集）。
   */
  private resolveInitialSelection(
    options: SelectionPlannerOptions | undefined,
    manifest: ActionDockManifest,
    config: ProjectConfigWithDeclarations,
    playbooksMap: Map<string, PlaybookPlanEntry>
  ): { initialActionIds: Set<string>; selectedPlaybooks: PlaybookPlanEntry[] } {
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

    const manifestActions = manifest.actions || {};

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
    const currentPkgUses = config?.uses;
    if (Array.isArray(currentPkgUses)) {
      for (const depId of currentPkgUses) {
        if (typeof depId === "string" && depId.trim()) {
          initialActionIds.add(depId.trim());
        }
      }
    }

    return { initialActionIds, selectedPlaybooks };
  }

  /**
   * 进行依赖闭包（uses）解析计算，自动处理环形依赖与传递依赖（支持当前清单与已链接外部包）。
   */
  private resolveClosure(
    root: string,
    manifest: ActionDockManifest,
    config: ProjectConfigWithDeclarations,
    initialActionIds: Set<string>
  ): ClosureResult {
    const resolvedActionIds = new Set<string>();
    const queue = Array.from(initialActionIds);
    const externalActionRoots = new Map<string, string>();
    const externalActionEntries = new Map<string, ActionManifestEntry>();
    const manifestActions = manifest.actions || {};

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (resolvedActionIds.has(currentId)) {
        continue;
      }

      let entry = manifestActions[currentId] || config?.actions?.[currentId];
      let entryRoot = root;

      if (!entry) {
        try {
          const resolvedExternal = resolveActionProjectSync(currentId, root);
          if (resolvedExternal && existsSync(resolvedExternal.projectRoot)) {
            const extRoot = resolvedExternal.projectRoot;
            let extConfig: ProjectConfigWithDeclarations;
            try {
              extConfig = loadProjectConfig(extRoot) as ProjectConfigWithDeclarations;
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
              extConfig?.actions?.[resolvedExternal.actionId];
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
              const extPkgUses = extConfig?.uses;
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

    return { resolvedActionIds, externalActionRoots, externalActionEntries };
  }

  /**
   * 构造 Action 依赖结构（闭包结果物化为 ActionDependency 列表）。
   */
  private buildActionDependencies(
    root: string,
    closure: ClosureResult,
    manifest: ActionDockManifest
  ): ActionDependency[] {
    const manifestActions = manifest.actions || {};
    const actionDependencies: ActionDependency[] = [];
    for (const actId of closure.resolvedActionIds) {
      const entry = manifestActions[actId] || closure.externalActionEntries.get(actId);
      const entryRoot = closure.externalActionRoots.get(actId) || root;
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
    return actionDependencies;
  }

  /**
   * 收集声明式文件与资产依赖结构（仅依据显式声明，杜绝 AST 依赖扫描与未声明模块猜测）。
   */
  private collectDeclaredFilesAndAssets(
    root: string,
    options: SelectionPlannerOptions | undefined,
    manifest: ActionDockManifest,
    config: ProjectConfigWithDeclarations,
    actionDependencies: ActionDependency[],
    selectedPlaybooks: PlaybookPlanEntry[]
  ): DeclaredFilesResult {
    const modulesAndAssets: AssetDependency[] = [];
    const assetPathSet = new Set<string>();
    const filePathSet = new Set<string>();
    const actionPathSet = new Set(actionDependencies.map((a) => a.resolvedPath));

    // 收集 files 声明（来源：options.files、manifest.files、config.files）
    const declaredFiles = new Set<string>();
    if (options?.files && Array.isArray(options.files)) {
      for (const f of options.files) declaredFiles.add(f);
    }
    if (manifest?.files && Array.isArray(manifest.files)) {
      for (const f of manifest.files) declaredFiles.add(f);
    }
    if (config?.files && Array.isArray(config.files)) {
      for (const f of config.files) declaredFiles.add(f);
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
    if (config?.assets && Array.isArray(config.assets)) {
      for (const a of config.assets) declaredAssets.add(a);
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

    return {
      modulesAndAssets,
      assets: Array.from(assetPathSet),
      files: Array.from(filePathSet),
    };
  }

  /**
   * 执行依赖闭包裁剪与构建规划。
   * 主流程仅做编排，各阶段职责由私有方法承担。
   *
   * @param options 规划参数
   * @returns 完整的 SelectionPlan / BuildPlan 结构
   */
  public plan(options?: SelectionPlannerOptions): SelectionPlan {
    const root = resolve(options?.projectRoot || this.projectRoot);

    // 解析项目配置与声明式清单
    const config = this.resolveConfig(root, options);
    const manifest = this.resolveManifest(root, config, options?.manifest);

    const validation = validateManifest(manifest, { projectRoot: root });
    if (!validation.valid) {
      throw new PlannerError(
        `Invalid actiondock.json: ${(validation.errors || []).join("; ")}`,
        "INVALID_MANIFEST"
      );
    }

    // 读取 Playbook 规程定义并计算初始选择集
    const playbooksMap = this.collectPlaybooks(root, config, manifest);
    const { initialActionIds, selectedPlaybooks } = this.resolveInitialSelection(
      options,
      manifest,
      config,
      playbooksMap
    );

    // 依赖闭包解析与 Action 依赖结构物化
    const closure = this.resolveClosure(root, manifest, config, initialActionIds);
    let finalPlaybooks = selectedPlaybooks;

    // 若指定了 Action 但未指定 Playbook，反向裁剪排除无法满足依赖的 Playbook
    if (options?.actions && options.actions.length > 0 && (!options.playbooks || options.playbooks.length === 0)) {
      finalPlaybooks = selectedPlaybooks.filter((pb) => {
        if (!pb.actions || pb.actions.length === 0) return true;
        return pb.actions.every((a) => closure.resolvedActionIds.has(a));
      });
    }

    const actionDependencies = this.buildActionDependencies(root, closure, manifest);

    // 收集锁文件信息并执行校验
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

    // 收集声明式文件与资产依赖
    const declaredFiles = this.collectDeclaredFilesAndAssets(
      root,
      options,
      manifest,
      config,
      actionDependencies,
      finalPlaybooks
    );

    // 外部 npm 依赖解析与最终规划产物组装
    const externalDependencies = extractExternalDependencies(root);

    const dependencies: BuildPlanDependencies = {
      actions: actionDependencies,
      modulesAndAssets: declaredFiles.modulesAndAssets,
      external: externalDependencies,
    };

    const planResult: SelectionPlan = {
      packageId: config.id,
      packageName: config.name || config.id,
      version: config.version || "0.1.0",
      description: config.description,
      projectRoot: root,
      actionsDir: config.actionsDir || "actions",
      playbooksDir: config.playbooksDir || "playbooks",
      actions: actionDependencies,
      playbooks: finalPlaybooks,
      dependencies,
      assets: declaredFiles.assets,
      files: declaredFiles.files,
      configDefs: config.config,
      lockfile: lockfileInfo,
      metadata: {
        plannedAt: new Date().toISOString(),
        schemaVersion: 2,
        actionCount: actionDependencies.length,
        playbookCount: finalPlaybooks.length,
        lockfileDigest: lockfileInfo?.sha256,
      },
    };

    if (!options?.skipDependencyValidation) {
      assertRelativeDependenciesIntegrity(root, planResult);
    }

    return planResult;
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
 * @deprecated SelectionPlanner 的历史别名，请直接使用 SelectionPlanner，将在两个版本后移除。
 */
export const BuildPlanner = SelectionPlanner;
/** @deprecated SelectionPlanner 类型的历史别名，请直接使用 SelectionPlanner 类型。 */
export type BuildPlanner = SelectionPlanner;

/**
 * 快捷选择规划函数。
 * @deprecated 便捷快捷函数，请直接使用 SelectionPlanner.plan，将在两个版本后移除。
 */
export function selectionPlan(options: SelectionPlannerOptions): SelectionPlan {
  return SelectionPlanner.plan(options);
}

/**
 * 快捷构建规划函数标准导出。
 * @deprecated selectionPlan 的历史别名，请改用 SelectionPlanner.plan，将在两个版本后移除。
 */
export const buildPlan = selectionPlan;
