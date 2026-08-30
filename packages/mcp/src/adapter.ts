import { resolve } from "node:path";
import {
  ActionRunner,
  createStorage,
  ExecutionManager,
  findProjectRoot,
  loadActions,
  loadProjectConfig,
  resolvePackageRoot,
} from "@actiondock/core";
import type { ActionDefinition, ExecutionResult } from "@actiondock/sdk";
import { McpServer } from "@modelcontextprotocol/server";
import { toMcpSchema } from "./schemas";
import { toMcpTaskPayload, type ActionDockMcpOptions } from "./types";

/**
 * Maps standard ActionDock ExecutionResult to standard MCP Tool Call result.
 */
export function toMcpResult(result: ExecutionResult) {
  if (result.ok) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result),
        },
      ],
      structuredContent: result.data as Record<string, unknown>,
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
 * Creates and configures an McpServer instance bound to an ActionDock package with Tasks extension support.
 */
export async function createActionDockMcpServer(
  options: ActionDockMcpOptions = {}
): Promise<McpServer> {
  let projectRoot: string | null = null;

  if (options.packageId) {
    projectRoot = resolvePackageRoot(options.packageId, undefined, options.customHome);
    if (!projectRoot) {
      throw new Error(`Package '${options.packageId}' not found in registry`);
    }
  } else if (options.projectRoot) {
    projectRoot = resolve(options.projectRoot);
  } else {
    projectRoot = findProjectRoot(process.cwd());
  }

  if (!projectRoot) {
    throw new Error(
      "No ActionDock project root found. Run inside an ActionDock package or specify --dir / --package."
    );
  }

  const projectConfig = loadProjectConfig(projectRoot);
  const actions =
    options.actions ?? (await loadActions(projectRoot, projectConfig.actionsDir));
  const storage = options.storage ?? createStorage(projectConfig.id, { projectRoot });
  const executionManager = options.executionManager ?? new ExecutionManager();

  const runner = new ActionRunner({
    packageId: projectConfig.id,
    storage,
    projectConfig,
    configOverrides: options.configOverrides,
    actions,
  });

  const server = new McpServer({
    name: projectConfig.id || projectConfig.name || "actiondock",
    version: projectConfig.version || "2.0.0",
  });

  (server.server as any).registerCapabilities({
    tasks: {
      listChanged: true,
      cancel: {},
    },
  });


  // 1. Register Action Tools (supports both sync execution and async task execution)
  for (const action of actions.values()) {
    server.registerTool(
      action.id,
      {
        description: action.description,
        inputSchema: toMcpSchema(action.inputSchema),
        outputSchema: action.outputSchema
          ? toMcpSchema(action.outputSchema)
          : undefined,
      },
      async (input: any, ctx) => {
        const isAsync = Boolean(
          input &&
            typeof input === "object" &&
            (input.execution?.mode === "async" ||
              input.__async === true ||
              input.async === true)
        );
        const signal = ctx.mcpReq?.signal;

        if (isAsync) {
          const handle = runner.start(action.id, input, {
            signal,
            timeoutMs: options.timeoutMs,
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

        const handle = runner.start(action.id, input, {
          signal,
          timeoutMs: options.timeoutMs,
        });
        executionManager.register(handle);
        const result = await handle.result;
        return toMcpResult(result);
      }
    );
  }

  // 2. Register Tasks extension endpoints: tasks/get
  (server.server as any).setRequestHandler("tasks/get", async (req: any) => {
    const taskId = req.params?.taskId;
    if (!taskId) {
      throw new Error("taskId parameter is required for tasks/get");
    }
    const run = storage.getRun(taskId);
    if (!run) {
      throw new Error(`Task '${taskId}' not found`);
    }
    return {
      task: toMcpTaskPayload(run),
    };
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
    const run = storage.getRun(taskId);
    if (!run) {
      throw new Error(`Task '${taskId}' not found`);
    }
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
  });

  // 4. Register Tasks extension endpoints: tasks/list
  (server.server as any).setRequestHandler("tasks/list", async (req: any) => {
    const limit = typeof req.params?.limit === "number" ? req.params.limit : 50;
    const actionId = req.params?.actionId;
    const runs = storage.listRuns({ limit, actionId });
    return {
      tasks: runs.map(toMcpTaskPayload),
    };
  });

  return server;
}


