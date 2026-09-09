import type { ProcessAPI } from "@actiondock/sdk";
import type { Clock } from "../runtime/clock";
import type { ModuleLoader } from "../runtime/module-loader";
import type { RuntimeStorage } from "../storage/types";

/**
 * 文件元数据信息契约。
 */
export interface FileStat {
  /** 是否为目录 */
  isDirectory(): boolean;
  /** 是否为普通文件 */
  isFile(): boolean;
  /** 文件字节大小 */
  size: number;
}

/**
 * 跨运行时统一文件系统抽象契约。
 */
export interface FileSystem {
  /** 读取文件内容 */
  readFile(path: string, encoding?: string): Promise<string> | string;
  /** 写入文件内容 */
  writeFile(path: string, content: string | Uint8Array): Promise<void> | void;
  /** 读取目录下的所有条目名称 */
  readdir(dir: string): Promise<string[]> | string[];
  /** 获取路径对应条目的元数据状态 */
  stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean; size: number }>;
  /** 检查路径是否存在 */
  exists(path: string): Promise<boolean> | boolean;
  /** 创建目录 */
  mkdir(dir: string, options?: { recursive?: boolean }): Promise<void> | void;
  /** 删除文件或目录 */
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> | void;
  /** 拷贝文件或目录 */
  copy(src: string, dest: string, options?: { recursive?: boolean }): Promise<void> | void;
}

/**
 * 跨运行时持久化存储工厂配置选项。
 */
export interface StorageFactoryOptions {
  projectRoot?: string;
  dataDir?: string;
  inMemory?: boolean;
  customHome?: string;
}

/**
 * 跨运行时全局存储工厂配置选项。
 */
export interface GlobalStorageFactoryOptions {
  dataDir?: string;
  inMemory?: boolean;
  customHome?: string;
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
 * 跨运行时 HTTP 服务启动工厂契约。
 */
export interface HttpServerFactory {
  /**
   * 启动 HTTP 服务端实例。
   */
  launchHttpServer(options: any): Promise<any>;
}

/**
 * 运行时底层环境核心标准契约。
 * 屏蔽 Node.js、Bun 与测试沙箱环境的差异。
 */
export interface RuntimePlatform {
  /** 运行时平台名称标识 */
  readonly name: "node" | "bun" | "test";
  /** 统一时间与时钟驱动 */
  readonly clock: Clock;
  /** 统一文件系统操作驱动 */
  readonly files: FileSystem;
  /** 动态源码模块加载驱动 */
  readonly modules: ModuleLoader;
  /** 子进程衍生与执行驱动 */
  readonly process: ProcessAPI;
  /** 持久化数据库存储驱动工厂 */
  readonly storage: StorageFactory;
  /** 可选的 HTTP 服务监听驱动工厂 */
  readonly http?: HttpServerFactory;
}
