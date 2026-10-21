import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  ACTIONDOCK_VERSION,
  ActionDockError,
  createActionDock,
  createNodePlatform,
  findProjectRoot,
  loadProjectConfig,
  PACKAGE_NOT_FOUND,
  PROJECT_ROOT_NOT_FOUND,
  type ActionDockService,
} from "@actiondock/core";
import { assertServerPolicyValid, createActionDockHost } from "@actiondock/core/server";
import { parseActionRef } from "@actiondock/core/graph";
import { resolvePackageRoot } from "@actiondock/core/registry";
import { createNonClosingStorageView } from "@actiondock/core/package";
import type { PackageRuntimeOptions } from "@actiondock/core/package";
import type { ActionDockMcpOptions } from "./types";

/**
 * 解析或基于选项创建底层 ActionDockService 统一门面。
 */
export async function resolveService(
  options: ActionDockMcpOptions
): Promise<{ service: ActionDockService; ownsService: boolean }> {
  // 授权声明前置校验（单一事实源：core assertServerPolicyValid）：
  // 在任何资源创建、包装载或注入实例复用之前执行，
  // 覆盖 service/host/runtime 直接调用 resolveService 的入口
  assertServerPolicyValid(options, "mcp options");

  if (options.service) {
    return { service: options.service, ownsService: false };
  }

  if (options.host) {
    return { service: options.host, ownsService: false };
  }

  if (options.runtime) {
    const host = await createActionDockHost({
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
    });
    host.registerRuntime(options.runtime);
    return { service: host, ownsService: false };
  }

  const packages: PackageRuntimeOptions[] = [];

  // 外部注入的 storage 生命周期默认由注入方管理，适配层仅委托读写不接管关闭
  // （非接管视图复用 core 单一事实源）；显式声明 ownStorageLifecycle 时透传
  // 原始实例，随 target.close() 级联关闭
  const appStorage = options.storage
    ? options.ownStorageLifecycle
      ? options.storage
      : createNonClosingStorageView(options.storage)
    : undefined;

  // 多分支共享的包选项基底单点构造：storage 视图、家目录与配置覆写
  // 在此收敛一次，各 push 分支仅叠加自身特有字段
  const basePkgOpts = {
    ...(appStorage ? { storage: appStorage } : {}),
    customHome: options.customHome,
    configOverrides: options.configOverrides,
  };

  if (options.actions) {
    packages.push({
      ...basePkgOpts,
      projectConfig: {
        id: options.packageId || "default",
        name: options.packageId || "default",
        version: ACTIONDOCK_VERSION,
      },
      actions: options.actions,
      inMemory: true,
    } as PackageRuntimeOptions);
  }

  if (options.projectRoots && options.projectRoots.length > 0) {
    for (const root of options.projectRoots) {
      const abs = resolve(root);
      const detected = findProjectRoot(abs);
      if (!detected) {
        throw new ActionDockError(
          PROJECT_ROOT_NOT_FOUND,
          `Project root '${root}' is not a valid ActionDock package (actiondock.json not found)`
        );
      }
      packages.push({
        ...basePkgOpts,
        packageRoot: detected,
      } as PackageRuntimeOptions);
    }
  }

  // 单一 projectRoot 分支提前解析并统一登记已声明包身份，
  // 与 projectRoots/内存 actions 包共同构成“无需额外 registry 解析”的身份集合
  let projectRoot = options.projectRoot;
  if (projectRoot) {
    const abs = resolve(projectRoot);
    const detected = findProjectRoot(abs);
    if (!detected) {
      throw new ActionDockError(
        PROJECT_ROOT_NOT_FOUND,
        `Project root '${options.projectRoot}' is not a valid ActionDock package (actiondock.json not found)`
      );
    }
    projectRoot = detected;
    packages.push({
      ...basePkgOpts,
      packageRoot: detected,
    } as PackageRuntimeOptions);
  }

  // 统一收集全部已声明来源的包身份（projectRoot、projectRoots、内存 actions 包）。
  // 已声明来源（projectRoot、projectRoots、内存 actions 包）身份优先登记，
  // 额外授权目标在查 registry 前先比对身份集合：
  // 已声明身份无需重复装载，避免本地项目未 link 时误走 registry 抛 PACKAGE_NOT_FOUND
  const declaredIds = new Set<string>();
  const collectDeclaredId = (packageRoot: string | undefined): void => {
    if (!packageRoot) return;
    const id = loadProjectConfig(packageRoot).id;
    if (id) declaredIds.add(id);
  };
  if (projectRoot) {
    collectDeclaredId(projectRoot);
  }
  for (const pkg of packages) {
    if (typeof pkg === "object" && pkg !== null && "packageRoot" in pkg) {
      collectDeclaredId((pkg as { packageRoot?: string }).packageRoot);
    }
  }
  if (options.actions) {
    declaredIds.add(options.packageId || "default");
  }

  // 附加装载目标为两份白名单的并集：整包授权包与单动作授权引用的所属包均需装载，
  // 仅装载整包授权包会导致单动作授权目标缺失而不可用。
  // * 是全授权标记而非真实包，必须跳过；动作引用用 core parseActionRef 单一事实源解析。
  // packageId/packageIds 是装载选择，不与授权目标混同：显式授权 B/read 必须装载 B。
  const allowedPackageIds = [
    ...(options.packageId ? [options.packageId] : []),
    ...(options.packageIds || []),
    ...(options.packageAllowlist || []).filter((id) => id !== "*"),
    ...(options.actionAllowlist || []).map((ref) => parseActionRef(ref).packageId!),
  ];
  const dedupedTargetPackageIds: string[] = [];
  for (const pkgId of allowedPackageIds) {
    if (declaredIds.has(pkgId)) {
      continue;
    }
    if (!dedupedTargetPackageIds.includes(pkgId)) {
      dedupedTargetPackageIds.push(pkgId);
    }
  }
  if (dedupedTargetPackageIds.length > 0) {
    for (const pkgId of dedupedTargetPackageIds) {
      const root = resolvePackageRoot(pkgId, undefined, options.customHome);
      if (!root || !existsSync(root)) {
        throw new ActionDockError(
          PACKAGE_NOT_FOUND,
          `Package '${pkgId}' not found in registry`
        );
      }
      packages.push({
        ...basePkgOpts,
        packageRoot: root,
      } as PackageRuntimeOptions);
    }
  }

  if (
    !projectRoot &&
    packages.length === 0 &&
    !options.all &&
    !options.packageId
  ) {
    const currentRoot = findProjectRoot(process.cwd());
    if (!currentRoot) {
      throw new ActionDockError(
        PROJECT_ROOT_NOT_FOUND,
        "No ActionDock project root found. Run inside an ActionDock package or specify --dir / --package / --all."
      );
    }
    projectRoot = currentRoot;
  }

  let platform = options.platform;
  if (!platform && typeof process !== "undefined" && process.versions?.node) {
    platform = createNodePlatform({
      customHome: options.customHome,
      dataDir: options.dataDir,
    });
  }

  for (const pkg of packages) {
    if (typeof pkg === "object" && pkg !== null && !("info" in pkg)) {
      if (platform && !pkg.platform) {
        pkg.platform = platform;
      }
      if (!pkg.dataDir && options.dataDir) {
        pkg.dataDir = options.dataDir;
      }
    }
  }

  const service = await createActionDock({
    type: "local",
    projectRoot,
    packages: packages.length > 0 ? packages : undefined,
    scanLinkedPackages: Boolean(options.all),
    hostOptions: {
      autoLoadCurrentProject: packages.length === 0,
    },
    // MCP 服务进程是长驻执行宿主，声明数据目录持有者身份，
    // 打开时收割遗留孤儿运行记录
    recoverOrphans: true,
    customHome: options.customHome,
    dataDir: options.dataDir,
    platform,
  });

  return { service, ownsService: true };
}
