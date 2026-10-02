import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { ActionDefinition } from "@actiondock/sdk";
import { NodeModuleLoader, type ModuleLoader, unwrapDefaultExport } from "../platform/module-loader";
import {
  ActionDockError,
  ACTION_LOAD_FAILED,
  describeActionLoadFailure,
  INVALID_ACTION_ID,
  INVALID_JSON,
  INVALID_PACKAGE_ID,
  INVALID_PLAYBOOK_ID,
  MANIFEST_LOAD_FAILED,
  PLAYBOOK_NOT_FOUND,
  PROJECT_CONFIG_NOT_FOUND,
} from "../errors";
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
    throw new ActionDockError(
      PROJECT_CONFIG_NOT_FOUND,
      `actiondock.json not found in ${projectRoot}`
    );
  }
  const content = readFileSync(configPath, "utf-8");
  try {
    const parsed = JSON.parse(content);
    const isScoped = /^@[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(parsed.id);
    if (!parsed.id || typeof parsed.id !== "string" || (!PACKAGE_ID_REGEX.test(parsed.id) && !isScoped)) {
      throw new ActionDockError(
        INVALID_PACKAGE_ID,
        `actiondock.json invalid or missing 'id': '${parsed?.id}' (must match ${PACKAGE_ID_REGEX})`
      );
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
    if (err instanceof ActionDockError) {
      throw err;
    }
    throw new ActionDockError(INVALID_JSON, `Failed to parse actiondock.json: ${err.message}`);
  }
}

export const ALLOWED_INSTALLERS = new Set(["npm", "bun"]);

/**
 * 异步探测包管理器可用性（通过执行 --version 并检查退出码）。
 *
 * 异步化取舍说明：
 * - 替换同步阻塞子进程调用，避免阻塞 Node.js 事件循环；
 * - Windows 兼容性保留：npm 在 Windows 上是 .cmd 批处理脚本，在 shell 开启下执行以避免直接调用报错；
 * - 探测命令限制于白名单内部候选，杜绝外部输入注入风险。
 */
function probePackageManager(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(command, ["--version"], {
        stdio: "pipe",
        shell: process.platform === "win32",
      });
      let settled = false;
      proc.on("error", () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      });
      proc.on("close", (code) => {
        if (!settled) {
          settled = true;
          resolve(code === 0);
        }
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * 探测宿主系统中可用的包管理工具。
 * 优先级：
 * - 环境变量 ACTIONDOCK_INSTALLER 显式指定（严格白名单校验：npm, bun）；
 * - 依据项目根目录下现存的锁文件进行精确匹配（bun.lock/bun.lockb -> bun, package-lock.json/npm-shrinkwrap.json -> npm）；
 * - 候选回退优先级异步探测（npm > bun）。
 */
export async function getInstallCommand(projectRoot?: string): Promise<string[]> {
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
    const available = await probePackageManager(pm);
    if (available) {
      return [pm, action];
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
    throw new ActionDockError(
      MANIFEST_LOAD_FAILED,
      `Failed to load manifest in ${projectRoot}: ${err.message}`
    );
  }

  // 以 actiondock.json 为唯一事实源读取 Action 的元数据契约与入口
  if (manifest?.actions && Object.keys(manifest.actions).length > 0) {
    for (const [actionId, item] of Object.entries(manifest.actions)) {
      if (!ACTION_ID_REGEX.test(actionId)) {
        throw new ActionDockError(
          INVALID_ACTION_ID,
          `Invalid action ID '${actionId}' in actiondock.json. Action IDs must match ${ACTION_ID_REGEX}`
        );
      }
      const entryPath = resolve(projectRoot, item.entry);
      assertPathWithinRoot(projectRoot, entryPath, `action entry '${item.entry}'`);
      if (!existsSync(entryPath)) {
        throw new ActionDockError(
          ACTION_LOAD_FAILED,
          `Action '${actionId}' entry file not found: ${item.entry}`,
          {
            actionId,
            entry: item.entry,
            entryPath,
            hint: `Check whether the entry configuration '${item.entry}' for action '${actionId}' in actiondock.json is correct.`,
          }
        );
      }

      let imported: any;
      try {
        imported = await loader.load(entryPath);
      } catch (err: any) {
        const failure = describeActionLoadFailure(err, {
          actionId,
          packageId: manifest?.id || basename(projectRoot),
          projectRoot,
        });
        throw new ActionDockError(
          failure.code,
          failure.message,
          {
            ...failure.details,
            entry: item.entry,
            entryPath,
          },
          undefined,
          failure.details.hint
        );
      }

      const exported = unwrapDefaultExport(imported);
      let runFn: ((input: any, ctx: any) => any) | undefined;
      if (typeof exported === "function") {
        runFn = exported;
      } else if (exported && typeof exported.run === "function") {
        runFn = exported.run.bind(exported);
      }

      if (!runFn) {
        throw new ActionDockError(
          ACTION_LOAD_FAILED,
          `Action '${actionId}' in '${item.entry}' does not export a runnable handler`,
          {
            actionId,
            entry: item.entry,
            entryPath,
            hint: `Ensure that '${item.entry}' exports a runnable handler using export default defineAction(...).`,
          }
        );
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
    throw new ActionDockError(
      INVALID_PLAYBOOK_ID,
      `Invalid playbook ID '${playbookId}' found in ${filePath}. Playbook IDs must match ${PLAYBOOK_ID_REGEX}`
    );
  }

  // 规程正文为纯 Markdown，剔除可能残存的旧式 Frontmatter 包裹块
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

  return {
    id: playbookId,
    name: metadata?.name,
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
    } catch (err: any) {
      // 容错与可观测性取舍说明：
      // - 工程无清单时 loadManifest 返回 null，按空规程集处理属正常场景；
      // - 清单文件存在但内容损坏或解析失败时，记录可观测警告后安全降级，避免静默吞没异常。
      const reason = err instanceof Error ? err.message : String(err ?? "Unknown error");
      process.stderr.write(
        `[actiondock] Warning: Failed to load manifest in ${projectRoot}: ${reason}\n`
      );
      return playbooks;
    }
  }

  // 以 actiondock.json 为唯一事实源
  if (manifest?.playbooks && Object.keys(manifest.playbooks).length > 0) {
    for (const [playbookId, pbEntry] of Object.entries(manifest.playbooks)) {
      if (!PLAYBOOK_ID_REGEX.test(playbookId)) {
        throw new ActionDockError(
          INVALID_PLAYBOOK_ID,
          `Invalid playbook ID '${playbookId}' in actiondock.json. Playbook IDs must match ${PLAYBOOK_ID_REGEX}`
        );
      }
      const fullPath = resolve(projectRoot, pbEntry.entry);
      assertPathWithinRoot(projectRoot, fullPath, `playbook entry '${pbEntry.entry}'`);
      if (!existsSync(fullPath)) {
        throw new ActionDockError(
          PLAYBOOK_NOT_FOUND,
          `Playbook file '${pbEntry.entry}' for '${playbookId}' not found in ${projectRoot}`
        );
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
