import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  ACTIONDOCK_VERSION,
  createActionDock,
  createNodePlatform,
  findProjectRoot,
  MCP_TOOL_NAME_COLLISION,
  type ActionDockService,
} from "@actiondock/core";
import {
  createActionDockHost,
  LocalActionDockService,
  type ActionDockHost,
} from "@actiondock/core/server";
import { resolvePackageRoot } from "@actiondock/core/registry";
import type {
  PackageRuntime,
  PackageRuntimeOptions,
  RuntimeStorage,
} from "@actiondock/core/package";
import type { ExecutionResult, JsonValue, RunRecord } from "@actiondock/sdk";
import { McpServer } from "@modelcontextprotocol/server";
import { registerTasksExtension } from "./register-tasks-extension";
import { toMcpSchema } from "./schemas";
import type { ActionDockMcpOptions } from "./types";
import {
  extractExecutionTimeoutMs,
  isAsyncExecutionRequested,
  stripExecutionWrapper,
} from "./execution-mode";

/**
 * MCP 工具回调上下文中携带的请求级取消信号字段。
 *
 * 该形状未出现在 SDK 的公开类型承诺中（依赖 ctx.mcpReq.signal 运行时形状），
 * SDK 升级一旦调整形状不会报错，只会拿到 undefined，取消能力静默失效。
 * 因此集中收敛到本函数管理，并在首次发现形状缺失时向 stderr 输出一次降级警告。
 */
