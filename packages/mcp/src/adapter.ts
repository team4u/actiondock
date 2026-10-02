import { ACTIONDOCK_VERSION, type ActionDockService } from "@actiondock/core";
import type { ActionDockHost } from "@actiondock/core/server";
import type { PackageRuntime } from "@actiondock/core/package";
import type { ExecutionResult, JsonValue } from "@actiondock/sdk";
import { McpServer } from "@modelcontextprotocol/server";
import { toMcpSchema } from "./schemas";
import type { ActionDockMcpOptions } from "./types";
import { resolveExecutionTimeout } from "./execution-mode";
import { resolveService } from "./service-resolver";
import { mapAndFilterActions } from "./tool-mapper";
export { resolveService };

/**
 * MCP 工具回调上下文中携带的请求级取消信号字段。
 *
 * 该形状未出现在 SDK 的公开类型承诺中（依赖 ctx.mcpReq.signal 运行时形状），
 * SDK 升级一旦调整形状不会报错，只会拿到 undefined，取消能力静默失效。
 * 因此集中收敛到本函数管理，并在首次发现形状缺失时向 stderr 输出一次降级警告。
 */
interface ToolCallbackContext {
  mcpReq?: { signal?: AbortSignal };
  timeoutMs?: number;
}

/** 形状缺失告警是否已输出过（每个进程仅告警一次，避免逐请求噪声） */
let cancelSignalDegradationWarned = false;

/**
 * 从 MCP 工具回调上下文提取请求级取消信号。
 *
 * @param ctx MCP SDK 回调传入的工具执行上下文
 * @returns 可用的 AbortSignal；形状缺失时返回 undefined 并输出一次降级警告
 */
function extractCancelSignal(ctx: ToolCallbackContext | undefined): AbortSignal | undefined {
  const signal = ctx?.mcpReq?.signal;
  if (!signal && !cancelSignalDegradationWarned) {
    cancelSignalDegradationWarned = true;
    process.stderr.write(
      "[actiondock-mcp] Tool cancel signal unavailable: MCP SDK callback context does not expose mcpReq.signal; per-request cancellation is degraded for this server instance.\n"
    );
  }
  return signal;
}

/**
 * 判断目标值是否为普通对象（Plain Object）。
 * 
 * @param value 待检查的值
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 将 ActionDock 标准的 ExecutionResult 信封结构转换为 MCP 协议规范的 Tool Call 返回结果。
 * 
 * @param result ExecutionResult 结果对象
 */
export function toMcpResult(result: ExecutionResult) {
  if (result.ok) {
    const structuredContent = isPlainObject(result.data)
      ? (result.data as Record<string, unknown>)
      : { value: result.data };

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result),
        },
      ],
      structuredContent,
    };
  }

  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result),
      },
    ],
  };
}




export type ActionDockMcpServer = McpServer & {
  close: () => Promise<void>;
  service: ActionDockService;
  host?: ActionDockHost;
  runtime?: PackageRuntime;
  events?: (runId: string, options?: { after?: number; signal?: AbortSignal }) => AsyncIterable<Record<string, unknown>>;
};

/**
 * 创建并配置基于 ActionDockService 的 McpServer 适配层实例。
 */
