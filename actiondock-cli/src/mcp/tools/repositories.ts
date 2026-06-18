import { z } from "zod";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ActionDockClient } from "../../lib/client.js";
import type { McpPolicy } from "../types.js";
import { registerActionDockTool } from "../core/register-tool.js";

/**
 * Context handed to a {@code register*Tools} helper. Mirrors the fields each
 * tool needs to talk to the backend and to apply the active policy.
 */
export interface ToolContext {
  /** ActionDock client used by tool handlers to reach the backend. */
  client: ActionDockClient;
  /** Active policy gating tool registration and result shaping. */
  policy: McpPolicy;
}

/**
 * Register the ActionDock repository MCP tools on {@code server}.
 *
 * <p>All tools are classified as {@code read} risk and are therefore always
 * registered regardless of the policy's execute/write/admin flags. Each handler
 * returns the raw backend payload; secret redaction and byte-size truncation
 * are applied centrally by {@link registerActionDockTool}.
 *
 * <p>Registered tools:
 * <ul>
 *   <li>{@code actiondock_repository_list} - list all repositories.</li>
 *   <li>{@code actiondock_repository_resolve} - resolve a project repository's
 *       ACTIONDOCK.md (returned verbatim in {@code content}).</li>
 *   <li>{@code actiondock_repository_script_list} - list repository scripts.</li>
 *   <li>{@code actiondock_repository_script_get} - fetch a repository script.</li>
 *   <li>{@code actiondock_repository_knowledge_list} - list repository knowledge.</li>
 *   <li>{@code actiondock_repository_knowledge_get} - fetch repository knowledge.</li>
 * </ul>
 */
export function registerRepositoryTools(server: McpServer, ctx: ToolContext): void {
  const { client, policy } = ctx;

  // ─── actiondock_repository_list ──────────────────────────
  registerActionDockTool(server, {
    name: "actiondock_repository_list",
    description: "List all ActionDock repositories.",
    risk: "read",
    inputSchema: {},
    policy,
    client,
    handler: async () => client.repositories.list()
  });

  // ─── actiondock_repository_resolve ───────────────────────
  registerActionDockTool(server, {
    name: "actiondock_repository_resolve",
    description:
      "Resolve a project repository and return its ACTIONDOCK.md content (full text in the `content` field).",
    risk: "read",
    inputSchema: {
      repositoryId: z.string().describe("Repository id to resolve.")
    },
    policy,
    client,
    handler: async (args) =>
      client.repositories.resolveProject(args.repositoryId as string)
  });

  // ─── actiondock_repository_script_list ───────────────────
  registerActionDockTool(server, {
    name: "actiondock_repository_script_list",
    description:
      "List scripts available in a repository. Omit repositoryId to list across all repositories.",
    risk: "read",
    inputSchema: {
      repositoryId: z
        .string()
        .optional()
        .describe("Repository id to scope the listing. Omit to list across all repositories.")
    },
    policy,
    client,
    handler: async (args) =>
      client.repositories.listScripts(args.repositoryId as string | undefined)
  });

  // ─── actiondock_repository_script_get ────────────────────
  registerActionDockTool(server, {
    name: "actiondock_repository_script_get",
    description: "Fetch a single script from a repository, including its source and templates.",
    risk: "read",
    inputSchema: {
      repositoryId: z.string().describe("Repository id containing the script."),
      scriptId: z.string().describe("Script id to fetch.")
    },
    policy,
    client,
    handler: async (args) =>
      client.repositories.getScript(
        args.repositoryId as string,
        args.scriptId as string
      )
  });

  // ─── actiondock_repository_knowledge_list ────────────────
  registerActionDockTool(server, {
    name: "actiondock_repository_knowledge_list",
    description:
      "List knowledge entries available in a repository. Omit repositoryId to list across all repositories.",
    risk: "read",
    inputSchema: {
      repositoryId: z
        .string()
        .optional()
        .describe("Repository id to scope the listing. Omit to list across all repositories.")
    },
    policy,
    client,
    handler: async (args) =>
      client.repositories.listKnowledge(args.repositoryId as string | undefined)
  });

  // ─── actiondock_repository_knowledge_get ─────────────────
  registerActionDockTool(server, {
    name: "actiondock_repository_knowledge_get",
    description: "Fetch a single knowledge entry from a repository, including its config template.",
    risk: "read",
    inputSchema: {
      repositoryId: z.string().describe("Repository id containing the knowledge entry."),
      knowledgeId: z.string().describe("Knowledge id to fetch.")
    },
    policy,
    client,
    handler: async (args) =>
      client.repositories.getKnowledge(
        args.repositoryId as string,
        args.knowledgeId as string
      )
  });
}
