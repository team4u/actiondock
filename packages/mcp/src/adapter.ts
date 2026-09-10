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
} from "@actiondock/core";
import type { ExecutionResult, RunRecord } from "@actiondock/sdk";
import { McpServer } from "@modelcontextprotocol/server";
import { toMcpSchema } from "./schemas";
import {
  toMcpTaskPayload,
  toMcpTaskStatus,
  type ActionDockMcpOptions,
} from "./types";

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

  if (options.actions) {
    const actionsList =
      options.actions instanceof Map
        ? Array.from(options.actions.values())
        : Array.isArray(options.actions)
          ? options.actions
          : [];

    const appStorage = options.storage
      ? Object.assign(Object.create(options.storage), { close: () => {} })
      : undefined;

    packages.push({
      projectConfig: {
        id: options.packageId || "default",
        name: options.packageId || "default",
        version: ACTIONDOCK_VERSION,
      },
      actions: actionsList,
      storage: appStorage,
      inMemory: true,
      customHome: options.customHome,
      configOverrides: options.configOverrides,
    });
  }

  const appStorage = options.storage
    ? Object.assign(Object.create(options.storage), { close: () => {} })
    : undefined;

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
      storage: options.storage,
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
  events?: (runId: string, options?: { after?: number; signal?: AbortSignal }) => AsyncIterable<any>;
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
    if (Array.isArray(info)) {
      if (info.length === 1) {
        serverName = info[0].id || info[0].name || "actiondock";
        serverVersion = info[0].version || ACTIONDOCK_VERSION;
      }
    } else if (info) {
      serverName = info.id || info.name || "actiondock";
      serverVersion = info.version || ACTIONDOCK_VERSION;
    }
  } catch {
    // 忽略元数据读取失败，使用默认值
  }

  const server = new McpServer({
    name: serverName,
    version: serverVersion,
  });

  (server.server as any).registerCapabilities({
    tasks: {
      listChanged: true,
      cancel: {},
    },
  });

  // 1. 工具注册与模式映射：tools/list 纯粹委托 target.listActions()
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
      const err = new Error(`MCP tool name collision detected for tool '${toolName}'`);
      (err as any).code = "MCP_TOOL_NAME_COLLISION";
      throw err;
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
      async (input: any, ctx: any) => {
        const isAsync = Boolean(
          input &&
            typeof input === "object" &&
            (input.execution?.mode === "async" ||
              input.__async === true ||
              input.async === true)
        );
        const signal = ctx.mcpReq?.signal;

        // 分发前剥离执行控制字段，防止污染输入导致模式校验失败
        let cleanInput = input;
        if (input && typeof input === "object" && !Array.isArray(input)) {
          const { execution, __async, async: _async, ...rest } = input;
          cleanInput = rest;
        }

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

  // 2. 任务规范映射：tasks/get 委托 target.getRun()
  (server.server as any).setRequestHandler("tasks/get", async (req: any) => {
    const taskId = req.params?.taskId;
    if (!taskId) {
      throw new Error("taskId parameter is required for tasks/get");
    }
    const run = await target.getRun(taskId);
    if (run) {
      return {
        task: toMcpTaskPayload(run),
      };
    }
    throw new Error(`Task '${taskId}' not found`);
  });

  // 3. 任务规范映射：tasks/cancel 委托 target.cancelRun()
  (server.server as any).setRequestHandler("tasks/cancel", async (req: any) => {
    const taskId = req.params?.taskId;
    if (!taskId) {
      throw new Error("taskId parameter is required for tasks/cancel");
    }
    const reason = req.params?.reason || "Cancelled via MCP tasks/cancel";
    const cancelRes = await target.cancelRun(taskId, reason);
    if (cancelRes.outcome === "requested") {
      return {
        taskId,
        status: "cancelled",
      };
    }
    if (cancelRes.outcome === "already_terminal") {
      return {
        taskId,
        status: toMcpTaskStatus(cancelRes.status),
      };
    }
    const run = await target.getRun(taskId);
    if (run) {
      return {
        taskId,
        status: toMcpTaskStatus(run.status),
      };
    }
    throw new Error(`Task '${taskId}' not found`);
  });

  // 4. 任务规范映射：tasks/list 委托 target 历史列表
  (server.server as any).setRequestHandler("tasks/list", async (req: any) => {
    const limit = typeof req.params?.limit === "number" ? req.params.limit : 50;
    const actionId = req.params?.actionId;
    if (typeof (target as any).listRuns === "function") {
      const runs = await (target as any).listRuns({ limit, actionId });
      return {
        tasks: runs.map(toMcpTaskPayload),
      };
    }
    const host = (target as any).target ?? (target as any).host;
    if (host && typeof host.listApps === "function") {
      const allRuns: RunRecord[] = [];
      for (const a of host.listApps()) {
        if (a.storage?.listRuns) {
          allRuns.push(...a.storage.listRuns({ limit, actionId }));
        }
      }
      allRuns.sort(
        (a: any, b: any) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
      return {
        tasks: allRuns.slice(0, limit).map(toMcpTaskPayload),
      };
    }
    if (host && host.storage?.listRuns) {
      const runs = host.storage.listRuns({ limit, actionId });
      return {
        tasks: runs.map(toMcpTaskPayload),
      };
    }
    return { tasks: [] };
  });

  // 5. 资源与规程映射：规程映射为只读 MCP Resource 与 Prompt
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

  // 6. 服务生命周期：server.close() 纯粹协调 target.close()
  const originalClose = server.close.bind(server);
  let isClosed = false;

  const closeFn = async (): Promise<void> => {
    if (isClosed) return;
    isClosed = true;

    try {
      await target.close();
    } catch {
      // 忽略目标关闭异常
    }

    try {
      await originalClose();
    } catch {
      // 忽略服务关闭异常
    }
  };

  (server as any).close = closeFn;
  (server as any).target = target;
  (server as any).host = options.host;
  (server as any).app = options.app;
  (server as any).events = (runId: string, opts?: any) => target.events(runId, opts);

  return server as ActionDockMcpServer;
}

