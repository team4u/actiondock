import { setHttpServerFactory, setProcessExecutor, setSqliteDriverFactory } from "@actiondock/core";
import { NodeHttpServer } from "./http-server";
import { ExecaProcessExecutor } from "./process-executor";
import { NodeSqliteDriver } from "./sqlite-driver";

export * from "./sqlite-driver";
export * from "./process-executor";
export * from "./module-loader";
export * from "./http-server";

/**
 * 初始化 Node.js 运行时环境适配层。
 * 将 NodeSqliteDriver、ExecaProcessExecutor 与 NodeHttpServer 注入为 Core 层的全局默认驱动。
 */
export function setupNodeRuntime(): void {
  setSqliteDriverFactory((dbPath: string) => new NodeSqliteDriver(dbPath));
  setProcessExecutor(new ExecaProcessExecutor());
  setHttpServerFactory((options) => {
    const server = new NodeHttpServer({
      port: options.port,
      host: options.host,
      fetch: options.fetch,
    });
    server.listen();
    return {
      port: server.port,
      stop: () => server.stop(),
    };
  });
}
