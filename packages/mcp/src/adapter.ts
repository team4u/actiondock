import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  ActionRunner,
  createStorage,
  ExecutionManager,
  findProjectRoot,
  listLinkedPackages,
  loadActions,
  loadProjectConfig,
  resolvePackageRoot,
  ServerRuntimeRegistry,
} from "@actiondock/core";
import type { ProjectConfig, RuntimeStorage } from "@actiondock/core";
import type { ActionDefinition, ExecutionResult, RunRecord } from "@actiondock/sdk";
import { McpServer } from "@modelcontextprotocol/server";
import { toMcpSchema } from "./schemas";
import { toMcpTaskPayload, type ActionDockMcpOptions } from "./types";

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

interface ResolvedTarget {
  projectRoot: string;
  config: ProjectConfig;
  actions: Map<string, ActionDefinition>;
  storage: RuntimeStorage;
  runner: ActionRunner;
}

function createMcpToolCallback(
  runner: ActionRunner,
  actionId: string,
  executionManager: ExecutionManager,
  timeoutMs?: number
) {
  return async (input: any, ctx: any) => {
    const isAsync = Boolean(
      input &&
        typeof input === "object" &&
        (input.execution?.mode === "async" ||
          input.__async === true ||
          input.async === true)
    );
    const signal = ctx.mcpReq?.signal;

    if (isAsync) {
      const handle = runner.start(actionId, input, {
        signal,
        timeoutMs,
      });
      executionManager.register(handle);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ok: true,
              runId: handle.runId,
              taskId: handle.runId,
              status: "running",
            }),
          },
        ],
      };
    }

    const handle = runner.start(actionId, input, {
      signal,
      timeoutMs,
    });
    executionManager.register(handle);
    const result = await handle.result;
    return toMcpResult(result);
  };
}

export type ActionDockMcpServer = McpServer & {
  close: () => Promise<void>;
};

/**
 * Creates and configures an McpServer instance bound to one or more ActionDock packages with Tasks extension support.
 */
