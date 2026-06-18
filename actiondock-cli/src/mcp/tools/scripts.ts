import * as z from "zod";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { extractSchemaFields } from "../../lib/schema.js";
import { registerActionDockTool } from "../core/register-tool.js";
import type { ToolContext } from "../types.js";

/**
 * Register the ActionDock script tools on {@code server}.
 *
 * <p>Registered tools:
 * <ul>
 *   <li>{@code actiondock_script_list} (read) — list all scripts.</li>
 *   <li>{@code actiondock_script_get} (read) — fetch a single (draft or published) script.</li>
 *   <li>{@code actiondock_script_schema} (read) — describe a script's input schema.</li>
 *   <li>{@code actiondock_script_run} (execute) — execute a script (gated by policy).</li>
 * </ul>
 *
 * <p>The {@code read} tools are always registered; {@code actiondock_script_run}
 * is registered only when the {@code execute} risk level is enabled by
 * {@code ctx.policy}.
 *
 * @param server  the MCP server to register tools on
 * @param ctx     shared tool context carrying the client and active policy
 */
export function registerScriptTools(server: McpServer, ctx: ToolContext): void {
  registerActionDockTool(server, {
    name: "actiondock_script_list",
    description: "List all ActionDock scripts.",
    risk: "read",
    inputSchema: {},
    policy: ctx.policy,
    client: ctx.client,
    handler: async (_args, client) => client.scripts.list()
  });

  registerActionDockTool(server, {
    name: "actiondock_script_get",
    description: "Fetch a single ActionDock script definition (draft or published snapshot).",
    risk: "read",
    inputSchema: {
      scriptId: z.string().describe("Script id to fetch"),
      draft: z.boolean().optional().describe("Fetch the draft instead of the published snapshot")
    },
    policy: ctx.policy,
    client: ctx.client,
    handler: async (args, client) =>
      client.scripts.get(asString(args.scriptId), asBoolean(args.draft, false))
  });

  registerActionDockTool(server, {
    name: "actiondock_script_schema",
    description: "Describe the input schema of an ActionDock script as human-readable fields.",
    risk: "read",
    inputSchema: {
      scriptId: z.string().describe("Script id to inspect"),
      draft: z.boolean().optional().describe("Inspect the draft schema instead of the published one")
    },
    policy: ctx.policy,
    client: ctx.client,
    handler: async (args, client) => {
      const draft = asBoolean(args.draft, false);
      const script = await client.scripts.get(asString(args.scriptId), draft);
      const schema = draft
        ? script.inputSchema
        : script.published?.inputSchema ?? script.inputSchema;
      const fields = extractSchemaFields(schema);
      return {
        script: {
          id: script.id,
          name: script.name,
          type: script.type,
          description: script.description
        },
        target: draft ? "draft" : "published",
        inputSchema: schema ?? {},
        fields
      };
    }
  });

  registerActionDockTool(server, {
    name: "actiondock_script_run",
    description: "Execute an ActionDock script (SYNC by default).",
    risk: "execute",
    inputSchema: {
      scriptId: z.string().describe("Script id to execute"),
      input: z.record(z.unknown()).describe("Script input object"),
      draft: z.boolean().optional().describe("Execute the draft instead of the published snapshot"),
      mode: z.enum(["SYNC", "ASYNC"]).optional().describe("Submit mode (default SYNC)"),
      responseView: z.enum(["RESULT", "DEBUG"]).optional().describe("Response detail level (default RESULT)")
    },
    policy: ctx.policy,
    client: ctx.client,
    handler: async (args, client) =>
      client.scripts.execute(
        {
          scriptId: asString(args.scriptId),
          input: asRecord(args.input),
          mode: asMode(args.mode, "SYNC"),
          responseView: asResponseView(args.responseView, "RESULT")
        },
        asBoolean(args.draft, false)
      )
  });
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asMode(value: unknown, fallback: "SYNC" | "ASYNC"): "SYNC" | "ASYNC" {
  return value === "ASYNC" || value === "SYNC" ? value : fallback;
}

function asResponseView(value: unknown, fallback: "RESULT" | "DEBUG"): "RESULT" | "DEBUG" {
  return value === "DEBUG" || value === "RESULT" ? value : fallback;
}
