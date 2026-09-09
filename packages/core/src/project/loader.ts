import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import type { ActionDefinition } from "@actiondock/sdk";
import { getModuleLoader } from "../runtime/module-loader";
import type { PlaybookDefinition, PlaybookFrontmatter, ProjectConfig } from "./types";

/**
 * 将绝对路径规范化为 ESM 动态导入可用的 file:// URL 标识符。
 * Windows 绝对路径（如 D:\a\b.ts）不是合法的 ESM 标识符，会被解析为 "d:" 协议导致
 * 加载失败；POSIX 绝对路径虽可直接导入，统一转换后跨平台行为一致。
 */
function toImportSpecifier(filePath: string): string {
  return pathToFileURL(filePath).href;
}

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
  assertValidPackageId,
} from "../utils";

export const ACTION_ID_REGEX = /^[a-zA-Z0-9_.-]+$/;
export const PLAYBOOK_ID_REGEX = /^[a-zA-Z0-9_.-]+$/;

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
    if (!parsed.id || typeof parsed.id !== "string" || !PACKAGE_ID_REGEX.test(parsed.id)) {
      throw new Error(`actiondock.json invalid or missing 'id': '${parsed?.id}' (must match ${PACKAGE_ID_REGEX})`);
    }
    if (!parsed.name || typeof parsed.name !== "string") {
      parsed.name = parsed.id;
    }
    if (!parsed.version || typeof parsed.version !== "string") {
      parsed.version = "0.1.0";
    }
    parsed.actionsDir = parsed.actionsDir || "actions";
    parsed.playbooksDir = parsed.playbooksDir || "playbooks";

    assertWithinProjectRoot(projectRoot, parsed.actionsDir, "actionsDir");
    assertWithinProjectRoot(projectRoot, parsed.playbooksDir, "playbooksDir");

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
        try {
          const check = spawnSync(pm, ["--version"], {
            stdio: "pipe",
            shell: false,
          });
          if (check.status === 0) {
            return [pm, "install"];
          }
        } catch {
          // 忽略并继续检查下一个候选
        }
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
        shell: false,
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
 * 解析 npm 风格 .npmrc 中的 strict-ssl 配置（项目级优先于用户级）。
 * 返回 undefined 表示各级配置均未声明该键。
 */
function resolveNpmStrictSsl(projectRoot: string): boolean | undefined {
  const configPaths = [join(projectRoot, ".npmrc"), join(homedir(), ".npmrc")];
  for (const configPath of configPaths) {
    try {
      if (!existsSync(configPath)) continue;
      const raw = readFileSync(configPath, "utf-8");
      for (const line of raw.split(/\r?\n/)) {
        const matched = line.match(/^\s*strict-ssl\s*=\s*(\S+)\s*$/i);
        if (matched) {
          const falsy = ["false", "0", "no", "off"];
          return !falsy.includes(matched[1].toLowerCase());
        }
      }
    } catch {
      // 配置不可读时继续检查下一级
    }
  }
  return undefined;
}

/**
 * 缓存依赖指纹的文件相对路径（位于 node_modules/.cache/actiondock 下）。
 * 基于项目绝对路径生成唯一哈希标识，避免软链接共享 node_modules 时指纹冲突。
 */
function getDependencyFingerprintPath(projectRoot: string): string {
  const projectKey = createHash("sha256").update(resolve(projectRoot)).digest("hex").slice(0, 16);
  return join(projectRoot, "node_modules", ".cache", "actiondock", `${projectKey}-deps.hash`);
}

/**
 * 读取项目当前缓存的依赖指纹哈希。
 */
export function readStoredDependencyFingerprint(projectRoot: string): string | null {
  const fpPath = getDependencyFingerprintPath(projectRoot);
  try {
    if (existsSync(fpPath)) {
      return readFileSync(fpPath, "utf-8").trim();
    }
  } catch {
    // 忽略读取异常
  }
  return null;
}

/**
 * 将最新的依赖指纹哈希写入缓存文件。
 */
export function saveDependencyFingerprint(projectRoot: string, fingerprint: string): void {
  try {
    const fpPath = getDependencyFingerprintPath(projectRoot);
    const dir = dirname(fpPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fpPath, fingerprint, "utf-8");
  } catch {
    // 忽略写入异常（如只读文件系统或权限限制）
  }
}

