import type { ActionInvokeOptions, ProcessAPI } from "@actiondock/sdk";
import type { Clock } from "../storage/clock";
import type { ModuleLoader } from "./module-loader";
import type { RunsRetentionPolicy, RuntimeStorage } from "../storage/types";
import type { EventSink } from "../runtime/events";
import type { PackageRuntime } from "../package/types";
import type { ConfigItemDefinition } from "../project/types";


/**
 * 跨运行时持久化存储工厂配置选项。
 */
export interface StorageFactoryOptions {
  projectRoot?: string;
  dataDir?: string;
  inMemory?: boolean;
  customHome?: string;
  /**
   * 是否以数据目录持有者身份打开：true 时构造阶段收割死亡会话遗留的非终态运行记录。
   * 默认 false（旁观查询打开，不触碰在途记录），供 CLI 查询命令与执行宿主并发共存。
   */
  recoverOrphans?: boolean;
  /** 运行记录保留策略配置 */
  retentionPolicy?: RunsRetentionPolicy;
  /**
   * 供旧版本数据库迁移判定的配置声明字典集合（包级存储传当前包声明）。
   * 仅在库需要迁移时被读取；版本迁移只在首次打开执行。
   */
  configDeclarations?: readonly Record<string, ConfigItemDefinition>[];
}

/**
 * 跨运行时全局存储工厂配置选项。
 */
export interface GlobalStorageFactoryOptions {
  dataDir?: string;
  inMemory?: boolean;
  customHome?: string;
  /** 是否以持有者身份打开并收割遗留非终态运行记录（默认 false，旁观语义） */
  recoverOrphans?: boolean;
  /**
   * 供旧版本全局库迁移判定的配置声明字典集合（通常为所有已加载包的声明并集）。
   * 仅在库需要迁移时被读取；版本迁移只在首次打开执行。
   */
  configDeclarations?: readonly Record<string, ConfigItemDefinition>[];
}

/**
 * 跨运行时持久化存储工厂契约。
 */
export interface StorageFactory {
  /**
   * 为指定 Package 创建或连接运行时存储。
   */
  createStorage(
    packageId: string,
    options?: StorageFactoryOptions
  ): RuntimeStorage;

  /**
   * 创建或连接跨 Package 共享的全局存储。
   */
  createGlobalStorage(
    options?: GlobalStorageFactoryOptions
  ): RuntimeStorage;
}

/**
 * 动作调用目标解析结果。
 */
export interface InvocationTargetResolution {
  /** 目标 PackageRuntime 实例 */
  readonly runtime: PackageRuntime;
  /** 可选调用作用域，用于区分调用目标与环路死锁检测身份 */
  readonly scope?: string;
  /** 是否强制要求调用方显式声明 uses 依赖 */
  readonly requiresExplicitUses?: boolean;
}

/**
 * 动作调用发起方元数据信息。
 */
export interface InvocationCallerInfo {
  /** 调用发起方包标识 */
  readonly packageId: string;
  /** 调用发起方 Action 动作标识 */
  readonly actionId?: string;
}

/**
 * 运行时平台调用目标解析器端口契约。
 * 允许底层运行时平台在 Host 选择执行目标阶段介入目标解析，提供自定义 PackageRuntime。
 */
export interface InvocationTargetResolver {
  /**
   * 解析指定 Action 引用与调用选项对应的目标 PackageRuntime。
   *
   * @param action 规范化 Action 引用元数据
   * @param options 动作调用选项（包含命名 binding 等）
   * @param caller 发起调用的调用方元数据
   * @returns 目标解析结果；返回的 Runtime 由 Host 接管生命周期；未命中返回 undefined 交由默认主链处理
   */
  resolve(
    action: { packageId: string; actionId: string },
    options: ActionInvokeOptions | undefined,
    caller: InvocationCallerInfo
  ): InvocationTargetResolution | undefined;

  /**
   * 清理端口缓存和附属资源，不重复关闭已移交 Host 的 Runtime。
   */
  close?(): Promise<void>;
}

/**
 * 运行时底层环境核心标准契约。
 * 提供统一的运行时契约，屏蔽宿主平台与测试沙箱环境的实现差异。
 */
export interface RuntimePlatform {
  /** 运行时平台名称标识 */
  readonly name: "node" | "test";
  /** 统一时间与时钟驱动 */
  readonly clock: Clock;
  /** 动态源码模块加载驱动 */
  readonly modules: ModuleLoader;
  /** 子进程衍生与执行驱动 */
  readonly process: ProcessAPI;
  /** 持久化数据库存储驱动工厂 */
  readonly storage: StorageFactory;
  /**
   * 可选执行事件接收器，宿主可注入，缺省由上层默认构造。
   */
  readonly eventSink?: EventSink;
  /**
   * 可选动作调用目标解析器端口，用于宿主环境自定义动作调用路由（例如测试具名 Mock 模拟目标）。
   */
  readonly invocationTargets?: InvocationTargetResolver;
}
