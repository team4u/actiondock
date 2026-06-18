import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";

import type { ActionDockClient } from "../../lib/client.js";
import type { ScriptDefinition } from "../../lib/types.js";
import { isScriptAllowed, toToolSafeName } from "../core/names.js";
import { jsonSchemaToZod } from "../core/schema.js";
import { registerActionDockTool } from "../core/register-tool.js";
import type { ToolInputSchema } from "../core/register-tool.js";
import type { ToolContext } from "../types.js";

/** Maximum length (in characters) of a dynamic tool description. */
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * Default Zod raw shape used when a published script has no usable object
 * input schema: a single free-form {@code input} object.
 */
const FALLBACK_INPUT_SHAPE: ToolInputSchema = {
  input: z.record(z.unknown())
};

/**
 * Register one MCP tool per published ActionDock script (subject to the active
 * policy).
 *
 * <p>Each dynamic tool is named {@code actiondock_script__<safe-id>} and executes
 * the published snapshot synchronously ({@code SYNC} + {@code RESULT}). The tool
 * input schema is derived from the script's published JSON Schema; when that
 * schema is missing or cannot be converted into an object shape, the tool falls
 * back to accepting a single free-form {@code input} object.
 *
 * <p>Registration is best-effort: a failure to list scripts logs a warning and
 * returns without blocking server startup, and a failure to register any single
 * script's tool (e.g. a name collision) is logged and skipped without affecting
 * the others.
 *
 * @param server  the MCP server to register tools on
 * @param ctx     shared tool context carrying the client and active policy
 */
export async function registerDynamicScriptTools(server: McpServer, ctx: ToolContext): Promise<void> {
  if (!ctx.policy.enableDynamicTools) {
    return;
  }

  let scripts: ScriptDefinition[];
  try {
    scripts = await ctx.client.scripts.list();
  } catch (error) {
    console.error(`[actiondock-mcp] failed to list scripts for dynamic tools: ${describeError(error)}`);
    return;
  }

  for (const script of scripts) {
    try {
      registerSingleDynamicScript(server, script, ctx);
    } catch (error) {
      console.error(
        `[actiondock-mcp] failed to register dynamic tool for script '${script.id}': ${describeError(error)}`
      );
    }
  }
}

/**
 * Register a single dynamic tool for {@code script} (when it is published and
 * permitted by the policy). Extracted so a per-script registration failure can
 * be caught by the caller without aborting the loop.
 */
function registerSingleDynamicScript(server: McpServer, script: ScriptDefinition, ctx: ToolContext): void {
  if (!isPublished(script) || !isScriptAllowed(script.id, ctx.policy)) {
    return;
  }

  const toolName = `actiondock_script__${toToolSafeName(script.id)}`;
  const inputShape = scriptInputShape(script);
  const description = truncate(dynamicDescription(script), MAX_DESCRIPTION_LENGTH);

  registerActionDockTool(server, {
    name: toolName,
    description,
    risk: "execute",
    inputSchema: inputShape,
    policy: ctx.policy,
    client: ctx.client,
    handler: async (args, client) =>
      client.scripts.execute(
        {
          scriptId: script.id,
          input: extractInput(args),
          mode: "SYNC",
          responseView: "RESULT"
        },
        false
      )
  });
}

/**
 * Decide whether {@code script} has a published revision. Mirrors
 * {@code normalizeScriptDefinition}: either the publication flag is set or a
 * published revision object is present.
 */
function isPublished(script: ScriptDefinition): boolean {
  return Boolean(script.publication?.published) || script.published != null;
}

/**
 * Build the Zod raw shape for a dynamic tool's input from the script's published
 * JSON Schema. Prefers the published revision's schema, falling back to the
 * draft-level {@code script.inputSchema}. When the schema is absent or does not
 * convert into a ZodObject (e.g. an object without properties, or a non-object
 * root), the free-form {@link FALLBACK_INPUT_SHAPE} is returned.
 */
function scriptInputShape(script: ScriptDefinition): ToolInputSchema {
  const inputSchema = script.published?.inputSchema ?? script.inputSchema;
  let converted;
  try {
    converted = jsonSchemaToZod(inputSchema);
  } catch {
    return FALLBACK_INPUT_SHAPE;
  }
  if (converted instanceof z.ZodObject) {
    const shape = converted.shape as Record<string, z.ZodTypeAny>;
    if (Object.keys(shape).length > 0) {
      return shape;
    }
  }
  return FALLBACK_INPUT_SHAPE;
}

/**
 * Compose the human-readable description for a dynamic script tool.
 *
 * <p>Format: {@code Execute published ActionDock script '<id>'[(<name>)][:
 * <description>]}.
 */
export function dynamicDescription(script: ScriptDefinition): string {
  const namePart = script.name ? ` (${script.name})` : "";
  const descPart = script.description ? `: ${script.description}` : "";
  return `Execute published ActionDock script '${script.id}'${namePart}${descPart}`;
}

/**
 * Reduce {@code value} to at most {@code max} characters, appending an ellipsis
 * when truncation occurs.
 */
export function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  if (max <= 1) {
    return value.slice(0, max);
  }
  return `${value.slice(0, max - 1)}…`;
}

/**
 * Normalize the tool {@code args} into a script input object. When the caller
 * passes an object with an {@code input} field that field is unwrapped;
 * otherwise the raw object is forwarded as-is. Non-object args yield an empty
 * object so execution always receives a record.
 */
export function extractInput(args: unknown): Record<string, unknown> {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const record = args as Record<string, unknown>;
    const input = record.input;
    if (input && typeof input === "object" && !Array.isArray(input)) {
      return input as Record<string, unknown>;
    }
    return record;
  }
  return {};
}

/**
 * Render {@code error} as a single-line message safe for stderr logging.
 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