/**
 * 递归对对象所有键名进行升序排序，保证 JSON.stringify 序列化结果的唯一性与确定性。
 */
function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return obj;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * 计算项目依赖的指纹哈希（基于 package.json 依赖声明及可能存在的锁文件内容）。
 * 
 * @param projectRoot 项目根目录
 * @returns 64位十六进制哈希字符串，若 package.json 不存在或解析失败则返回 null
 */
export function computeDependencyFingerprint(projectRoot: string): string | null {
  const pkgJsonPath = join(projectRoot, "package.json");
  if (!existsSync(pkgJsonPath)) {
    return null;
  }

  try {
    const raw = readFileSync(pkgJsonPath, "utf-8");
    const pkg = JSON.parse(raw);
    const depSpec = {
      dependencies: pkg.dependencies || {},
      devDependencies: pkg.devDependencies || {},
      peerDependencies: pkg.peerDependencies || {},
      optionalDependencies: pkg.optionalDependencies || {},
      overrides: pkg.overrides || {},
      resolutions: pkg.resolutions || {},
    };

    const hash = createHash("sha256");
    hash.update(JSON.stringify(sortObjectKeys(depSpec)));

    // 锁文件变化（如团队协同合并或手动更新锁文件）同样代表依赖版本变更
    const lockFiles = [
      "package-lock.json",
      "npm-shrinkwrap.json",
      "bun.lockb",
      "bun.lock",
    ];

    for (const lockFile of lockFiles) {
      const lockPath = join(projectRoot, lockFile);
      if (existsSync(lockPath)) {
        try {
          hash.update(lockFile);
          hash.update(readFileSync(lockPath));
        } catch {
          // 忽略不可读的锁文件
        }
      }
    }

    return hash.digest("hex");
  } catch {
    return null;
  }
}

/**
 * 确保项目依赖（node_modules）已正确安装。
 * 若尚未安装、依赖版本变更（指纹不匹配）或加载失败时，自动触发包管理器执行依赖安装。
 * 
 * @param projectRoot 项目根目录
 * @param force 是否强制重新安装
 * @returns 是否成功执行了安装或更新
 */
