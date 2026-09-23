import {
  type Clock,
  SqliteRuntimeStorage,
  type SqliteDriver,
} from "@actiondock/core";

/**
 * 内存运行时存储初始化选项。
 */
export interface MemoryStorageOptions {
  /** 绑定的 Package 标识，默认为 test-pkg */
  packageId?: string;
  /** 可选注入的时间提供器，便于与模拟时钟联动 */
  clock?: Clock;
  /** 可选显式注入的底层 SQLite 驱动 */
  driver?: SqliteDriver;
}

/**
 * 统一内存运行时存储实现。
 * 基于 SqliteRuntimeStorage 构建，默认使用 :memory: 内存数据库并对接虚拟时钟，
 * 确保与生产环境具备完全相同的配置优先级、状态过期契约与运行终态行为。
 */
export class MemoryStorage extends SqliteRuntimeStorage {
  constructor(options: MemoryStorageOptions = {}) {
    super({
      packageId: options.packageId || "test-pkg",
      dbPath: ":memory:",
      driver: options.driver,
      clock: options.clock,
    });
  }
}
