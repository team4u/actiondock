import type { ProcessAPI } from "@actiondock/sdk";
import type { Clock } from "../storage/clock";
import type { ModuleLoader } from "./module-loader";
import type { RunsRetentionPolicy, RuntimeStorage } from "../storage/types";
import type { EventSink } from "../runtime/events";


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
}
