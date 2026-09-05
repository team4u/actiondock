import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import YAML from "yaml";
import type { ActionDefinition } from "@actiondock/sdk";
import type { PlaybookDefinition, PlaybookFrontmatter, ProjectConfig } from "./types";

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
    if (!parsed.id || typeof parsed.id !== "string") {
      throw new Error("actiondock.json missing required 'id' field");
    }
    if (!parsed.name || typeof parsed.name !== "string") {
      parsed.name = parsed.id;
    }
    if (!parsed.version || typeof parsed.version !== "string") {
      parsed.version = "0.1.0";
    }
    parsed.actionsDir = parsed.actionsDir || "actions";
    parsed.playbooksDir = parsed.playbooksDir || "playbooks";
    return parsed as ProjectConfig;
  } catch (err: any) {
    throw new Error(`Failed to parse actiondock.json: ${err.message}`);
  }
}

/**
 * 探测宿主系统中可用的包管理工具（优先级：pnpm > npm > yarn > bun）。
 */
function getInstallCommand(): string[] {
  const candidates: [string, string][] = [
    ["pnpm", "install"],
    ["npm", "install"],
    ["yarn", "install"],
    ["bun", "install"],
  ];
  for (const [pm, action] of candidates) {
    try {
      const check = spawnSync(pm, ["--version"], {
        stdio: "pipe",
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
 * 确保项目依赖（node_modules）已正确安装。
 * 若尚未安装或加载失败时，自动触发包管理器执行依赖安装。
 * 
 * @param projectRoot 项目根目录
 * @param force 是否强制重新安装
 * @returns 是否成功执行了安装
 */
export function ensureProjectDependencies(projectRoot: string, force = false): boolean {
  if (process.env.ACTIONDOCK_AUTO_INSTALL === "false") {
    return false;
  }
  const pkgJsonPath = join(projectRoot, "package.json");
  if (!existsSync(pkgJsonPath)) {
    return false;
  }

  const nodeModulesPath = join(projectRoot, "node_modules");
  if (!force && existsSync(nodeModulesPath)) {
    return false;
  }

  try {
    const raw = readFileSync(pkgJsonPath, "utf-8");
    const pkg = JSON.parse(raw);
    const hasDeps =
      (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) ||
      (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0);

    if (!hasDeps && !force) {
      return false;
    }

    const installCmd = getInstallCommand();
    process.stderr.write(
      `[actiondock] Installing dependencies using ${installCmd[0]} for '${pkg.name || basename(projectRoot)}'...\n`
    );

    const proc = spawnSync(installCmd[0], installCmd.slice(1), {
      cwd: projectRoot,
      stdio: "pipe",
    });

    if (proc.status !== 0) {
      const errText = proc.stderr?.toString() || `Unknown error during ${installCmd[0]} install`;
      process.stderr.write(`[actiondock] Warning: Dependency installation failed: ${errText}\n`);
      return false;
    }

    process.stderr.write(`[actiondock] Dependencies installed successfully.\n`);
    return true;
  } catch (err: any) {
    process.stderr.write(`[actiondock] Warning: Failed to run auto-install: ${err.message}\n`);
    return false;
  }
}

/**
 * 递归扫描指定目录下的特定后缀文件（自动排除测试文件 *.test.ts, *.spec.ts 和 *.d.ts）。
 */
function scanFiles(dir: string, extension: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];

  function walk(current: string) {
    const entries = readdirSync(current);
    for (const entry of entries) {
      const fullPath = join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile() && fullPath.endsWith(extension)) {
        // 排除测试与类型声明文件
        if (
          !fullPath.endsWith(".test.ts") &&
          !fullPath.endsWith(".spec.ts") &&
          !fullPath.endsWith(".d.ts")
        ) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return results;
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
 * 
 * @param projectRoot 项目根目录
 * @param actionsDir actions 子目录（默认 "actions"）
 * @param options 控制是否允许自动安装依赖等选项
 * @returns Map<ActionId, ActionDefinition> 映射
 */
export async function loadActions(
  projectRoot: string,
  actionsDir = "actions",
  options: { autoInstall?: boolean } = { autoInstall: true }
): Promise<Map<string, ActionDefinition>> {
  if (options.autoInstall !== false) {
    ensureProjectDependencies(projectRoot);
  }

  const files = discoverActionFiles(projectRoot, actionsDir);
  const actions = new Map<string, ActionDefinition>();

  for (const file of files) {
    try {
      // 动态导入，若缺失模块则自动触发依赖重装与二次重试
      let imported: any;
      try {
        imported = await import(file);
      } catch (err: any) {
        const msg = String(err.message || "");
        if (
          options.autoInstall !== false &&
          (msg.includes("Cannot find package") ||
            msg.includes("Cannot find module") ||
            msg.includes("ERR_MODULE_NOT_FOUND") ||
            msg.includes("Could not resolve"))
        ) {
          const installed = ensureProjectDependencies(projectRoot, true);
          if (installed) {
            imported = await import(file);
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      const action = imported.default || imported.action;
      if (action && typeof action === "object" && typeof action.id === "string") {
        if (actions.has(action.id)) {
          throw new Error(
            `Duplicate action ID '${action.id}' found in ${file} (previously loaded)`
          );
        }
        actions.set(action.id, action);
      } else {
        console.warn(
          `[WARN] File ${file} does not export a valid default ActionDefinition`
        );
      }
    } catch (err: any) {
      throw new Error(`Failed to load action from ${file}: ${err.message}`);
    }
  }

  return actions;
}

/**
 * Action 文件映射条目，包含 Action ID、源文件绝对路径与 Action 定义对象。
 */
export interface ActionFileEntry {
  id: string;
  filePath: string;
  action: ActionDefinition;
}

/**
 * 加载并建立 Action ID 与其物理源码文件路径之间的映射关系（供构建打包器使用）。
 */
export async function loadActionFileMap(
  projectRoot: string,
  actionsDir = "actions"
): Promise<Map<string, ActionFileEntry>> {
  const files = discoverActionFiles(projectRoot, actionsDir);
  const map = new Map<string, ActionFileEntry>();

  for (const file of files) {
    try {
      const imported = await import(file);
      const act = imported.default || imported.action;
      if (act && typeof act === "object" && typeof act.id === "string") {
        map.set(act.id, {
          id: act.id,
          filePath: resolve(file),
          action: act,
        });
      }
    } catch {
      // 忽略非 Action 导出的辅助模块
    }
  }

  return map;
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
 * 解析单个 Playbook Markdown 文件的内容与 YAML Frontmatter 头部元数据。
 * 
 * @param content 文件文本内容
 * @param filePath 物理文件路径
 * @returns PlaybookDefinition 对象
 */
export function parsePlaybookContent(
  content: string,
  filePath: string
): PlaybookDefinition {
  let frontmatter: Partial<PlaybookFrontmatter> = {};
  let body = content;

  // 正则提取以 --- 包裹的 YAML Frontmatter
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (match) {
    try {
      frontmatter = YAML.parse(match[1]) || {};
      body = match[2];
    } catch (err: any) {
      console.warn(`[WARN] Failed to parse frontmatter in ${filePath}: ${err.message}`);
    }
  }

  const filename = filePath.split("/").pop() || "unknown";
  const defaultId = filename.replace(/\.md$/, "");

  return {
    id: frontmatter.id || defaultId,
    description: frontmatter.description,
    actions: Array.isArray(frontmatter.actions) ? frontmatter.actions : [],
    content: body.trim(),
    filePath,
  };
}

/**
 * 加载项目 playbooks 目录下的所有 Playbook SOP 文档。
 * 
 * @param projectRoot 项目根目录
 * @param playbooksDir playbooks 子目录（默认 "playbooks"）
 * @returns Map<PlaybookId, PlaybookDefinition> 映射
 */
export function loadPlaybooks(
  projectRoot: string,
  playbooksDir = "playbooks"
): Map<string, PlaybookDefinition> {
  const files = discoverPlaybookFiles(projectRoot, playbooksDir);
  const playbooks = new Map<string, PlaybookDefinition>();

  for (const file of files) {
    try {
      const content = readFileSync(file, "utf-8");
      const playbook = parsePlaybookContent(content, file);
      if (playbooks.has(playbook.id)) {
        throw new Error(
          `Duplicate playbook ID '${playbook.id}' found in ${file}`
        );
      }
      playbooks.set(playbook.id, playbook);
    } catch (err: any) {
      throw new Error(`Failed to load playbook from ${file}: ${err.message}`);
    }
  }

  return playbooks;
}
