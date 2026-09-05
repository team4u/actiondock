import { setHttpServerFactory, setProcessExecutor, setSqliteDriverFactory } from "@actiondock/core";
import { BunHttpServer } from "./http-server";
import { BunProcessExecutor } from "./process-executor";
import { BunSqliteDriver } from "./sqlite-driver";

export * from "./sqlite-driver";
export * from "./process-executor";
export * from "./http-server";

/**
 * 初始化 Bun 运行时环境适配层。
 * 将 BunSqliteDriver、BunProcessExecutor 与 BunHttpServer 注入为 Core 层的全局默认驱动。
 */
export function setupBunRuntime(): void {
  setSqliteDriverFactory((dbPath: string) => new BunSqliteDriver(dbPath));
  setProcessExecutor(new BunProcessExecutor());
  setHttpServerFactory((options) => {
    const server = new BunHttpServer({
      port: options.port,
      hostname: options.host,
      fetch: options.fetch,
    });
    return {
      port: server.port,
      stop: (closeActive?: boolean) => server.stop(closeActive),
    };
  });
}