export function ensureProjectDependencies(projectRoot: string, force = false): boolean {
  if (process.env.ACTIONDOCK_AUTO_INSTALL === "false") {
    return false;
  }
  const pkgJsonPath = join(projectRoot, "package.json");
  if (!existsSync(pkgJsonPath)) {
    return false;
  }

  let pkg: any;
  try {
    const raw = readFileSync(pkgJsonPath, "utf-8");
    pkg = JSON.parse(raw);
  } catch {
    return false;
  }

  const hasDeps =
    (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) ||
    (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) ||
    (pkg.peerDependencies && Object.keys(pkg.peerDependencies).length > 0) ||
    (pkg.optionalDependencies && Object.keys(pkg.optionalDependencies).length > 0);

  if (!hasDeps && !force) {
    return false;
  }

  const nodeModulesPath = join(projectRoot, "node_modules");
  const nodeModulesExists = existsSync(nodeModulesPath);
  const currentFingerprint = computeDependencyFingerprint(projectRoot);

  if (!force && nodeModulesExists) {
    const storedFingerprint = readStoredDependencyFingerprint(projectRoot);
    if (storedFingerprint === null) {
      // 首次接入已包含 node_modules 的外部环境或既有项目，信任现有依赖并记录初始指纹
      if (currentFingerprint) {
        saveDependencyFingerprint(projectRoot, currentFingerprint);
      }
      return false;
    }

    if (currentFingerprint && storedFingerprint === currentFingerprint) {
      // 依赖声明与锁文件指纹一致，无需重新安装
      return false;
    }
  }

  try {
    const installCmd = getInstallCommand(projectRoot);
    const actionText = !force && nodeModulesExists ? "Updating" : "Installing";
    process.stderr.write(
      `[actiondock] ${actionText} dependencies using ${installCmd[0]} for '${pkg.name || basename(projectRoot)}'...\n`
    );

    // bun 不读取 .npmrc 的 strict-ssl 配置；当 npm 侧已声明 strict-ssl=false 时，
    // 桥接为 bun 子进程的 NODE_TLS_REJECT_UNAUTHORIZED=0，保证内网自签名证书源下行为一致
    const childEnv = { ...process.env };
    if (installCmd[0] === "bun" && resolveNpmStrictSsl(projectRoot) === false) {
      childEnv.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }

    // 严禁 shell 字符串拼接，直接传入指令与参数数组，Windows 下按需开启平台兼容 shell
    const proc = spawnSync(installCmd[0], installCmd.slice(1), {
      cwd: projectRoot,
      stdio: "pipe",
      shell: process.platform === "win32",
      env: childEnv,
    });

    if (proc.status !== 0) {
      const errText = proc.stderr?.toString() || `Unknown error during ${installCmd[0]} install`;
      process.stderr.write(`[actiondock] Warning: Dependency installation failed: ${errText}\n`);
      if (installCmd[0] === "bun" && /SELF_SIGNED_CERT|CERT_|UNABLE_TO_VERIFY|ERR_TLS/i.test(errText)) {
        process.stderr.write(
          `[actiondock] Hint: bun ignores 'strict-ssl=false' from .npmrc. ` +
            `Add 'strict-ssl=false' to the project or user .npmrc, or set ACTIONDOCK_INSTALLER=npm.\n`
        );
      }
      return false;
    }

    // 安装成功后刷新指纹记录（以安装完成后最终生成的锁文件为准）
    const finalFingerprint = computeDependencyFingerprint(projectRoot) || currentFingerprint;
    if (finalFingerprint) {
      saveDependencyFingerprint(projectRoot, finalFingerprint);
    }

    const successText =
      !force && nodeModulesExists
        ? "Dependencies updated successfully.\n"
        : "Dependencies installed successfully.\n";
    process.stderr.write(`[actiondock] ${successText}`);
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
  const loader = getModuleLoader();

  for (const file of files) {
    try {
      // 动态导入，若缺失模块则自动触发依赖重装与二次重试
      let imported: any;
      try {
        imported = await loader.load(file);
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
            imported = await loader.load(file);
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      const action = imported.default || imported.action;
      if (action && typeof action === "object" && typeof action.id === "string") {
        if (!ACTION_ID_REGEX.test(action.id)) {
          throw new Error(
            `Invalid action ID '${action.id}' found in ${file}. Action IDs must match ${ACTION_ID_REGEX}`
          );
        }
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
 * 加载并建立 Action ID 与其物理源码文件路径之间的映射关系（供构建打包器及清单同步使用）。
 */
export async function loadActionFileMap(
  projectRoot: string,
  actionsDir = "actions",
  options: { autoInstall?: boolean; strict?: boolean } = { autoInstall: true, strict: false }
): Promise<Map<string, ActionFileEntry>> {
  if (options.autoInstall !== false) {
    ensureProjectDependencies(projectRoot);
  }

  const files = discoverActionFiles(projectRoot, actionsDir);
  const map = new Map<string, ActionFileEntry>();
  const loader = getModuleLoader();

  for (const file of files) {
    try {
      let imported: any;
      try {
        imported = await loader.load(file);
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
            imported = await loader.load(file);
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      const act = imported.default || imported.action;
      if (act && typeof act === "object" && typeof act.id === "string") {
        if (!ACTION_ID_REGEX.test(act.id)) {
          throw new Error(
            `Invalid action ID '${act.id}' found in ${file}. Action IDs must match ${ACTION_ID_REGEX}`
          );
        }
        if (map.has(act.id)) {
          throw new Error(
            `Duplicate action ID '${act.id}' found in ${file} (previously loaded from ${map.get(act.id)!.filePath})`
          );
        }
        map.set(act.id, {
          id: act.id,
          filePath: resolve(file),
          action: act,
        });
      } else if (options.strict) {
        console.warn(`[WARN] File ${file} does not export a valid default ActionDefinition`);
      }
    } catch (err: any) {
      if (options.strict) {
        throw new Error(`Failed to load action from ${file}: ${err.message}`);
      }
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

  const filename = basename(filePath.replace(/\\/g, "/"));
  const defaultId = filename.replace(/\.md$/, "");
  const playbookId = frontmatter.id || defaultId;
  if (!PLAYBOOK_ID_REGEX.test(playbookId)) {
    throw new Error(`Invalid playbook ID '${playbookId}' found in ${filePath}. Playbook IDs must match ${PLAYBOOK_ID_REGEX}`);
  }

  return {
    id: playbookId,
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
