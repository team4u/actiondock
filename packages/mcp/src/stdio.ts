import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActionDockService } from "@actiondock/core";
import { IpcActionDockService } from "@actiondock/core/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createActionDockMcpServer, resolveService, type ActionDockMcpServer } from "./adapter";
import type { ActionDockMcpOptions } from "./types";

/**
 * 启动 ActionDock MCP STDIO 协议服务。
 * 建立监督进程物理边界：
 * 1. 监督父进程独占标准输入/输出通道，专用于承载 JSON-RPC 协议；
 * 2. 子进程承载 Action 运行时，通过 Node IPC 通信；
 * 3. 子进程输出被重定向并进行限流排空（转入受控诊断流 stderr），彻底杜绝业务 console.log 破坏 MCP STDIO 流；
 * 4. 子进程异常退出时，转换为结构化 JSON-RPC 错误，保障协议稳定性。
 */
export async function startMcpStdio(
  options: ActionDockMcpOptions = {}
): Promise<void> {
  let activeServer: ActionDockMcpServer | undefined;
  let serviceToUse: ActionDockService | undefined;
  let ownsService = false;
  let childProcess: ChildProcess | undefined;

  // 若显式传入了已构造的 service 或不可序列化的内存对象，直接复用或解析目标实例；
  // ownsService 标记与 adapter 的所有权契约对齐：仅自建实例由本入口的 cleanup 收敛生命周期
  if (options.service || options.actions || options.storage || options.runtime || options.host || options.platform) {
    const resolved = options.service
      ? { service: options.service, ownsService: false }
      : await resolveService(options);
    serviceToUse = resolved.service;
    ownsService = resolved.ownsService;
  } else {
    // 建立隔离的监督子进程
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const hostScript = resolve(
      currentDir,
      existsSync(join(currentDir, "stdio-host.ts")) ? "stdio-host.ts" : "stdio-host.js"
    );

    childProcess = spawn(process.execPath, [hostScript], {
      cwd: options.projectRoot || process.cwd(),
      env: {
        ...process.env,
        ACTIONDOCK_MCP_OPTIONS: JSON.stringify({
          projectRoot: options.projectRoot,
          projectRoots: options.projectRoots,
          packageId: options.packageId,
          packageIds: options.packageIds,
          all: options.all,
          customHome: options.customHome,
          dataDir: options.dataDir,
          configOverrides: options.configOverrides,
          timeoutMs: options.timeoutMs,
        }),
      },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    // 标准输出物理隔离与受控限流排空转入 stderr 诊断流
    serviceToUse = new IpcActionDockService({
      childProcess,
      maxDiagnosticBytes: 512 * 1024,
      maxDiagnosticRate: 64 * 1024,
      diagnosticTarget: process.stderr,
    });
    // IPC 代理实例由本入口创建，生命周期归本入口的 cleanup 所有
    ownsService = true;
  }

  const stdioHandler = serveStdio(
    async () => {
      const server = await createActionDockMcpServer({
        ...options,
        service: serviceToUse,
      });
      activeServer = server;
      serviceToUse = serviceToUse || server.service;
      return server;
    },
    {
      onerror: (err) => {
        process.stderr.write(`[MCP Error] ${err?.message || String(err)}\n`);
      },
    }
  );

  const cleanup = async (): Promise<void> => {
    // 清理链路逐层释放，错误不吞没：收集首个异常向上透传，后续层继续尽力释放
    let firstError: unknown;
    const swallow = (err: unknown) => {
      if (firstError === undefined) firstError = err;
      process.stderr.write(
        `[MCP Cleanup Error] ${err instanceof Error ? err.message : String(err)}\n`
      );
    };

    if (activeServer) {
      try {
        await activeServer.close();
      } catch (err) {
        swallow(err);
      }
    }
    if (serviceToUse && ownsService) {
      // 外部注入的 service（ownsService 为 false）生命周期归调用方，这里不越权关闭；
      // 自建实例（含 IPC 子进程代理）由本入口统一收敛
      try {
        await serviceToUse.close();
      } catch (err) {
        swallow(err);
      }
    }
    try {
      await stdioHandler.close();
    } catch (err) {
      swallow(err);
    }

    if (firstError !== undefined) {
      throw firstError;
    }
  };

  const handleSignal = (signalName: string) => {
    cleanup()
      .then(() => {
        // 正常关闭退出码为 0
        process.exit(0);
      })
      .catch((err) => {
        // 清理失败退出非零退出码，异常详情已写入 stderr 诊断流
        process.stderr.write(
          `[MCP ${signalName} Cleanup Failed] ${err instanceof Error ? err.message : String(err)}\n`
        );
        process.exit(1);
      });
  };

  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));

  // MCP 客户端断开链路：serveStdio 在 stdin 关闭后仅关闭传输层，不退出进程，
  // 监督进程与 IPC 宿主子进程会永久悬挂。这里监听 stdin 的 end 与 close 事件，
  // 触发与信号一致的清理退出路径；exitCode 模式确保异步 cleanup 完成后再真正退出。
  // 幂等防护：cleanup 已被信号或先到的 stdin 事件触发过时不重复执行
  let cleanupTriggered = false;
  const triggerCleanupOnce = () => {
    if (cleanupTriggered) return;
    cleanupTriggered = true;
    cleanup()
      .then(() => {
        process.exitCode = 0;
      })
      .catch((err) => {
        process.stderr.write(
          `[MCP Stdio Cleanup Failed] ${err instanceof Error ? err.message : String(err)}\n`
        );
        process.exitCode = 1;
      });
  };

  process.stdin.once("end", triggerCleanupOnce);
  process.stdin.once("close", triggerCleanupOnce);
}