export async function createActionDockMcpServer(
  options: ActionDockMcpOptions = {}
): Promise<ActionDockMcpServer> {
  const targetRoots: string[] = [];
  if (options.projectRoot) {
    targetRoots.push(options.projectRoot);
  }
  if (options.projectRoots) {
    targetRoots.push(...options.projectRoots);
  }

  const targetPackages: string[] = [];
  if (options.packageId) {
    targetPackages.push(options.packageId);
  }
  if (options.packageIds) {
    targetPackages.push(...options.packageIds);
  }

  const resolvedRoots = new Set<string>();

  // 1. Handle --all: discover all linked packages from registry
  if (options.all) {
    const linked = listLinkedPackages(options.customHome);
    for (const pkg of linked) {
      if (existsSync(pkg.path)) {
        resolvedRoots.add(resolve(pkg.path));
      }
    }
    const currentRoot = findProjectRoot(process.cwd());
    if (currentRoot) {
      resolvedRoots.add(resolve(currentRoot));
    }
  }

  // 2. Handle specific package IDs
  for (const pkgId of targetPackages) {
    const root = resolvePackageRoot(pkgId, undefined, options.customHome);
    if (!root || !existsSync(root)) {
      throw new Error(`Package '${pkgId}' not found in registry`);
    }
    resolvedRoots.add(resolve(root));
  }

  // 3. Handle specific directory paths
  for (const dir of targetRoots) {
    const absPath = resolve(dir);
    const root = findProjectRoot(absPath);
    if (!root) {
      throw new Error(
        `Project root '${dir}' is not a valid ActionDock package (actiondock.json not found)`
      );
    }
    resolvedRoots.add(resolve(root));
  }

  // 4. Default fallback: current working directory
  if (resolvedRoots.size === 0 && !options.all) {
    const currentRoot = findProjectRoot(process.cwd());
    if (currentRoot) {
      resolvedRoots.add(resolve(currentRoot));
    }
  }

  const runtimeRegistry = options.runtimeRegistry ?? new ServerRuntimeRegistry();
  const executionManager = options.executionManager ?? runtimeRegistry.executionManager;
  const targets: ResolvedTarget[] = [];

  // Handle case where options.actions is provided directly (e.g. unit tests or virtual packages)
  if (resolvedRoots.size === 0 && options.actions) {
    const dummyConfig: ProjectConfig = {
      id: "virtual",
      name: "Virtual Package",
      version: "2.0.0",
      description: "In-memory virtual package",
      actionsDir: "actions",
      playbooksDir: "playbooks",
    };
    const storage = options.storage ?? runtimeRegistry.getStorage("virtual");
    const runner = new ActionRunner({
      packageId: dummyConfig.id,
      storage,
      globalStorage: runtimeRegistry.getGlobalStorage(options.customHome),
      projectConfig: dummyConfig,
      configOverrides: options.configOverrides,
      actions: options.actions,
    });
    targets.push({
      projectRoot: "virtual",
      config: dummyConfig,
      actions: options.actions,
      storage,
      runner,
    });
  } else {
    if (resolvedRoots.size === 0) {
      throw new Error(
        "No ActionDock project root found. Run inside an ActionDock package or specify --dir / --package / --all."
      );
    }

    for (const root of resolvedRoots) {
      const projectConfig = loadProjectConfig(root);
      const actions =
        options.actions && resolvedRoots.size === 1
          ? options.actions
          : await loadActions(root, projectConfig.actionsDir);

      const storage =
        options.storage && resolvedRoots.size === 1
          ? options.storage
          : runtimeRegistry.getStorage(projectConfig.id, root);

      const runner = new ActionRunner({
        packageId: projectConfig.id,
        projectRoot: root,
        storage,
        globalStorage: runtimeRegistry.getGlobalStorage(options.customHome),
        projectConfig,
        configOverrides: options.configOverrides,
        actions,
      });

      targets.push({
        projectRoot: root,
        config: projectConfig,
        actions,
        storage,
        runner,
      });
    }
  }

  const isMultiPackage = targets.length > 1;

  // Check action ID collision across packages
  const actionIdCounts = new Map<string, number>();
  for (const target of targets) {
    for (const actionId of target.actions.keys()) {
      actionIdCounts.set(actionId, (actionIdCounts.get(actionId) || 0) + 1);
    }
  }

  const serverName =
    targets.length === 1
      ? targets[0].config.id || targets[0].config.name || "actiondock"
      : "actiondock";
  const serverVersion =
    targets.length === 1 ? targets[0].config.version || "2.0.0" : "2.0.0";

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

  // 1. Register Action Tools across all targets
  for (const target of targets) {
    for (const action of target.actions.values()) {
      const count = actionIdCounts.get(action.id) || 1;
      const cleanPkgId = target.config.id.replace(/^@/, "").replace(/[^a-zA-Z0-9_-]+/g, "_");
      let toolName = count > 1 ? `${cleanPkgId}_${action.id}` : action.id;
      if (toolName.length > 64) {
        const hash = createHash("sha256").update(toolName).digest("hex").slice(0, 8);
        toolName = `${toolName.slice(0, 55)}_${hash}`;
      }
      const description = isMultiPackage
        ? `[${target.config.id}] ${action.description || ""}`
        : action.description;

      server.registerTool(
        toolName,
        {
          description,
          inputSchema: toMcpSchema(action.inputSchema),
          outputSchema: action.outputSchema ? toMcpSchema(action.outputSchema) : undefined,
        },
        createMcpToolCallback(
          target.runner,
          action.id,
          executionManager,
          options.timeoutMs
        )
      );
    }
  }

  const storages = targets.map((t) => t.storage);

  // 2. Register Tasks extension endpoints: tasks/get
  (server.server as any).setRequestHandler("tasks/get", async (req: any) => {
    const taskId = req.params?.taskId;
    if (!taskId) {
      throw new Error("taskId parameter is required for tasks/get");
    }
    for (const storage of storages) {
      const run = storage.getRun(taskId);
      if (run) {
        return {
          task: toMcpTaskPayload(run),
        };
      }
    }
    throw new Error(`Task '${taskId}' not found`);
  });

  // 3. Register Tasks extension endpoints: tasks/cancel
  (server.server as any).setRequestHandler("tasks/cancel", async (req: any) => {
    const taskId = req.params?.taskId;
    if (!taskId) {
      throw new Error("taskId parameter is required for tasks/cancel");
    }
    const activeHandle = executionManager.get(taskId);
    if (activeHandle) {
      executionManager.cancel(taskId, req.params?.reason || "Cancelled via MCP tasks/cancel");
      return {
        taskId,
        status: "cancelled",
      };
    }
    for (const storage of storages) {
      const run = storage.getRun(taskId);
      if (run) {
        if (run.status === "running") {
          storage.updateRun(taskId, "cancelled", undefined, {
            code: "ACTION_CANCELLED",
            message: req.params?.reason || "Cancelled via MCP tasks/cancel",
          });
        }
        return {
          taskId,
          status: "cancelled",
        };
      }
    }
    throw new Error(`Task '${taskId}' not found`);
  });

  // 4. Register Tasks extension endpoints: tasks/list
  (server.server as any).setRequestHandler("tasks/list", async (req: any) => {
    const limit = typeof req.params?.limit === "number" ? req.params.limit : 50;
    const actionId = req.params?.actionId;
    const allRuns: RunRecord[] = [];
    for (const storage of storages) {
      const runs = storage.listRuns({ limit, actionId });
      allRuns.push(...runs);
    }
    allRuns.sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
    const trimmed = allRuns.slice(0, limit);
    return {
      tasks: trimmed.map(toMcpTaskPayload),
    };
  });

  const originalClose = server.close.bind(server);
  let isClosed = false;

  const closeFn = async (): Promise<void> => {
    if (isClosed) return;
    isClosed = true;

    process.removeListener("exit", onProcessExit);

    for (const storage of storages) {
      try {
        storage.close();
      } catch {
        // ignore
      }
    }

    if (!options.runtimeRegistry) {
      try {
        runtimeRegistry.close();
      } catch {
        // ignore
      }
    }

    try {
      await originalClose();
    } catch {
      // ignore
    }
  };

  const onProcessExit = () => {
    for (const storage of storages) {
      try {
        storage.close();
      } catch {
        // ignore
      }
    }
    if (!options.runtimeRegistry) {
      try {
        runtimeRegistry.close();
      } catch {
        // ignore
      }
    }
  };

  process.once("exit", onProcessExit);

  (server as any).close = closeFn;

  return server as ActionDockMcpServer;
}