export async function createActionDockMcpServer(
  options: ActionDockMcpOptions = {}
): Promise<ActionDockMcpServer> {
  const { service } = await resolveService(options);

  const allowedPackageIds =
    options.packageAllowlist && options.packageAllowlist.length > 0
      ? options.packageAllowlist
      : options.packageIds && options.packageIds.length > 0
      ? options.packageIds
      : options.packageId
      ? [options.packageId]
      : undefined;

  let serverName = "actiondock";
  let serverVersion = ACTIONDOCK_VERSION;

  try {
    let packages = await service.info();
    if (allowedPackageIds && allowedPackageIds.length > 0) {
      packages = packages.filter((p) => p.id && allowedPackageIds.includes(p.id));
    }
    if (packages && packages.length === 1) {
      serverName = packages[0].name || packages[0].id || serverName;
      serverVersion = packages[0].version || serverVersion;
    }
  } catch {
    // 忽略元数据读取失败，使用默认值
  }

  const server = new McpServer({
    name: serverName,
    version: serverVersion,
  });

  // 工具注册与模式映射：tools/list 纯粹委托 service.discovery.listActions()
  let rawActions = await service.discovery.listActions();
  const mappedActions = mapAndFilterActions(rawActions, allowedPackageIds, options.actionAllowlist);

  for (const { toolName, action, description } of mappedActions) {
    // 工具执行：tools/call 委托 service.execution.run()
    server.registerTool(
      toolName,
      {
        description,
        inputSchema: toMcpSchema(action.inputSchema),
        outputSchema: action.outputSchema
          ? toMcpSchema(action.outputSchema)
          : undefined,
      },
      async (input: unknown, ctx: ToolCallbackContext) => {
        const signal = extractCancelSignal(ctx);
        const effectiveTimeoutMs = resolveExecutionTimeout(options, ctx);

        const result = await service.execution.run(action.id, input as JsonValue, {
          signal,
          timeoutMs: effectiveTimeoutMs,
        });
        return toMcpResult(result);
      }
    );
  }

  // 资源与规程映射：规程映射为只读 MCP Resource 与 Prompt
  try {
    let playbooks = await service.discovery.listPlaybooks();
    if (allowedPackageIds && allowedPackageIds.length > 0) {
      playbooks = playbooks.filter(
        (pb) => pb.packageId && allowedPackageIds.includes(pb.packageId)
      );
    }
    for (const pb of playbooks) {
      server.registerResource(
        pb.id,
        `playbook://${pb.id}`,
        {
          title: pb.id,
          description: pb.description,
          mimeType: "text/markdown",
        },
        async (uri: URL) => {
          const spec = await service.discovery.describePlaybook(pb.id);
          return {
            contents: [
              {
                uri: uri.href,
                text: spec.content,
                mimeType: "text/markdown",
              },
            ],
          };
        }
      );

      server.registerPrompt(
        pb.id,
        {
          title: pb.id,
          description: pb.description,
        },
        async () => {
          const spec = await service.discovery.describePlaybook(pb.id);
          return {
            messages: [
              {
                role: "user" as const,
                content: {
                  type: "text" as const,
                  text: spec.content,
                },
              },
            ],
          };
        }
      );
    }
  } catch (err: any) {
    // 规程获取或注册失败不中断适配器启动，但输出诊断行保留排障线索
    console.error(
      `[actiondock-mcp] Failed to register playbook resources/prompts: ${
        err?.message || String(err)
      }`
    );
  }

  // 服务生命周期：默认 close 仅关闭 MCP 服务本身，不级联 service——
  // SDK 传输层（HTTP 每请求 / stdio 探测回落）会销毁工厂产物，若 close 级联会误杀共享 service；
  // 需要「一次 close 同时释放 service」的独立持有方显式传 cascadeServiceClose
  const originalClose = server.close.bind(server);
  let isClosed = false;

  const closeFn = async (): Promise<void> => {
    if (isClosed) return;
    isClosed = true;

    // 清理异常不吞没：先关服务再级联目标，server 关闭失败也继续释放 service 并聚合上抛
    let closeError: unknown;
    try {
      await originalClose();
    } catch (err) {
      closeError = err;
    }
    if (options.cascadeServiceClose) {
      try {
        await service.close();
      } catch (err) {
        if (closeError !== undefined) {
          throw new AggregateError([closeError, err], "Failed to close MCP server and service");
        }
        throw err;
      }
    }
    if (closeError !== undefined) {
      throw closeError;
    }
  };

  const decorated = server as ActionDockMcpServer;
  decorated.close = closeFn;
  decorated.service = service;
  decorated.host = options.host;
  if (service.events) {
    decorated.events = (runId: string, opts?: { after?: number; signal?: AbortSignal }) =>
      service.events!.events(runId, opts);
  }

  return decorated;
}

