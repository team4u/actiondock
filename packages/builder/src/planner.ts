import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import ts from "typescript";
import YAML from "yaml";
import {
  type ActionDockManifest,
  type ActionManifestEntry,
  loadManifest,
  loadProjectConfig,
  type PlaybookDefinition,
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
 * 忽略的模块路径与文件模式判断（排除测试文件、类型声明文件以及构建/版本控制等私有目录）。
 */
function isIgnoredModulePath(relPath: string): boolean {
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
 * 采用 TypeScript 官方 AST 静态遍历解析源码文件中的所有导入说明符。
 * 覆盖 import、export ... from、动态 import() 以及 require() 调用。
 */
function extractImportsUsingAst(source: string, fileName: string): string[] {
  try {
    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true
    );
    const specifiers = new Set<string>();

    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.add(node.moduleSpecifier.text);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.add(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
          specifiers.add((node.arguments[0] as ts.StringLiteral).text);
        } else if (ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
          specifiers.add((node.arguments[0] as ts.StringLiteral).text);
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return Array.from(specifiers);
  } catch {
    // AST 解析异常时回退至正则提取
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const specifiers = new Set<string>();
    const fromRegex = /\bfrom\s*["'`]([^"'`]+)["'`]/g;
    let match: RegExpExecArray | null;
    while ((match = fromRegex.exec(stripped)) !== null) {
      specifiers.add(match[1].trim());
    }
    const importRegex = /\bimport\s*(?:\(\s*)?["'`]([^"'`]+)["'`]/g;
    while ((match = importRegex.exec(stripped)) !== null) {
      specifiers.add(match[1].trim());
    }
    const requireRegex = /\brequire\s*\(\s*["'`]([^"'`]+)["'`]/g;
    while ((match = requireRegex.exec(stripped)) !== null) {
      specifiers.add(match[1].trim());
    }
    return Array.from(specifiers);
  }
}

const CANDIDATE_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
];

/**
 * 在文件系统上探测解析相对导入说明符所对应的物理源文件。
 * 兼容 NodeNext 规范中将 .js / .mjs / .cjs 说明符解析映射到 .ts / .mts / .cts 源文件。
 */
function resolveLocalModulePath(baseDir: string, specifier: string): string | null {
  const candidate = resolve(baseDir, specifier);

  // 1. 若候选路径直接存在且为文件
  if (existsSync(candidate)) {
    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // 忽略文件属性读取异常
    }
  }

  // 2. NodeNext / ESM 规范映射：若导入说明符以 .js / .mjs / .cjs 结尾，优先尝试对应 TypeScript 源码文件
  if (candidate.endsWith(".js")) {
    const tsPath = candidate.slice(0, -3) + ".ts";
    if (existsSync(tsPath)) return tsPath;
    const tsxPath = candidate.slice(0, -3) + ".tsx";
    if (existsSync(tsxPath)) return tsxPath;
  } else if (candidate.endsWith(".mjs")) {
    const mtsPath = candidate.slice(0, -4) + ".mts";
    if (existsSync(mtsPath)) return mtsPath;
  } else if (candidate.endsWith(".cjs")) {
    const ctsPath = candidate.slice(0, -4) + ".cts";
    if (existsSync(ctsPath)) return ctsPath;
  }

  // 3. 尝试追加常见扩展名
  for (const ext of CANDIDATE_EXTENSIONS) {
    if (!ext) continue;
    const withExt = candidate + ext;
    if (existsSync(withExt)) {
      try {
        if (statSync(withExt).isFile()) {
          return withExt;
        }
      } catch {
        // 忽略
      }
    }
  }

  // 4. 若为目录，尝试 index 文件
  if (existsSync(candidate)) {
    try {
      if (statSync(candidate).isDirectory()) {
        for (const ext of [".ts", ".tsx", ".js", ".mjs", ".json"]) {
          const indexFile = join(candidate, `index${ext}`);
          if (existsSync(indexFile)) {
            return indexFile;
          }
        }
      }
    } catch {
      // 忽略
    }
  }

  return null;
}

interface TsConfigPathsInfo {
  baseUrl: string;
  paths: Record<string, string[]>;
  options: ts.CompilerOptions;
}

function loadTsConfigInfo(projectRoot: string): TsConfigPathsInfo | null {
  const tsconfigPath = join(projectRoot, "tsconfig.json");
  if (!existsSync(tsconfigPath)) return null;
  try {
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (configFile.error) return null;
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectRoot);
    return {
      baseUrl: parsed.options.baseUrl || projectRoot,
      paths: parsed.options.paths || {},
      options: parsed.options,
    };
  } catch {
    return null;
  }
}

function resolveModulePathWithAliases(
  currentFile: string,
  specifier: string,
  projectRoot: string,
  tsconfigInfo: TsConfigPathsInfo | null
): string | null {
  const dir = dirname(currentFile);

  // 1. 相对路径导入
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return resolveLocalModulePath(dir, specifier);
  }

  // 2. 若存在 tsconfig.json paths 配置，优先尝试标准 ts.resolveModuleName
  if (tsconfigInfo && Object.keys(tsconfigInfo.paths).length > 0) {
    const host: ts.ModuleResolutionHost = {
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      directoryExists: ts.sys.directoryExists,
      getCurrentDirectory: () => projectRoot,
      getDirectories: ts.sys.getDirectories,
    };
    try {
      const resolved = ts.resolveModuleName(
        specifier,
        currentFile,
        tsconfigInfo.options,
        host
      );
      if (resolved.resolvedModule && !resolved.resolvedModule.isExternalLibraryImport) {
        const found = resolve(resolved.resolvedModule.resolvedFileName);
        if (existsSync(found)) {
          return found;
        }
      }
    } catch {}

    // 手动别名模式匹配备选
    for (const [pattern, targets] of Object.entries(tsconfigInfo.paths)) {
      let matched = false;
      let star = "";
      if (pattern.endsWith("*")) {
        const prefix = pattern.slice(0, -1);
        if (specifier.startsWith(prefix)) {
          matched = true;
          star = specifier.slice(prefix.length);
        }
      } else if (pattern === specifier) {
        matched = true;
      }

      if (matched) {
        for (const target of targets) {
          const replaced = target.endsWith("*")
            ? target.slice(0, -1) + star
            : target;
          const candidate = resolve(tsconfigInfo.baseUrl, replaced);
          const resolved = resolveLocalModulePath(dirname(candidate), `./${basename(candidate)}`);
          if (resolved) {
            return resolved;
          }
        }
      }
    }
  }

  return null;
}

/**
 * 从一组入口文件出发，静态深度追踪所有相对路径与别名引用的本地源码模块闭包。
 */
function traceLocalModuleDependencies(
  entryFiles: string[],
  projectRoot: string
): string[] {
  const visited = new Set<string>();
  const modules = new Set<string>();
  const queue = [...entryFiles];
  const tsconfigInfo = loadTsConfigInfo(projectRoot);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const relToRoot = relative(projectRoot, current);
    if (relToRoot.startsWith("..") || isAbsolute(relToRoot)) {
      continue;
    }

    let content = "";
    try {
      content = readFileSync(current, "utf-8");
    } catch {
      continue;
    }

    const specifiers = extractImportsUsingAst(content, current);

    for (const spec of specifiers) {
      const resolved = resolveModulePathWithAliases(current, spec, projectRoot, tsconfigInfo);
      if (resolved) {
        const rel = relative(projectRoot, resolved);
        if (!rel.startsWith("..") && !isAbsolute(rel) && !isIgnoredModulePath(rel)) {
          modules.add(resolved);
          if (!visited.has(resolved)) {
            queue.push(resolved);
          }
        }
      }
    }
  }

  return Array.from(modules);
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

    const validation = validateManifest(manifest, { projectRoot: root });
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

      let entry = manifest.actions[currentId];
      let entryRoot = root;

      if (!entry) {
        try {
          const resolvedExternal = resolveActionProjectSync(currentId, root);
          if (resolvedExternal && existsSync(resolvedExternal.projectRoot)) {
            let externalManifest = loadManifest(resolvedExternal.projectRoot);
            let externalEntry = externalManifest?.actions?.[resolvedExternal.actionId];
            if (!externalEntry) {
              const extConfig = loadProjectConfig(resolvedExternal.projectRoot);
              const staticManifest = generateStaticManifest(
                resolvedExternal.projectRoot,
                extConfig.actionsDir || "actions"
              );
              externalEntry = staticManifest.actions[resolvedExternal.actionId];
            }
            if (externalEntry) {
              entry = externalEntry;
              entryRoot = resolvedExternal.projectRoot;
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
      const entry = manifest.actions[actId] || externalActionEntries.get(actId);
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

    // 8. 构造模块与资产依赖结构
    const modulesAndAssets: AssetDependency[] = [];
    const assetPathSet = new Set<string>();
    const modulePathSet = new Set<string>();
    const actionPathSet = new Set(actionDependencies.map((a) => a.resolvedPath));

    // 静态递归追踪 Action 源码引用的本地模块代码（如 lib/、辅助工具等）
    const rootActionsMap = new Map<string, string[]>();
    for (const act of actionDependencies) {
      const actRoot = externalActionRoots.get(act.id) || root;
      if (!rootActionsMap.has(actRoot)) {
        rootActionsMap.set(actRoot, []);
      }
      rootActionsMap.get(actRoot)!.push(act.resolvedPath);
    }

    for (const [actRoot, files] of rootActionsMap) {
      const tracedModulePaths = traceLocalModuleDependencies(files, actRoot);
      for (const modPath of tracedModulePaths) {
        if (!actionPathSet.has(modPath)) {
          const rel = relative(actRoot, modPath).replace(/\\/g, "/");
          if (!modulePathSet.has(rel) && !isIgnoredModulePath(rel)) {
            modulePathSet.add(rel);
            modulesAndAssets.push({
              path: rel,
              resolvedPath: modPath,
              type: "module",
            });
          }
        }
      }
    }

    // 若未显式过滤 Action 与 Playbook（全量构建模式），且存在根目录 lib 目录，自动全量扫描 lib 源码
    const isSelective =
      Boolean(options?.actions && options.actions.length > 0) ||
      Boolean(options?.playbooks && options.playbooks.length > 0);

    if (!isSelective) {
      const defaultLibDir = join(root, "lib");
      if (existsSync(defaultLibDir)) {
        const libFiles = walkDirectory(defaultLibDir);
        for (const file of libFiles) {
          const rel = relative(root, file).replace(/\\/g, "/");
          if (!isIgnoredModulePath(rel) && !actionPathSet.has(file) && !modulePathSet.has(rel)) {
            modulePathSet.add(rel);
            modulesAndAssets.push({
              path: rel,
              resolvedPath: file,
              type: "module",
            });
          }
        }
      }
    }

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
      actionsDir: config.actionsDir || "actions",
      playbooksDir: config.playbooksDir || "playbooks",
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
