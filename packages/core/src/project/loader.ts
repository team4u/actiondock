import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ActionDefinition } from "@actiondock/sdk";
import { DefaultModuleLoader, type ModuleLoader } from "../runtime/module-loader";
import { loadManifest, ACTION_ID_REGEX, PLAYBOOK_ID_REGEX } from "./manifest";
import type {
  ActionDockManifest,
  ActionManifestEntry,
  PlaybookDefinition,
  PlaybookManifestEntry,
  ProjectConfig,
} from "./types";

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
 * 以 actiondock.json 为唯一事实源读取 Action 的元数据契约（id, description, inputSchema, outputSchema, tags, annotations, uses），
 * 源码文件仅提供执行 Handler。
 * 
 * @param projectRoot 项目根目录
 * @param actionsDir actions 子目录（向后兼容回退参数）
 * @param options 控制是否允许自动安装依赖等选项
 * @returns Map<ActionId, ActionDefinition> 映射
 */
export async function loadActions(
  projectRoot: string,
  actionsDir = "actions",
  options: { autoInstall?: boolean; loader?: ModuleLoader } = { autoInstall: true }
): Promise<Map<string, ActionDefinition>> {
  if (options.autoInstall !== false) {
    ensureProjectDependencies(projectRoot);
  }

  const actions = new Map<string, ActionDefinition>();
  const loader = options.loader || new DefaultModuleLoader();

  let manifest: ActionDockManifest | null = null;
  try {
    manifest = loadManifest(projectRoot);
  } catch {
    // 忽略清单加载异常，回退至文件扫描
  }

  const loadedEntries = new Set<string>();

  // 1. 若 actiondock.json 声明了 actions，以清单为唯一事实源
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
        throw new Error(`Action '${actionId}' entry file not found: ${item.entry}`);
      }
      loadedEntries.add(entryPath);

      let imported: any;
      try {
        imported = await loader.load(entryPath);
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
            imported = await loader.load(entryPath);
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      const exported = imported?.default ?? imported?.action ?? imported;
      let runFn: ((input: any, ctx: any) => any) | undefined;
      if (typeof exported === "function") {
        runFn = exported;
      } else if (exported && typeof exported.run === "function") {
        runFn = exported.run.bind(exported);
      }

      if (!runFn) {
        throw new Error(
          `Action '${actionId}' in '${item.entry}' does not export a runnable handler`
        );
      }

      const def: ActionDefinition = {
        id: actionId,
        description: item.description ?? (typeof exported === "object" ? exported?.description : undefined),
        inputSchema: item.inputSchema ?? (typeof exported === "object" ? exported?.inputSchema : undefined),
        outputSchema: item.outputSchema ?? (typeof exported === "object" ? exported?.outputSchema : undefined),
        tags: item.tags ? [...item.tags] : (Array.isArray(exported?.tags) ? [...exported.tags] : []),
        annotations: item.annotations ?? (typeof exported === "object" ? exported?.annotations : undefined),
        uses: item.uses ? [...item.uses] : (Array.isArray(exported?.uses) ? [...exported.uses] : []),
        run: runFn,
      };

      actions.set(actionId, def);
    }
  }

  // 2. 扫描 actions 目录补充加载未在清单中显式声明的 Action
  const files = discoverActionFiles(projectRoot, actionsDir);
  for (const file of files) {
    if (loadedEntries.has(file)) continue;
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

      const exported = imported?.default ?? imported?.action ?? imported;
      let actionId: string | undefined;
      let runFn: ((input: any, ctx: any) => any) | undefined;

      if (typeof exported === "function") {
        runFn = exported;
        actionId = basename(file).replace(/\.(ts|js)$/, "");
      } else if (exported && typeof exported === "object") {
        actionId = exported.id || basename(file).replace(/\.(ts|js)$/, "");
        if (typeof exported.run === "function") {
          runFn = exported.run.bind(exported);
        }
      }

      if (actionId && runFn) {
        if (!ACTION_ID_REGEX.test(actionId)) {
          throw new Error(
            `Invalid action ID '${actionId}' found in ${file}. Action IDs must match ${ACTION_ID_REGEX}`
          );
        }
        if (actions.has(actionId)) {
          continue;
        }
        actions.set(actionId, {
          id: actionId,
          description: typeof exported === "object" ? exported.description : undefined,
          inputSchema: typeof exported === "object" ? exported.inputSchema : undefined,
          outputSchema: typeof exported === "object" ? exported.outputSchema : undefined,
          tags: Array.isArray(exported?.tags) ? [...exported.tags] : [],
          annotations: typeof exported === "object" ? exported.annotations : undefined,
          uses: Array.isArray(exported?.uses) ? [...exported.uses] : [],
          run: runFn,
        });
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
 * 纯文本快速解析 Playbook 头部 YAML Frontmatter，提取基础元数据，不引入重型依赖。
 */
function parseSimpleFrontmatter(raw: string): { id?: string; description?: string; actions?: string[] } {
  const res: { id?: string; description?: string; actions?: string[] } = {};
  const lines = raw.split(/\r?\n/);
  let currentListKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("- ") && currentListKey) {
      const val = trimmed.slice(2).trim().replace(/^['"](.*)['"]$/, "$1");
      if (currentListKey === "actions") {
        res.actions = res.actions || [];
        res.actions.push(val);
      }
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim().replace(/^['"](.*)['"]$/, "$1");
      currentListKey = null;

      if (key === "id") {
        res.id = val;
      } else if (key === "description") {
        res.description = val;
      } else if (key === "actions") {
        if (val.startsWith("[") && val.endsWith("]")) {
          res.actions = val
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim().replace(/^['"](.*)['"]$/, "$1"))
            .filter(Boolean);
        } else {
          res.actions = [];
          currentListKey = "actions";
        }
      }
    }
  }

  return res;
}

/**
 * 解析单个 Playbook Markdown 文件的内容与元数据。
 * 优先以 actiondock.json 中的声明为事实源，若未声明则自动回退解析头部 Frontmatter。
 * 
 * @param content 文件 Markdown 文本内容
 * @param filePath 物理文件路径
 * @param metadata 可选的 Playbook 清单元数据
 * @returns PlaybookDefinition 对象
 */
export function parsePlaybookContent(
  content: string,
  filePath: string,
  metadata?: Partial<PlaybookManifestEntry> & { id?: string }
): PlaybookDefinition {
  let frontmatter: { id?: string; description?: string; actions?: string[] } = {};
  let body = content;

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (match) {
    frontmatter = parseSimpleFrontmatter(match[1]);
    body = match[2];
  }

  const filename = basename(filePath.replace(/\\/g, "/"));
  const defaultId = filename.replace(/\.md$/, "");
  const playbookId = metadata?.id || frontmatter.id || defaultId;
  if (!PLAYBOOK_ID_REGEX.test(playbookId)) {
    throw new Error(`Invalid playbook ID '${playbookId}' found in ${filePath}. Playbook IDs must match ${PLAYBOOK_ID_REGEX}`);
  }

  const description = metadata?.description || frontmatter.description;
  const actions = Array.isArray(metadata?.actions) && metadata.actions.length > 0
    ? [...metadata.actions]
    : (Array.isArray(frontmatter.actions) ? [...frontmatter.actions] : []);

  return {
    id: playbookId,
    description,
    actions,
    content: body.trim(),
    filePath,
  };
}

/**
 * 加载项目 playbooks 目录下的所有 Playbook SOP 文档。
 * 优先以 actiondock.json 中的 playbooks 声明作为唯一事实源，纯 Markdown 读取文档内容。
 * 
 * @param projectRoot 项目根目录
 * @param playbooksDir playbooks 子目录（默认 "playbooks"）
 * @returns Map<PlaybookId, PlaybookDefinition> 映射
 */
export function loadPlaybooks(
  projectRoot: string,
  playbooksDir = "playbooks"
): Map<string, PlaybookDefinition> {
  const playbooks = new Map<string, PlaybookDefinition>();

  let manifest: ActionDockManifest | null = null;
  try {
    manifest = loadManifest(projectRoot);
  } catch {
    // 忽略清单加载异常
  }

  const loadedPlaybookEntries = new Set<string>();

  // 1. 若 actiondock.json 中声明了 playbooks，以清单为唯一事实源
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
      loadedPlaybookEntries.add(fullPath);
      const content = readFileSync(fullPath, "utf-8");
      const def = parsePlaybookContent(content, fullPath, {
        id: playbookId,
        description: pbEntry.description,
        actions: pbEntry.actions,
      });
      playbooks.set(playbookId, def);
    }
  }

  // 2. 扫描 playbooks 目录补充未在清单中显式声明的 Playbook
  const files = discoverPlaybookFiles(projectRoot, playbooksDir);
  for (const file of files) {
    if (loadedPlaybookEntries.has(file)) continue;
    try {
      const content = readFileSync(file, "utf-8");
      const playbook = parsePlaybookContent(content, file);
      if (playbooks.has(playbook.id)) {
        continue;
      }
      playbooks.set(playbook.id, playbook);
    } catch (err: any) {
      throw new Error(`Failed to load playbook from ${file}: ${err.message}`);
    }
  }

  return playbooks;
}
