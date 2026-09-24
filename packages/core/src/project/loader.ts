import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { ActionDefinition } from "@actiondock/sdk";
import { NodeModuleLoader, type ModuleLoader, unwrapDefaultExport } from "../node/module-loader";
import { ACTION_LOAD_FAILED, isMissingModuleError } from "../errors";
import { loadManifest, ACTION_ID_REGEX, PLAYBOOK_ID_REGEX } from "./manifest";
import type {
  ActionDockManifest,
  PlaybookDefinition,
  PlaybookManifestEntry,
  ProjectConfig,
} from "./types";

/**
 * 从指定目录开始向上逐级递归查找包含 `actiondock.json` 的项目根目录。
 * 
 * @param cwd 起始搜索目录（默认为 process.cwd()）
 * @returns 项目根目录绝对路径，若未找到则返回 null
 */
export function findProjectRoot(cwd?: string): string | null {
  let current: string;
  try {
    current = resolve(cwd || process.cwd());
  } catch {
    return null;
  }
  while (true) {
    try {
      const configPath = join(current, "actiondock.json");
      if (existsSync(configPath)) {
        return current;
      }
    } catch {
      return null;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

import {
  PACKAGE_ID_REGEX,
  assertPathWithinRoot,
  assertWithinProjectRoot,
  traverseDirectory,
} from "../utils";

/**
 * 加载并校验指定目录下的 `actiondock.json` 配置文件。
 * 
 * @param projectRoot 项目根目录绝对路径
 * @returns 解析后的 ProjectConfig 对象
 * @throws {Error} 若文件不存在或 JSON 格式错误、缺失必要字段
 */
export function loadProjectConfig(projectRoot: string): ProjectConfig {
  const configPath = join(projectRoot, "actiondock.json");
  if (!existsSync(configPath)) {
    throw new Error(`actiondock.json not found in ${projectRoot}`);
  }
  const content = readFileSync(configPath, "utf-8");
  try {
    const parsed = JSON.parse(content);
    const isScoped = /^@[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(parsed.id);
    if (!parsed.id || typeof parsed.id !== "string" || (!PACKAGE_ID_REGEX.test(parsed.id) && !isScoped)) {
      throw new Error(`actiondock.json invalid or missing 'id': '${parsed?.id}' (must match ${PACKAGE_ID_REGEX})`);
    }
    if (!parsed.name || typeof parsed.name !== "string") {
      parsed.name = parsed.id;
    }
    if (!parsed.version || typeof parsed.version !== "string") {
      parsed.version = "0.1.0";
    }
    if (parsed.actionsDir) {
      assertWithinProjectRoot(projectRoot, parsed.actionsDir, "actionsDir");
    }
    if (parsed.playbooksDir) {
      assertWithinProjectRoot(projectRoot, parsed.playbooksDir, "playbooksDir");
    }

    return parsed as ProjectConfig;
  } catch (err: any) {
    throw new Error(`Failed to parse actiondock.json: ${err.message}`);
  }
}

export const ALLOWED_INSTALLERS = new Set(["npm", "bun"]);

/**
 * 探测宿主系统中可用的包管理工具。
 * 优先级：
 * - 环境变量 ACTIONDOCK_INSTALLER 显式指定（严格白名单校验：npm, bun）；
 * - 依据项目根目录下现存的锁文件进行精确匹配（bun.lock/bun.lockb -> bun, package-lock.json/npm-shrinkwrap.json -> npm）；
 * - 候选回退优先级探测（npm > bun）。
 */
export function getInstallCommand(projectRoot?: string): string[] {
  const preferred = process.env.ACTIONDOCK_INSTALLER?.trim();
  if (preferred) {
    if (ALLOWED_INSTALLERS.has(preferred)) {
      return [preferred, "install"];
    }
    process.stderr.write(
      `[actiondock] Warning: Ignored unsupported or invalid ACTIONDOCK_INSTALLER '${preferred}'. Allowed values: npm, bun.\n`
    );
  }

  if (projectRoot) {
    const lockfileMap: [string, string][] = [
      ["bun.lockb", "bun"],
      ["bun.lock", "bun"],
      ["package-lock.json", "npm"],
      ["npm-shrinkwrap.json", "npm"],
    ];
    for (const [lockFile, pm] of lockfileMap) {
      if (existsSync(join(projectRoot, lockFile))) {
        return [pm, "install"];
      }
    }
  }

  const candidates: [string, string][] = [
    ["npm", "install"],
    ["bun", "install"],
  ];
  for (const [pm, action] of candidates) {
    try {
      const check = spawnSync(pm, ["--version"], {
        stdio: "pipe",
        // Windows 兼容：npm 是 .cmd 脚本，无 shell 直接 spawn 必然 ENOENT，
        // 会导致探测误判 npm 缺失而错误回退选择 bun
        shell: process.platform === "win32",
      });
      if (check.status === 0) {
        return [pm, action];
      }
    } catch {
      // 继续探测下一个候选包管理器
    }
  }
  return ["npm", "install"];
}

/**
 * 测试与类型声明文件后缀常量（与 builder 的 isIgnoredPath 保持同一语义口径）。
 */
const TEST_FILE_SUFFIXES = [
  ".test.ts",
  ".test.js",
  ".test.tsx",
  ".test.jsx",
  ".spec.ts",
  ".spec.js",
  ".spec.tsx",
  ".spec.jsx",
  ".d.ts",
];

/**
 * 递归扫描指定目录下的特定后缀文件（自动排除测试文件与类型声明文件）。
 * 目录遍历统一复用 core utils 的 traverseDirectory 单一事实源，
 * 自带软链接越界与循环防护。
 */
function scanFiles(dir: string, extension: string): string[] {
  return traverseDirectory(dir)
    .filter(
      (entry) =>
        entry.relPath.endsWith(extension) &&
        !TEST_FILE_SUFFIXES.some((suffix) => entry.relPath.endsWith(suffix))
    )
    .map((entry) => entry.fullPath);
}

/**
 * 发现并检索项目 actions 目录下的所有 Action 源码文件（.ts）。
 * 
 * @param projectRoot 项目根目录
 * @param actionsDir actions 子目录名称（默认 "actions"）
 */
export function discoverActionFiles(
  projectRoot: string,
  actionsDir = "actions"
): string[] {
  const fullDir = join(projectRoot, actionsDir);
  return scanFiles(fullDir, ".ts");
}

/**
 * 动态导入并加载项目下的所有 Action 定义对象。
 * 以 actiondock.json 为唯一事实源读取 Action 的元数据契约（id, description, inputSchema, outputSchema, tags, annotations, uses），
 * 源码文件仅提供执行 Handler。
 * 
 * @param projectRoot 项目根目录
 * @param _actionsDir actions 子目录（向后兼容保留参数）
 * @param options 模块加载器等选项
 * @returns Map<ActionId, ActionDefinition> 映射
 */
export async function loadActions(
  projectRoot: string,
  _actionsDir = "actions",
  options: { loader?: ModuleLoader } = {}
): Promise<Map<string, ActionDefinition>> {
  const actions = new Map<string, ActionDefinition>();
  const loader = options.loader || new NodeModuleLoader();

  let manifest: ActionDockManifest | null = null;
  try {
    manifest = loadManifest(projectRoot);
  } catch (err: any) {
    throw new Error(`Failed to load manifest in ${projectRoot}: ${err.message}`);
  }

  // 以 actiondock.json 为唯一事实源读取 Action 的元数据契约与入口
  if (manifest?.actions && Object.keys(manifest.actions).length > 0) {
    for (const [actionId, item] of Object.entries(manifest.actions)) {
      if (!ACTION_ID_REGEX.test(actionId)) {
        throw new Error(
          `Invalid action ID '${actionId}' in actiondock.json. Action IDs must match ${ACTION_ID_REGEX}`
        );
      }
      const entryPath = resolve(projectRoot, item.entry);
      assertPathWithinRoot(projectRoot, entryPath, `action entry '${item.entry}'`);
      if (!existsSync(entryPath)) {
        const error: any = new Error(`Action '${actionId}' entry file not found: ${item.entry}`);
        error.code = ACTION_LOAD_FAILED;
        error.details = {
          actionId,
          entry: item.entry,
          entryPath,
          hint: `请检查 actiondock.json 中 action '${actionId}' 的 entry 配置 '${item.entry}' 是否正确。`,
        };
        throw error;
      }

      let imported: any;
      try {
        imported = await loader.load(entryPath);
      } catch (err: any) {
        // 复用 errors.ts 的模块缺失判定单一事实源，保留加载器视角的中文修复提示
        const msg = String(err.message || "");
        const error: any = new Error(
          `Failed to load action '${actionId}' from '${item.entry}': ${msg}`
        );
        error.code = ACTION_LOAD_FAILED;
        error.details = {
          actionId,
          entry: item.entry,
          entryPath,
          rootCause: msg,
          hint: isMissingModuleError(msg)
            ? `项目依赖缺失，请在 '${projectRoot}' 目录下运行 npm install 安装依赖。`
            : undefined,
        };
        throw error;
      }

      const exported = unwrapDefaultExport(imported);
      let runFn: ((input: any, ctx: any) => any) | undefined;
      if (typeof exported === "function") {
        runFn = exported;
      } else if (exported && typeof exported.run === "function") {
        runFn = exported.run.bind(exported);
      }

      if (!runFn) {
        const error: any = new Error(
          `Action '${actionId}' in '${item.entry}' does not export a runnable handler`
        );
        error.code = ACTION_LOAD_FAILED;
        error.details = {
          actionId,
          entry: item.entry,
          entryPath,
          hint: `确保 '${item.entry}' 使用 export default defineAction(...) 导出了可执行处理函数。`,
        };
        throw error;
      }

      const def: ActionDefinition = {
        run: runFn,
      };

      actions.set(actionId, def);
    }
  }

  return actions;
}

/**
 * 发现项目 playbooks 目录下的所有 Playbook Markdown 文档（.md）。
 */
export function discoverPlaybookFiles(
  projectRoot: string,
  playbooksDir = "playbooks"
): string[] {
  const fullDir = join(projectRoot, playbooksDir);
  return scanFiles(fullDir, ".md");
}

/**
 * 解析单个 Playbook Markdown 文件的内容与元数据。
 * Playbook 规程正文为纯 Markdown，其元数据（id, description, actions）直接由调用方传入（源自 actiondock.json）。
 * 
 * @param content 文件 Markdown 文本内容
 * @param filePath 物理文件路径
 * @param metadata Playbook 清单元数据
 * @returns PlaybookDefinition 对象
 */
export function parsePlaybookContent(
  content: string,
  filePath: string,
  metadata?: Partial<PlaybookManifestEntry> & { id?: string; name?: string }
): PlaybookDefinition {
  const filename = basename(filePath.replace(/\\/g, "/"));
  const defaultId = filename.replace(/\.md$/, "");

  const playbookId = metadata?.id || defaultId;
  if (!PLAYBOOK_ID_REGEX.test(playbookId)) {
    throw new Error(`Invalid playbook ID '${playbookId}' found in ${filePath}. Playbook IDs must match ${PLAYBOOK_ID_REGEX}`);
  }

  // 规程正文为纯 Markdown，剔除可能残存的旧式 Frontmatter 包裹块
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

  return {
    id: playbookId,
    name: (metadata as any)?.name,
    description: metadata?.description,
    actions: Array.isArray(metadata?.actions) ? [...metadata.actions] : [],
    content: body.trim(),
    filePath,
  };
}

/**
 * 加载项目声明的 Playbook SOP 规程文档。
 * 以 actiondock.json 中的 playbooks 声明作为唯一事实源。
 * 
 * @param projectRoot 项目根目录
 * @param _playbooksDir playbooks 子目录（向后兼容保留参数）
 * @param customManifest 可选的显式清单对象（若未提供则从磁盘加载）
 * @returns Map<PlaybookId, PlaybookDefinition> 映射
 */
export function loadPlaybooks(
  projectRoot: string,
  _playbooksDir = "playbooks",
  customManifest?: ActionDockManifest | null
): Map<string, PlaybookDefinition> {
  const playbooks = new Map<string, PlaybookDefinition>();

  let manifest: ActionDockManifest | null = null;
  if (customManifest !== undefined) {
    manifest = customManifest;
  } else {
    try {
      manifest = loadManifest(projectRoot);
    } catch {
      return playbooks;
    }
  }

  // 以 actiondock.json 为唯一事实源
  if (manifest?.playbooks && Object.keys(manifest.playbooks).length > 0) {
    for (const [playbookId, pbEntry] of Object.entries(manifest.playbooks)) {
      if (!PLAYBOOK_ID_REGEX.test(playbookId)) {
        throw new Error(
          `Invalid playbook ID '${playbookId}' in actiondock.json. Playbook IDs must match ${PLAYBOOK_ID_REGEX}`
        );
      }
      const fullPath = resolve(projectRoot, pbEntry.entry);
      assertPathWithinRoot(projectRoot, fullPath, `playbook entry '${pbEntry.entry}'`);
      if (!existsSync(fullPath)) {
        throw new Error(`Playbook file '${pbEntry.entry}' for '${playbookId}' not found in ${projectRoot}`);
      }
      const content = readFileSync(fullPath, "utf-8");
      const def = parsePlaybookContent(content, fullPath, {
        id: playbookId,
        name: (pbEntry as any)?.name,
        description: pbEntry.description,
        actions: pbEntry.actions,
      });
      playbooks.set(playbookId, def);
    }
  }

  return playbooks;
}
