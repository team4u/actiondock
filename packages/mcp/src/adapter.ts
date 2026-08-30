import { resolve } from "node:path";
import {
  ActionRunner,
  createStorage,
  findProjectRoot,
  loadActions,
  loadProjectConfig,
  resolvePackageRoot,
} from "@actiondock/core";
import type { ActionDefinition, ExecutionResult } from "@actiondock/sdk";
import { McpServer } from "@modelcontextprotocol/server";
import { toMcpSchema } from "./schemas";
import type { ActionDockMcpOptions } from "./types";

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
 * Creates and configures an McpServer instance bound to an ActionDock package.
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
  const storage = createStorage(projectConfig.id, { projectRoot });

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
      async (input, ctx) => {
        const signal = ctx.mcpReq?.signal;
        const result = await runner.execute(action.id, input, {
          signal,
          timeoutMs: options.timeoutMs,
        });
        return toMcpResult(result);
      }
    );
  }

  return server;
}
