import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  ACTIONDOCK_VERSION,
  ActionResolver,
  createActionDockTarget,
  findProjectRoot,
  resolvePackageRoot,
} from "@actiondock/core";
import type {
  ActionDockApp,
  ActionDockAppOptions,
  ActionDockHost,
  ActionDockTarget,
  RuntimeStorage,
} from "@actiondock/core";
import type { ExecutionResult, JsonValue, RunRecord } from "@actiondock/sdk";
import { McpServer } from "@modelcontextprotocol/server";
import { registerTasksExtension } from "./register-tasks-extension";
import { toMcpSchema } from "./schemas";
import type { ActionDockMcpOptions } from "./types";
import {
  isAsyncExecutionRequested,
  stripExecutionWrapper,
} from "./execution-mode";

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

/** 适配层统一结构化错误码：MCP 工具名冲突。 */
const MCP_TOOL_NAME_COLLISION = "MCP_TOOL_NAME_COLLISION";

/**
 * 构造外部注入 storage 的非接管视图。
 *
 * 默认（ownStorageLifecycle 为 false）时外部 storage 生命周期由注入方管理，
 * 适配层仅委托读写而不接管关闭：所有成员函数与属性原样转发到原始实例并绑定原 this，
 * 仅 close 收敛为显式声明的无操作边界，确保 target.close() 级联关闭时不会误伤外部实例。
 *
 * @param storage 外部注入的存储实例
 */
