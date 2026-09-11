import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IpcActionDockTarget, type ActionDockTarget } from "@actiondock/core";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createActionDockMcpServer, resolveTarget, type ActionDockMcpServer } from "./adapter";
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
  let targetToUse: ActionDockTarget | undefined;
  let childProcess: ChildProcess | undefined;

  // 若显式传入了已构造的 target 或不可序列化的内存对象，直接复用或解析目标实例
  if (options.target || options.actions || options.storage || options.app || options.host) {
    targetToUse = options.target ?? (await resolveTarget(options)).target;
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
          configOverrides: options.configOverrides,
          timeoutMs: options.timeoutMs,
        }),
      },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    // 标准输出物理隔离与受控限流排空转入 stderr 诊断流
    targetToUse = new IpcActionDockTarget({
      childProcess,
      maxDiagnosticBytes: 512 * 1024,
      maxDiagnosticRate: 64 * 1024,
      diagnosticTarget: process.stderr,
    });
  }

  const stdioHandler = serveStdio(
    async () => {
      const server = await createActionDockMcpServer({
        ...options,
        target: targetToUse,
      });
      activeServer = server;
      targetToUse = targetToUse || server.target;
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
    if (targetToUse) {
      try {
        await targetToUse.close();
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
}
