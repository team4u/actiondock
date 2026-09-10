import { existsSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot, loadActions, loadPlaybooks, loadProjectConfig } from "../project/loader";
import { loadManifest } from "../project/manifest";
import type { ActionDockManifest, PlaybookDefinition } from "../project/types";
import { getPackageSlug } from "../utils";
import type { LinkedPackageEntry } from "./types";

/**
 * 流程步骤的惰性执行体：同步驱动器直接调用，异步驱动器 await，
 * 执行中抛出的异常由驱动器通过 it.throw 回灌生成器的 try/catch。
 */
type FlowThunk = () => any;

/**
 * 实体解析探针：命中返回实体值（Action 场景恒为 true），未命中返回 undefined。
 */
type EntityProbe<V> = (projectRoot: string, config: ActionDockManifest, entityId: string) => V;

/**
 * 由命中结果构造最终解析产物。
 */
type EntityResultBuilder<V, R> = (
  projectRoot: string,
  packageId: string,
  entityId: string,
  value: V
) => R;

interface ResolveEntityFlowOptions<V, R> {
  /** 实体完整标识符（可能是裸 ID 或 <pkg>/<id>、<pkg>:<id> 形式） */
  identifier: string;
  /** 起始工作目录 */
  cwd: string;
  /** 实体名词（Action 或 Playbook），仅用于错误文案 */
  entityNoun: string;
  /** 获取链接包列表（同步或异步由注入方决定，流程通过 thunk 统一驱动） */
  listLinkedPackages: () => LinkedPackageEntry[];
  /** 实体探针 */
  probe: EntityProbe<V>;
  /** 解析结果构造器 */
  buildResult: EntityResultBuilder<V, R>;
}

/**
 * 实体解析唯一流程（生成器表达）：
 * 当前项目探测 → scoped 标识符拆分 → 注册表精确匹配 → 遍历链接包 →
 * 单命中返回、多命中报错、零命中报错。
 *
 * 仅将可能异步的操作（探针、链接列表获取）以 thunk 形式 yield，
 * 由 runFlowSync / runFlowAsync 双驱动器分别以同步调用或 await 方式执行。
 */
export function* resolveEntityFlow<V, R>(
  opts: ResolveEntityFlowOptions<V, R>
): Generator<FlowThunk, R, any> {
  const { identifier, entityNoun } = opts;

  // 当前项目（或其父级项目）优先探测
  const currentRoot = findProjectRoot(opts.cwd);
  if (currentRoot) {
    try {
      const config = loadProjectConfig(currentRoot);
      const hit: V | undefined = yield () => opts.probe(currentRoot, config, identifier);
      if (hit !== undefined) {
        return opts.buildResult(currentRoot, config.id, identifier, hit);
      }
    } catch {
      // 当前项目配置损坏或探测失败：忽略并继续注册表查找
    }
  }

  // scoped 标识符拆分：<package-id>/<entity-id> 或 <package-id>:<entity-id>
  let targetPackage: string | undefined;
  let pureEntityId = identifier;

  if (identifier.includes("/")) {
    const slashIdx = identifier.lastIndexOf("/");
    targetPackage = identifier.slice(0, slashIdx);
    pureEntityId = identifier.slice(slashIdx + 1);
  } else if (identifier.includes(":")) {
    const colonIdx = identifier.lastIndexOf(":");
    targetPackage = identifier.slice(0, colonIdx);
    pureEntityId = identifier.slice(colonIdx + 1);
  }

  const linkedList: LinkedPackageEntry[] = yield () => opts.listLinkedPackages();

  if (targetPackage) {
    let targetRoot: string | undefined;
    let targetPkgId = targetPackage;

    if (currentRoot) {
      try {
        const config = loadProjectConfig(currentRoot);
        if (config.id === targetPackage || getPackageSlug(config.id) === targetPackage) {
          targetRoot = currentRoot;
          targetPkgId = config.id;
        }
      } catch {
        // 当前项目配置损坏：忽略，回退注册表匹配
      }
    }

    let pkg: LinkedPackageEntry | undefined;
    if (!targetRoot) {
      pkg = linkedList.find(
        (p) => p.id === targetPackage || getPackageSlug(p.id) === targetPackage
      );
      if (pkg && existsSync(pkg.path)) {
        targetRoot = pkg.path;
        targetPkgId = pkg.id;
      }
    }

    if (!targetRoot || !existsSync(targetRoot)) {
      throw new Error(
        `Linked package '${targetPackage}' not found or path no longer exists (${pkg?.path || "unregistered"}). Run 'ad link' in the package directory.`
      );
    }

    const config = loadProjectConfig(targetRoot);
    const hit: V | undefined = yield () => opts.probe(targetRoot as string, config, pureEntityId);
    if (hit === undefined) {
      throw new Error(
        `${entityNoun} '${pureEntityId}' not found in package '${targetPkgId}' (${targetRoot})`
      );
    }

    return opts.buildResult(targetRoot, targetPkgId, pureEntityId, hit);
  }

  // 遍历全部链接包搜索
  const matches: Array<{ entry: LinkedPackageEntry; entityId: string; value: V }> = [];

  for (const pkg of linkedList) {
    if (!existsSync(pkg.path)) continue;
    try {
      const config = loadProjectConfig(pkg.path);
      const hit: V | undefined = yield () => opts.probe(pkg.path, config, identifier);
      if (hit !== undefined) {
        matches.push({ entry: pkg, entityId: identifier, value: hit });
      }
    } catch {
      // 忽略损坏的链接包：单个包配置或探测异常不应中断其余包的匹配
    }
  }

  if (matches.length === 1) {
    const m = matches[0];
    return opts.buildResult(m.entry.path, m.entry.id, m.entityId, m.value);
  }

  if (matches.length > 1) {
    const pkgList = matches.map((m) => `'${m.entry.id}'`).join(", ");
    throw new Error(
      `${entityNoun} '${identifier}' is provided by multiple linked packages: ${pkgList}. Please specify using '<package-id>/${identifier}'.`
    );
  }

  if (currentRoot) {
    throw new Error(
      `${entityNoun} '${identifier}' not found in current project or any linked packages`
    );
  } else {
    throw new Error(
      `${entityNoun} '${identifier}' not found. You are not in an ActionDock project, and no linked package provides '${identifier}'. Use 'ad link' to register your package.`
    );
  }
}