function createExternalStorageView(storage: RuntimeStorage): RuntimeStorage {
  return new Proxy(storage, {
    get(target, prop) {
      if (prop === "close") {
        return () => undefined;
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/**
 * 构造携带结构化错误码的工具名冲突异常。
 *
 * @param toolName 冲突的工具名
 */
function toolNameCollisionError(toolName: string): Error & { code: string } {
  const err = new Error(`MCP tool name collision detected for tool '${toolName}'`) as Error & {
    code: string;
  };
  err.code = MCP_TOOL_NAME_COLLISION;
  return err;
}

/**
 * 解析或基于选项创建底层 ActionDockTarget 统一门面。
 */
export async function resolveTarget(
  options: ActionDockMcpOptions
): Promise<{ target: ActionDockTarget; ownsTarget: boolean }> {
  if (options.target) {
    return { target: options.target, ownsTarget: false };
  }

  if (options.host) {
    const target = await createActionDockTarget({ type: "local", host: options.host });
    return { target, ownsTarget: false };
  }

  if (options.app) {
    const target = await createActionDockTarget({ type: "local", app: options.app });
    return { target, ownsTarget: false };
  }

  const packages: ActionDockAppOptions[] = [];

  // 外部注入的 storage 生命周期默认由注入方管理，适配层不伪造 close 语义；
  // 仅当显式声明 ownStorageLifecycle 时才向包配置透传原始实例（随 target.close() 级联关闭）
  // 外部注入的 storage 生命周期默认由注入方管理，适配层仅委托读写不接管关闭；
  // 显式声明 ownStorageLifecycle 时透传原始实例，随 target.close() 级联关闭
  const appStorage = options.storage
    ? options.ownStorageLifecycle
      ? options.storage
      : createExternalStorageView(options.storage)
    : undefined;

  if (options.actions) {
    packages.push({
      projectConfig: {
        id: options.packageId || "default",
        name: options.packageId || "default",
        version: ACTIONDOCK_VERSION,
      },
      actions: options.actions,
      storage: appStorage,
      inMemory: true,
      customHome: options.customHome,
      configOverrides: options.configOverrides,
    });
  }

  if (options.projectRoots && options.projectRoots.length > 0) {
    for (const root of options.projectRoots) {
      const abs = resolve(root);
      const detected = findProjectRoot(abs);
      if (!detected) {
        throw new Error(
          `Project root '${root}' is not a valid ActionDock package (actiondock.json not found)`
        );
      }
      packages.push({
        packageRoot: detected,
        storage: appStorage,
        customHome: options.customHome,
        configOverrides: options.configOverrides,
      });
    }
  }

  if (options.packageIds && options.packageIds.length > 0) {
    for (const pkgId of options.packageIds) {
      const root = resolvePackageRoot(pkgId, undefined, options.customHome);
      if (!root || !existsSync(root)) {
        throw new Error(`Package '${pkgId}' not found in registry`);
      }
      packages.push({
        packageRoot: root,
        storage: appStorage,
        customHome: options.customHome,
        configOverrides: options.configOverrides,
      });
    }
  }

  let projectRoot = options.projectRoot;
  if (options.projectRoot) {
    const abs = resolve(options.projectRoot);
    const detected = findProjectRoot(abs);
    if (!detected) {
      throw new Error(
        `Project root '${options.projectRoot}' is not a valid ActionDock package (actiondock.json not found)`
      );
    }
    projectRoot = detected;
  }

  if (
    !projectRoot &&
    packages.length === 0 &&
    !options.all &&
    !options.packageId
  ) {
    const currentRoot = findProjectRoot(process.cwd());
    if (!currentRoot) {
      throw new Error(
        "No ActionDock project root found. Run inside an ActionDock package or specify --dir / --package / --all."
      );
    }
    projectRoot = currentRoot;
  }

  if (options.packageId && !options.actions && packages.length === 0) {
    const root = resolvePackageRoot(options.packageId, undefined, options.customHome);
    if (!root || !existsSync(root)) {
      throw new Error(`Package '${options.packageId}' not found in registry`);
    }
    packages.push({
      packageRoot: root,
      customHome: options.customHome,
      configOverrides: options.configOverrides,
    });
  }

  const target = await createActionDockTarget({
    type: "local",
    projectRoot,
    packages: packages.length > 0 ? packages : undefined,
    scanLinkedPackages: Boolean(options.all),
    hostOptions: {
      autoLoadCurrentProject: packages.length === 0,
    },
    customHome: options.customHome,
  });

  return { target, ownsTarget: true };
}

export type ActionDockMcpServer = McpServer & {
  close: () => Promise<void>;
  target: ActionDockTarget;
  host?: ActionDockHost;
  app?: ActionDockApp;
  events?: (runId: string, options?: { after?: number; signal?: AbortSignal }) => AsyncIterable<Record<string, unknown>>;
};

/**
 * 创建并配置基于 ActionDockTarget 的 McpServer 适配层实例。
 */
export async function createActionDockMcpServer(
  options: ActionDockMcpOptions = {}
): Promise<ActionDockMcpServer> {
  const { target } = await resolveTarget(options);

  let serverName = "actiondock";
  let serverVersion = ACTIONDOCK_VERSION;

  try {
    const info = await target.info();
    if (info) {
      serverName = info.name || info.id || "actiondock";
      serverVersion = info.protocolVersion || ACTIONDOCK_VERSION;
      if (info.packages && info.packages.length === 1) {
        serverName = info.packages[0].name || info.packages[0].id || serverName;
        serverVersion = info.packages[0].version || serverVersion;
      }
    }
  } catch {
    // 忽略元数据读取失败，使用默认值
  }

  const server = new McpServer({
    name: serverName,
    version: serverVersion,
  });

  // 任务规范扩展注册集中隔离在独立模块，本层不再直接操作 SDK 内层实例
  registerTasksExtension(server, target);

  // 工具注册与模式映射：tools/list 纯粹委托 target.listActions()
  const actions = await target.listActions();

  // 统计 Action 基础 ID 出现频次，用于同名冲突命名空间隔离
  const baseCounts = new Map<string, number>();
  for (const act of actions) {
    let baseId = act.id;
    if (act.id.includes("/")) {
      try {
        const parsed = ActionResolver.parseRef(act.id);
        baseId = parsed.actionId;
      } catch {
        const idx = act.id.lastIndexOf("/");
        baseId = act.id.slice(idx + 1);
      }
    }
    baseCounts.set(baseId, (baseCounts.get(baseId) || 0) + 1);
  }

  const registeredToolNames = new Set<string>();

  for (const action of actions) {
    let baseId = action.id;
    let packageId = action.packageId;
    if (action.id.includes("/")) {
      try {
        const parsed = ActionResolver.parseRef(action.id);
        packageId = parsed.packageId || packageId;
        baseId = parsed.actionId;
      } catch {
        const idx = action.id.lastIndexOf("/");
        packageId = packageId || action.id.slice(0, idx);
        baseId = action.id.slice(idx + 1);
      }
    }

    const count = baseCounts.get(baseId) || 1;
    let toolName = baseId;
    if (count > 1 && packageId) {
      const cleanPkgId = packageId.replace(/^@/, "").replace(/[^a-zA-Z0-9_-]+/g, "_");
      toolName = `${cleanPkgId}_${baseId}`;
    } else if (toolName.includes("/") && packageId) {
      const cleanPkgId = packageId.replace(/^@/, "").replace(/[^a-zA-Z0-9_-]+/g, "_");
      toolName = `${cleanPkgId}_${baseId}`;
    }

    if (toolName.length > 64) {
      const hash = createHash("sha256").update(toolName).digest("hex").slice(0, 8);
      toolName = `${toolName.slice(0, 55)}_${hash}`;
    }

    if (registeredToolNames.has(toolName)) {
      throw toolNameCollisionError(toolName);
    }
    registeredToolNames.add(toolName);

    const isMultiPackage = actions.some(
      (a) => a.id.includes("/") || (a.packageId && a.packageId !== actions[0].packageId)
    );
    const description = isMultiPackage
      ? `[${action.id}] ${action.description || ""}`.trim()
      : action.description;

    // 工具执行：tools/call 委托 target.runAction() 或 target.startAction()
    server.registerTool(
      toolName,
      {
        description,
        inputSchema: toMcpSchema(action.inputSchema),
        outputSchema: action.outputSchema ? toMcpSchema(action.outputSchema) : undefined,
      },
      async (input: unknown, ctx: { mcpReq?: { signal?: AbortSignal } }) => {
        // 异步执行模式只认显式约定字段 execution.mode，旧版 __async 仅作只读兼容探测
        const isAsync = isAsyncExecutionRequested(input);
        const signal = ctx.mcpReq?.signal;

        // 分发前仅剥离适配层注入的包装字段，业务自有字段（含名为 async 的入参）原样透传
        const cleanInput = stripExecutionWrapper(input) as JsonValue;

        if (isAsync) {
          const ticket = await target.startAction(action.id, cleanInput, {
            signal,
            timeoutMs: options.timeoutMs,
          });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  ok: true,
                  runId: ticket.runId,
                  taskId: ticket.runId,
                  status: "running",
                }),
              },
            ],
          };
        }

        const result = await target.runAction(action.id, cleanInput, {
          signal,
          timeoutMs: options.timeoutMs,
        });
        return toMcpResult(result);
      }
    );
  }

  // 任务规范映射（tasks/get、tasks/cancel、tasks/list）已收敛至 registerTasksExtension 隔离模块

  // 资源与规程映射：规程映射为只读 MCP Resource 与 Prompt
  try {
    const playbooks = await target.listPlaybooks();
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
          const spec = await target.describePlaybook(pb.id);
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
          const spec = await target.describePlaybook(pb.id);
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
  } catch {
    // 忽略规程获取或注册异常
  }

  // 服务生命周期：默认 close 仅关闭 MCP 服务本身，不级联 target——
  // SDK 传输层（HTTP 每请求 / stdio 探测回落）会销毁工厂产物，若 close 级联会误杀共享 target；
  // 需要「一次 close 同时释放 target」的独立持有方显式传 cascadeTargetClose
  const originalClose = server.close.bind(server);
  let isClosed = false;

  const closeFn = async (): Promise<void> => {
    if (isClosed) return;
    isClosed = true;

    // 清理异常不吞没：先关服务再级联目标，server 关闭失败也继续释放 target 并聚合上抛
    let closeError: unknown;
    try {
      await originalClose();
    } catch (err) {
      closeError = err;
    }
    if (options.cascadeTargetClose) {
      try {
        await target.close();
      } catch (err) {
        if (closeError !== undefined) {
          throw new AggregateError([closeError, err], "Failed to close MCP server and target");
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
  decorated.target = target;
  decorated.host = options.host;
  decorated.app = options.app;
  decorated.events = (runId: string, opts?: Parameters<ActionDockTarget["events"]>[1]) =>
    target.events(runId, opts);

  return decorated;
}

