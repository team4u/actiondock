import { existsSync } from "node:fs";
import type { ActionDefinition, ProcessAPI } from "@actiondock/sdk";
import { loadActions, loadProjectConfig } from "../project/loader";
import { resolvePackageRoot } from "../registry/registry";
import type { RuntimeStorage } from "../storage/types";
import type { RuntimePlatform } from "../platform/types";
import type { Clock } from "./clock";
// 仅类型引用：编译后完全擦除，不在运行时形成对 runner.ts 的循环依赖；
// 子 Runner 实例由 runner.ts 构造时注入的委托回调创建
import type { ActionRunner, PackageContextResolver, RunnerOptions } from "./runner";

/**
 * 跨包 Runner 构建工厂参数（Runner 编排层注入的宿主执行环境快照）。
 */
export interface PackageRunnerFactoryOptions {
  /** 全局共享持久化存储实例（传递给子包 Runner 复用） */
  globalStorage?: RuntimeStorage;
  /** 项目根目录绝对路径 */
  projectRoot?: string;
  /** 外部注入的进程执行器 */
  process?: ProcessAPI;
  /** 可选的时间与时钟源 */
  clock?: Clock;
  /** 可选的底层运行时平台契约 */
  platform?: RuntimePlatform;
  /** 最大调用嵌套深度限制 */
  maxCallDepth: number;
  /** 最大并发子任务数限制 */
  maxSubRuns: number;
  /** 动态解析 Action 的委托函数 */
  actionResolver?: RunnerOptions["actionResolver"];
  /** 跨包存储工厂 */
  getStorageForPackage?: (packageId: string, projectRoot?: string) => RuntimeStorage;
  /** 跨包运行上下文解析委托函数 */
  packageContextResolver?: PackageContextResolver;
  /** 自定义 ActionDock 用户家目录 */
  customHome?: string;
}

/**
 * 跨包 Runner 构建工厂与缓存（单一职责模块）。
 *
 * 收敛 ActionRunner 原内联的跨包执行域：已解析子包 Runner 缓存、构建中 in-flight
 * Promise 去重（消除并发 check-then-act 竞态）、本工厂直接创建的子包存储清单与
 * dispose 级联释放。子 Runner 实例构造委托 ActionRunner 公共构造器，形成单向
 * 依赖：factory -> runner，不产生环。
 */
export class PackageRunnerFactory {
  private readonly options: PackageRunnerFactoryOptions;
  private packageRunners = new Map<string, ActionRunner>();
  /** 跨包 Runner 构建中的 in-flight Promise：并发调用 await 同一构建任务，消除 check-then-act 竞态 */
  private pendingPackageRunners = new Map<string, Promise<ActionRunner | undefined>>();
  /** 本工厂直接为子包创建的存储连接（dispose 时级联关闭；外部注入存储不在此列） */
  private packageStorages = new Set<RuntimeStorage>();
  /** dispose 幂等守卫：并发调用复用同一次释放任务 */
  private disposePromise: Promise<void> | undefined;

  /** 子包 Runner 构造委托（由 runner.ts 注入，避免本模块反向依赖 runner.ts） */
  private readonly createRunner: (options: RunnerOptions) => ActionRunner;

  constructor(
    options: PackageRunnerFactoryOptions,
    createRunner: (options: RunnerOptions) => ActionRunner
  ) {
    this.options = options;
    this.createRunner = createRunner;
  }

  /**
   * 已解析子包 Runner 缓存视图（调用方只读遍历使用）。
   */
  public get runners(): Map<string, ActionRunner> {
    return this.packageRunners;
  }

  /**
   * 注入或更新跨包运行上下文解析委托。
   */
  public setPackageContextResolver(resolver: PackageContextResolver): void {
    this.options.packageContextResolver = resolver;
  }

  /**
   * 跨包运行时解析与获取（确保跨包执行具备独立的配置、存储、状态与 Action 注册表）。
   *
   * 缓存 miss 后存在长异步窗口（加载配置、扫描 Action、打开存储），并发调用会重复构建
   * Runner、重复打开 SQLite 连接且子任务限流计数分裂；故以 in-flight Promise 去重，
   * 并发方 await 同一构建任务，构建失败时移除该 Promise 以便后续重试。
   */
  public async resolveTargetPackageRunner(targetPackageId: string): Promise<ActionRunner | undefined> {
    const cached = this.packageRunners.get(targetPackageId);
    if (cached) {
      return cached;
    }

    const inFlight = this.pendingPackageRunners.get(targetPackageId);
    if (inFlight) {
      return inFlight;
    }

    const building = this.buildTargetPackageRunner(targetPackageId).finally(() => {
      // 无论成败均移除 in-flight 记录：成功者已写入正式缓存，失败者允许重试
      this.pendingPackageRunners.delete(targetPackageId);
    });
    this.pendingPackageRunners.set(targetPackageId, building);
    return building;
  }

