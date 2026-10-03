import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  ACTIONDOCK_VERSION,
  ActionDockError,
  createActionDock,
  createNodePlatform,
  findProjectRoot,
  PACKAGE_NOT_FOUND,
  PROJECT_ROOT_NOT_FOUND,
  type ActionDockService,
} from "@actiondock/core";
import { createActionDockHost } from "@actiondock/core/server";
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

  const targetPackageIds = options.packageIds || options.packageAllowlist;
  if (targetPackageIds && targetPackageIds.length > 0) {
    for (const pkgId of targetPackageIds) {
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

  let projectRoot = options.projectRoot;
  if (options.projectRoot) {
    const abs = resolve(options.projectRoot);
    const detected = findProjectRoot(abs);
    if (!detected) {
      throw new ActionDockError(
        PROJECT_ROOT_NOT_FOUND,
        `Project root '${options.projectRoot}' is not a valid ActionDock package (actiondock.json not found)`
      );
    }
    projectRoot = detected;
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

  if (options.packageId && !options.actions && packages.length === 0) {
    const root = resolvePackageRoot(options.packageId, undefined, options.customHome);
    if (!root || !existsSync(root)) {
      throw new ActionDockError(
        PACKAGE_NOT_FOUND,
        `Package '${options.packageId}' not found in registry`
      );
    }
    packages.push({
      ...basePkgOpts,
      packageRoot: root,
      dataDir: options.dataDir,
    } as PackageRuntimeOptions);
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