/**
 * 同步驱动器：逐个调用 thunk 并把结果回灌生成器，
 * thunk 抛出的异常经 it.throw 回灌生成器内部的 try/catch 处理。
 * 同步流程中误注入异步 thunk 时立即抛错，避免 Promise 被当作命中值静默错判。
 */
export function runFlowSync<R>(flow: Generator<FlowThunk, R, any>): R {
  let step = flow.next();
  while (!step.done) {
    const value = step.value();
    if (value !== undefined && typeof (value as PromiseLike<unknown>).then === "function") {
      throw new Error(
        "Synchronous resolution received an asynchronous effect; check the injected probe and linked-list loader"
      );
    }
    let next: IteratorResult<FlowThunk, R>;
    try {
      next = flow.next(value);
    } catch (err) {
      next = flow.throw(err);
    }
    step = next;
  }
  return step.value;
}

/**
 * 异步驱动器：await 每个 thunk 后回灌结果，拒绝原因经 it.throw 回灌。
 */
export async function runFlowAsync<R>(flow: Generator<FlowThunk, R, any>): Promise<R> {
  let step = flow.next();
  while (!step.done) {
    let next: IteratorResult<FlowThunk, R>;
    try {
      next = flow.next(await step.value());
    } catch (err) {
      next = flow.throw(err);
    }
    step = next;
  }
  return step.value;
}

/**
 * Action 探针（同步）：manifest 声明优先，其次探测源码文件是否落盘。
 */
export function probeActionSync(
  projectRoot: string,
  config: ActionDockManifest,
  actionId: string
): true | undefined {
  const manifest = loadManifest(projectRoot);
  if (manifest?.actions && actionId in manifest.actions) {
    return true;
  }
  const dir = join(projectRoot, config.actionsDir || "actions");
  if (!existsSync(dir)) {
    return undefined;
  }
  if (actionId.includes("..") || actionId.startsWith("/") || actionId.startsWith("\\")) {
    return undefined;
  }
  if (existsSync(join(dir, `${actionId}.ts`)) || existsSync(join(dir, `${actionId}.js`))) {
    return true;
  }
  const relFile = actionId.replace(/\./g, "/");
  if (existsSync(join(dir, `${relFile}.ts`)) || existsSync(join(dir, `${relFile}.js`))) {
    return true;
  }
  return undefined;
}

/**
 * Action 探针（异步）：manifest 声明优先，其次加载源码模块；
 * 模块加载失败时回退同步探测，保证与同步路径判定一致。
 */
export async function probeActionAsync(
  projectRoot: string,
  config: ActionDockManifest,
  actionId: string
): Promise<true | undefined> {
  const manifest = loadManifest(projectRoot);
  if (manifest?.actions && actionId in manifest.actions) {
    return true;
  }
  try {
    const actions = await loadActions(projectRoot, config.actionsDir, { autoInstall: false });
    return actions.has(actionId) ? true : undefined;
  } catch {
    return probeActionSync(projectRoot, config, actionId);
  }
}

/**
 * Playbook 探针：以 actiondock.json 的 playbooks 声明为唯一事实源，命中返回规程定义。
 */
export function probePlaybook(
  projectRoot: string,
  config: ActionDockManifest,
  playbookId: string
): PlaybookDefinition | undefined {
  const playbooks = loadPlaybooks(projectRoot, config.playbooksDir);
  return playbooks.get(playbookId);
}