  /**
   * 实际构建跨包 Runner（仅由 resolveTargetPackageRunner 串行调度）。
   */
  private async buildTargetPackageRunner(targetPackageId: string): Promise<ActionRunner | undefined> {
    const opts = this.options;
    if (opts.packageContextResolver) {
      const resolved = await opts.packageContextResolver(targetPackageId);
      if (resolved) {
        const runner = this.createRunner({
          packageId: targetPackageId,
          packageInstanceId: resolved.packageInstanceId || (resolved.projectConfig as any)?.packageInstanceId || targetPackageId,
          generationId: resolved.generationId || (resolved.projectConfig as any)?.generationId || "1",
          storage: resolved.storage,
          globalStorage: opts.globalStorage,
          projectRoot: resolved.projectRoot,
          projectConfig: resolved.projectConfig,
          actions: resolved.actions,
          process: opts.process,
          clock: opts.clock,
          platform: opts.platform,
          maxCallDepth: opts.maxCallDepth,
          maxSubRuns: opts.maxSubRuns,
          actionResolver: opts.actionResolver,
          getStorageForPackage: opts.getStorageForPackage,
          packageContextResolver: opts.packageContextResolver,
        });
        this.packageRunners.set(targetPackageId, runner);
        return runner;
      }
    }

    const root = resolvePackageRoot(targetPackageId, opts.projectRoot, opts.customHome);
    if (root && existsSync(root)) {
      const config = loadProjectConfig(root);
      let storage: RuntimeStorage;
      let ownsPackageStorage = false;
      if (opts.getStorageForPackage) {
        storage = opts.getStorageForPackage(targetPackageId, root);
      } else if (opts.platform) {
        storage = opts.platform.storage.createStorage(targetPackageId, {
          projectRoot: root,
          customHome: opts.customHome,
          // 跨包子包存储由当前执行宿主持有，打开时收割遗留孤儿运行
          recoverOrphans: true,
        });
        ownsPackageStorage = true;
      } else {
        // 回退分支与主路径共用 createStorage 单一事实源，确保 run 记录落在统一解析的库文件
        const { createStorage } = await import("../storage/index");
        storage = createStorage(targetPackageId, { projectRoot: root, customHome: opts.customHome, recoverOrphans: true });
        ownsPackageStorage = true;
      }
      // 由本工厂直接创建的子包存储纳入级联释放清单（getStorageForPackage 注入方自管理生命周期）
      if (ownsPackageStorage) {
        this.packageStorages.add(storage);
      }
      const actionsMap = await loadActions(root, config.actionsDir, {
        loader: opts.platform?.modules,
      });
      const runner = this.createRunner({
        packageId: targetPackageId,
        packageInstanceId: (config as any).packageInstanceId || targetPackageId,
        generationId: (config as any).generationId || "1",
        storage,
        globalStorage: opts.globalStorage,
        projectRoot: root,
        projectConfig: config,
        actions: actionsMap,
        process: opts.process,
        clock: opts.clock,
        platform: opts.platform,
        maxCallDepth: opts.maxCallDepth,
        maxSubRuns: opts.maxSubRuns,
        actionResolver: opts.actionResolver,
        getStorageForPackage: opts.getStorageForPackage,
        packageContextResolver: opts.packageContextResolver,
        customHome: opts.customHome,
      });
      this.packageRunners.set(targetPackageId, runner);
      return runner;
    }

    return undefined;
  }

  /**
   * 释放跨包资源：遍历关闭全部子包 Runner 及其独立创建的存储连接。
   *
   * 幂等且并发安全：重复调用直接复用首次 Promise；子包存储异常不阻断其余释放；
   * 仅关闭由本工厂构建子包 Runner 时独立创建的存储，外部注入的存储（如经
   * packageContextResolver 传入的目标包自身存储）生命周期归所有者管理，不在此误关。
   */
  public async dispose(): Promise<void> {
    if (this.disposePromise) {
      return this.disposePromise;
    }
    this.disposePromise = this.disposeInternal();
    return this.disposePromise;
  }

  private async disposeInternal(): Promise<void> {
    // 深度优先递归释放子包 Runner（子 Runner 可能又构建了孙 Runner）
    const children = Array.from(this.packageRunners.values());
    this.packageRunners.clear();
    await Promise.all(
      children.map(async (child) => {
        try {
          await child.dispose();
        } catch {
          // 单个子 Runner 释放异常不阻断其余释放
        }
      })
    );

    // 关闭由本工厂直接创建的子包存储（buildTargetPackageRunner 回退分支）
    for (const storage of this.packageStorages) {
      try {
        const res = storage.close();
        if (res && typeof (res as any).then === "function") {
          await res;
        }
      } catch {
        // 存储重复关闭或已失效时忽略，保持释放链路继续
      }
    }
    this.packageStorages.clear();
  }
}