interface ToolCallbackContext {
  mcpReq?: { signal?: AbortSignal };
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
 * 解析 Action 引用字符串为包标识与动作标识。
 */
function splitActionRef(ref: string): { packageId?: string; actionId: string } {
  const idx = ref.lastIndexOf("/");
  if (idx === -1) {
    return { actionId: ref };
  }
  return {
    packageId: ref.slice(0, idx),
    actionId: ref.slice(idx + 1),
  };
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


/**
 * 构造外部注入 storage 的非接管视图。
 *
 * 默认（ownStorageLifecycle 为 false）时外部 storage 生命周期由注入方管理，
 * 适配层仅委托读写而不接管关闭：所有成员函数与属性原样转发到原始实例并绑定原 this，
 * 仅 close 收敛为显式声明的无操作边界，确保 service.close() 级联关闭时不会误伤外部实例。
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
 * 解析或基于选项创建底层 ActionDockService 统一门面。
 */
export async function resolveService(
  options: ActionDockMcpOptions
): Promise<{ service: ActionDockService; ownsService: boolean }> {
  if (options.service) {
    return { service: options.service, ownsService: false };
  }

  if (options.host) {
    const service = new LocalActionDockService(options.host);
    return { service, ownsService: false };
  }

  if (options.runtime) {
    const host = await createActionDockHost({
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
    });
    host.registerRuntime(options.runtime);
    const service = new LocalActionDockService(host);
    return { service, ownsService: false };
  }

  const packages: PackageRuntimeOptions[] = [];

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
      ...(appStorage ? { storage: appStorage } : {}),
      inMemory: true,
      customHome: options.customHome,
      configOverrides: options.configOverrides,
    } as PackageRuntimeOptions);
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
        ...(appStorage ? { storage: appStorage } : {}),
        customHome: options.customHome,
        configOverrides: options.configOverrides,
      } as PackageRuntimeOptions);
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
        ...(appStorage ? { storage: appStorage } : {}),
        customHome: options.customHome,
        configOverrides: options.configOverrides,
      } as PackageRuntimeOptions);
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
      ...(appStorage ? { storage: appStorage } : {}),
      customHome: options.customHome,
      configOverrides: options.configOverrides,
      dataDir: options.dataDir,
    } as PackageRuntimeOptions);
  }

  let platform = options.platform;
  if (!platform && typeof process !== "undefined" && process.versions?.node) {
    platform = createNodePlatform({
      customHome: options.customHome,
      dataDir: options.dataDir,
      rootDir: projectRoot,
    });
  }

  for (const pkg of packages) {
    if (typeof pkg === "object" && pkg !== null && !("info" in pkg)) {
      if (platform && !pkg.platform) {
        pkg.platform = platform;
      }
      if (!pkg.dataDir && options.dataDir) {
        pkg.dataDir = options.dataDir;
      }
    }
  }

  const service = await createActionDock({
    type: "local",
    projectRoot,
    packages: packages.length > 0 ? packages : undefined,
    scanLinkedPackages: Boolean(options.all),
    hostOptions: {
      autoLoadCurrentProject: packages.length === 0,
    },
    // MCP 服务进程是长驻执行宿主，声明数据目录持有者身份，
    // 打开时收割遗留孤儿运行记录
    recoverOrphans: true,
    customHome: options.customHome,
    dataDir: options.dataDir,
    platform,
  });

  return { service, ownsService: true };
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

  let serverName = "actiondock";
  let serverVersion = ACTIONDOCK_VERSION;

  try {
    const packages = await service.info();
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

  // 任务规范扩展注册集中隔离在独立模块，本层不再直接操作 SDK 内层实例
  registerTasksExtension(server, service);

  // 工具注册与模式映射：tools/list 纯粹委托 service.discovery.listActions()
  const rawActions = await service.discovery.listActions();
  const seenActionKeys = new Map<string, (typeof rawActions)[number]>();
  for (const act of rawActions) {
    let pkgId = act.packageId || "";
    let actId = act.id;
    if (act.id.includes("/")) {
      const parsed = splitActionRef(act.id);
      pkgId = pkgId || parsed.packageId || "";
      actId = parsed.actionId;
    }
    const key = `${pkgId}:${actId}`;
    const existing = seenActionKeys.get(key);
    if (existing) {
      // 若已存在的项是全限定名（含 /），而当前项是短名（不含 /），优先保留短名项
      if (existing.id.includes("/") && !act.id.includes("/")) {
        seenActionKeys.set(key, act);
      }
    } else {
      seenActionKeys.set(key, act);
    }
  }
  const actions = Array.from(seenActionKeys.values());

  // 统计 Action 基础 ID 出现频次，用于同名冲突命名空间隔离
  const baseCounts = new Map<string, number>();
  for (const act of actions) {
    let baseId = act.id;
    if (act.id.includes("/")) {
      const parsed = splitActionRef(act.id);
      baseId = parsed.actionId;
    }
    baseCounts.set(baseId, (baseCounts.get(baseId) || 0) + 1);
  }

  const registeredToolNames = new Set<string>();

  // 多包判定（循环外一次算清）：不同 packageId 去重计数大于 1，
  // 或任一 id 含斜杠（跨包限定名形态），则工具描述需附全限定 id 锚点
  const distinctPackageIds = new Set(
    actions
      .map((a) => (a.id.includes("/") ? splitActionRef(a.id).packageId || a.packageId : a.packageId))
      .filter((pkg): pkg is string => Boolean(pkg))
  );
  const isMultiPackage = distinctPackageIds.size > 1 || actions.some((a) => a.id.includes("/"));

  for (const action of actions) {
    let baseId = action.id;
    let packageId = action.packageId;
    if (action.id.includes("/")) {
      const parsed = splitActionRef(action.id);
      packageId = parsed.packageId || packageId;
      baseId = parsed.actionId;
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

    const description = isMultiPackage
      ? `[${action.id}] ${action.description || ""}`.trim()
      : action.description;

    // 工具执行：tools/call 委托 service.execution.run() 或 service.execution.start()
    server.registerTool(
      toolName,
      {
        description,
        inputSchema: toMcpSchema(action.inputSchema),
        // 出参 schema 不注入 execution 包装字段：实际 structuredContent 不含该字段，注入会与真实返回结构不符
        outputSchema: action.outputSchema
          ? toMcpSchema(action.outputSchema, false)
          : undefined,
      },
      async (input: unknown, ctx: ToolCallbackContext) => {
        // 异步执行模式只认显式约定字段 execution.mode，旧版 __async 仅作只读兼容探测
        const isAsync = isAsyncExecutionRequested(input);
        const signal = extractCancelSignal(ctx);

        // 分发前仅剥离适配层注入的包装字段，业务自有字段（含名为 async 的入参）原样透传
        const cleanInput = stripExecutionWrapper(input) as JsonValue;

        // 超时组合策略：客户端声明与服务端配置同时存在时取较小值（更防御），
        // 任一方单独存在则直接生效，双方均缺省时不设置超时
        const clientTimeoutMs = extractExecutionTimeoutMs(input);
        const effectiveTimeoutMs =
          typeof options.timeoutMs === "number" && typeof clientTimeoutMs === "number"
            ? Math.min(options.timeoutMs, clientTimeoutMs)
            : clientTimeoutMs ?? options.timeoutMs;

        if (isAsync) {
          const ticket = await service.execution.start(action.id, cleanInput, {
            signal,
            timeoutMs: effectiveTimeoutMs,
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

        const result = await service.execution.run(action.id, cleanInput, {
          signal,
          timeoutMs: effectiveTimeoutMs,
        });
        return toMcpResult(result);
      }
    );
  }

  // 任务规范映射（tasks/get、tasks/cancel、tasks/list）已收敛至 registerTasksExtension 隔离模块

  // 资源与规程映射：规程映射为只读 MCP Resource 与 Prompt
  try {
    const playbooks = await service.discovery.listPlaybooks();
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

