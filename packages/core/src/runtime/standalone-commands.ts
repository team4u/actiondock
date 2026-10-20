import { decodeStateKey, type JsonValue } from "@actiondock/sdk";
import type { ActionSpec } from "../package/types";
import { filterWithFallbackInfo } from "../utils/intent";
import type { ActionDockService } from "../service/types";
import { ActionDockError, INVALID_ARGUMENT, resolveExecutionHint } from "../errors";
import {
  resolveInput,
  resolveValueInput,
  type ResolveValueInputOptions,
  formatActionDetail,
  buildActionDescribePayload,
  mapInputValidationFailure,
} from "../input";
import { validateActionInputValue } from "../value-validator";
import { assertConcreteConfigKey } from "../project/config-declarations";
import { parseDuration } from "../utils";
import { ExitCode, type StandaloneDispatcherOptions } from "./standalone";

export interface CommandContext {
  service: ActionDockService;
  options: StandaloneDispatcherOptions;
  writeOut: (msg: string) => void;
  writeErr: (msg: string) => void;
  emitError: (
    isJson: boolean,
    code: string,
    message: string,
    exitCode: number,
    options?: { textMessage?: string; details?: unknown; hint?: string }
  ) => number;
}

export async function handleList(ctx: CommandContext, subArgs: string[]): Promise<number> {
  const isJson = subArgs.includes("--json");
  const noFallback = subArgs.includes("--no-fallback");
  let intent: string | undefined;
  const positionalPatterns: string[] = [];

  for (let i = 0; i < subArgs.length; i++) {
    const arg = subArgs[i];
    if (arg === "--intent" || arg === "-i") {
      if (i + 1 < subArgs.length) intent = subArgs[++i];
    } else if (arg.startsWith("--intent=")) {
      intent = arg.slice(9);
    } else if (arg.startsWith("-i=")) {
      intent = arg.slice(3);
    } else if (!arg.startsWith("-")) {
      positionalPatterns.push(arg);
    }
  }

  const effectiveIntent =
    intent || (positionalPatterns.length > 0 ? positionalPatterns.join("|") : undefined);

  const actions = await ctx.service.discovery.listActions();
  const list = actions.map((a) => ({
    id: a.id,
    description: a.description || "",
  }));

  const filterRes = filterWithFallbackInfo(
    list,
    effectiveIntent,
    [(a) => a.id, (a) => a.description],
    !noFallback
  );

  const hints = [
    "Tip: For composite or multi-step tasks, check 'ad playbook list' for standard operating procedures.",
  ];

  if (isJson) {
    ctx.writeOut(JSON.stringify({ items: filterRes.items, hints }, null, 2));
  } else {
    let text = `Actions in ${ctx.options.packageId} (v${ctx.options.version}):\n\n`;
    for (const a of filterRes.items) {
      text += `  ${a.id.padEnd(28)} ${a.description}\n`;
    }
    ctx.writeOut(text.trimEnd());
  }
  return ExitCode.SUCCESS;
}

export async function handleDescribe(ctx: CommandContext, subArgs: string[]): Promise<number> {
  const id = subArgs.find((a) => !a.startsWith("-"));
  const isJson = subArgs.includes("--json");

  if (!id) {
    return ctx.emitError(isJson, "INVALID_ARGUMENT", "Action ID is required for describe", ExitCode.INVALID_ARGUMENT);
  }

  let action: ActionSpec | undefined;
  try {
    action = await ctx.service.discovery.describeAction(id);
  } catch {
    const hint = "Tip: Run 'ad list' to discover available actions.";
    return ctx.emitError(
      isJson,
      "INVALID_ARGUMENT",
      `Action '${id}' not found`,
      ExitCode.INVALID_ARGUMENT,
      {
        textMessage: `Error: Action '${id}' not found\n${hint}`,
        hint,
      }
    );
  }

  const payload = buildActionDescribePayload(action, {
    packageId: ctx.options.packageId,
  });

  if (isJson) {
    ctx.writeOut(JSON.stringify(payload, null, 2));
  } else {
    ctx.writeOut(formatActionDetail(payload, { supportsTextField: false }));
  }
  return ExitCode.SUCCESS;
}

export async function handleRun(
  ctx: CommandContext,
  subArgs: string[],
  actionArgs: string[],
  signal?: AbortSignal
): Promise<number> {
  const isJson = subArgs.includes("--json");
  const id = subArgs.find((a) => !a.startsWith("-"));
  if (!id) {
    return ctx.emitError(
      isJson,
      "INVALID_ARGUMENT",
      "Error: Action ID is required for run",
      ExitCode.INVALID_ARGUMENT,
      { textMessage: "Error: Action ID is required for run" }
    );
  }

  let inputStr: string | undefined;
  let inputFile: string | undefined;
  let stdinField: string | undefined;
  let timeoutMs: number | undefined;

  const recognizedFlags = new Set(["--json", "--async"]);
  for (let i = 0; i < subArgs.length; i++) {
    const arg = subArgs[i];
    if (arg === id || recognizedFlags.has(arg)) {
      continue;
    }
    if (arg === "--timeout" && i + 1 < subArgs.length) {
      try {
        timeoutMs = parseDuration(subArgs[++i]);
      } catch (err: any) {
        return ctx.emitError(
          isJson,
          "INVALID_ARGUMENT",
          `Invalid timeout format: ${err?.message || err}`,
          ExitCode.INVALID_ARGUMENT
        );
      }
    } else if (arg.startsWith("--timeout=")) {
      try {
        timeoutMs = parseDuration(arg.slice(10));
      } catch (err: any) {
        return ctx.emitError(
          isJson,
          "INVALID_ARGUMENT",
          `Invalid timeout format: ${err?.message || err}`,
          ExitCode.INVALID_ARGUMENT
        );
      }
    } else if (arg === "--input" && i + 1 < subArgs.length) {
      inputStr = subArgs[++i];
    } else if (arg.startsWith("--input=")) {
      inputStr = arg.slice(8);
    } else if (arg === "-i" && i + 1 < subArgs.length) {
      inputStr = subArgs[++i];
    } else if (arg.startsWith("-i=")) {
      inputStr = arg.slice(3);
    } else if (arg === "--input-file" && i + 1 < subArgs.length) {
      inputFile = subArgs[++i];
    } else if (arg.startsWith("--input-file=")) {
      inputFile = arg.slice(13);
    } else if (arg === "-f" && i + 1 < subArgs.length) {
      inputFile = subArgs[++i];
    } else if (arg.startsWith("-f=")) {
      inputFile = arg.slice(3);
    } else if (arg === "--stdin-field" && i + 1 < subArgs.length) {
      stdinField = subArgs[++i];
    } else if (arg.startsWith("--stdin-field=")) {
      stdinField = arg.slice(14);
    } else if (arg.startsWith("-")) {
      const hint = "Hint: Separate action inputs from CLI options using '--', e.g.: ad run <id> [options] -- <param>=<val> or <param>:=<json>.";
      return ctx.emitError(
        isJson,
        "INVALID_ARGUMENT",
        `error: unknown option '${arg}'`,
        ExitCode.INVALID_ARGUMENT,
        {
          textMessage: `error: unknown option '${arg}'\n${hint}`,
          hint,
        }
      );
    }
  }

  let input: JsonValue;
  try {
    input = await resolveInput({
      input: inputStr,
      inputFile,
      stdinField,
      flatArgs: actionArgs.length > 0 ? actionArgs : undefined,
      stdin: process.stdin,
      signal,
    });
    const check = validateActionInputValue(input);
    if (!check.valid) {
      throw mapInputValidationFailure("cli-pre-target", check);
    }
  } catch (err: any) {
    return ctx.emitError(isJson, err?.code || "INVALID_ARGUMENT", err?.message || String(err), ExitCode.INVALID_ARGUMENT, {
      details: err?.details,
    });
  }

  const result = await ctx.service.execution.run(id, input, {
    signal,
    timeoutMs,
  });

  if (isJson) {
    if (!result.ok) {
      const errorObj = (result as any).error;
      const hint = resolveExecutionHint(id, errorObj);
      const machineOutput = hint !== undefined ? { ...result, hint } : result;
      ctx.writeOut(JSON.stringify(machineOutput, null, 2));
    } else {
      ctx.writeOut(JSON.stringify(result, null, 2));
    }
  } else {
    if (result.ok) {
      const data: any = result.data;
      let rawText: string;
      let metaInfo: Record<string, unknown> | undefined;

      if (typeof data === "string") {
        rawText = data;
      } else if (data !== null && typeof data === "object") {
        if ("content" in data && data.content !== undefined) {
          rawText =
            typeof data.content === "object" && data.content !== null
              ? JSON.stringify(data.content, null, 2)
              : String(data.content);
          const { content, ...rest } = data;
          if (Object.keys(rest).length > 0) {
            metaInfo = rest;
          }
        } else if ("text" in data && typeof data.text === "string") {
          rawText = data.text;
          const { text, ...rest } = data;
          if (Object.keys(rest).length > 0) {
            metaInfo = rest;
          }
        } else if ("message" in data && typeof data.message === "string") {
          rawText = data.message;
          const { message, ...rest } = data;
          if (Object.keys(rest).length > 0) {
            metaInfo = rest;
          }
        } else {
          rawText = JSON.stringify(data, null, 2);
        }
      } else if (data !== undefined) {
        rawText = String(data);
      } else {
        rawText = "";
      }

      if (metaInfo) {
        const parts: string[] = [];
        const title = metaInfo.path ? String(metaInfo.path) : id;
        parts.push(title);

        if (metaInfo.startLine !== undefined && metaInfo.endLine !== undefined) {
          parts.push(`lines ${metaInfo.startLine}-${metaInfo.endLine}`);
        } else if (metaInfo.line !== undefined) {
          parts.push(`line ${metaInfo.line}`);
        }

        if (metaInfo.hasMore !== undefined) {
          parts.push(`hasMore: ${metaInfo.hasMore}`);
        }
        if (metaInfo.truncated) {
          parts.push("truncated: true");
        }

        const handled = new Set(["path", "startLine", "endLine", "line", "hasMore", "truncated"]);
        for (const [k, v] of Object.entries(metaInfo)) {
          if (!handled.has(k) && v !== undefined) {
            parts.push(`${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
          }
        }

        if (parts.length > 0) {
          ctx.writeErr(`[${parts.join(" | ")}]`);
        }
      }

      ctx.writeOut(rawText);
    } else {
      const errorObj = (result as any).error;
      ctx.writeErr(`Error [${errorObj.code}]: ${errorObj.message}`);
      if (errorObj.details) {
        ctx.writeErr(
          typeof errorObj.details === "string"
            ? errorObj.details
            : JSON.stringify(errorObj.details, null, 2)
        );
      }
      const hint = resolveExecutionHint(id, errorObj);
      if (hint) {
        ctx.writeErr(hint);
      }
    }
  }
  return result.ok ? ExitCode.SUCCESS : ExitCode.FAILURE;
}

function isServiceCapabilityError(err: any): boolean {
  const code = String(err?.code || "");
  return (
    code === "CAPABILITY_UNAVAILABLE" ||
    code === "TARGET_CAPABILITY_UNAVAILABLE"
  );
}

function parseSetInput(subArgs: string[], isState: boolean): {
  key: string;
  input: ResolveValueInputOptions;
  namespace?: string;
  ttl?: number;
} {
  const positional: string[] = [];
  const input: ResolveValueInputOptions = {};
  let namespace: string | undefined;
  let ttl: number | undefined;

  for (let i = 1; i < subArgs.length; i++) {
    const arg = subArgs[i];
    if (arg === "--json") continue;
    if (arg === "--stdin") {
      if (input.fromStdin) throw new ActionDockError(INVALID_ARGUMENT, "Duplicate --stdin option");
      input.fromStdin = true;
      continue;
    }

    const equals = arg.indexOf("=");
    const option = equals < 0 ? arg : arg.slice(0, equals);
    if (option === "--stdin-field" || (isState && ["-n", "--namespace", "--ttl"].includes(option))) {
      const value = equals < 0 ? subArgs[++i] : arg.slice(equals + 1);
      if (value === undefined) {
        throw new ActionDockError(INVALID_ARGUMENT, `Option '${option}' requires a value`);
      }
      if (option === "--stdin-field") {
        if (input.stdinField !== undefined) {
          throw new ActionDockError(INVALID_ARGUMENT, "Duplicate --stdin-field option");
        }
        input.stdinField = value;
      } else if (option === "--ttl") {
        ttl = parseInt(value, 10);
      } else {
        namespace = value;
      }
    } else if (arg.startsWith("-") && !/^-\d/.test(arg)) {
      throw new ActionDockError(INVALID_ARGUMENT, "Unknown set option");
    } else {
      positional.push(arg);
      if (positional.length > 2) {
        throw new ActionDockError(INVALID_ARGUMENT, "Only one complete positional value is allowed");
      }
    }
  }

  if (!positional[0]) throw new ActionDockError(INVALID_ARGUMENT, "Key is required");
  input.value = positional[1];
  return { key: positional[0], input, namespace, ttl };
}

export async function handleConfig(
  ctx: CommandContext,
  subArgs: string[],
  flatArgs?: string[],
  signal?: AbortSignal,
  stdin?: NodeJS.ReadableStream
): Promise<number> {
  const sub = subArgs[0] || "list";

  if (!ctx.service.management) {
    ctx.writeErr("Error: management port is not enabled on this service");
    return ExitCode.FAILURE;
  }

  if (sub === "list") {
    const views = await ctx.service.management.config.list(ctx.options.packageId);
    const dict: Record<string, unknown> = Object.create(null);
    for (const v of views) {
      if (v.configured) {
        if (v.secret && v.value === undefined) {
          dict[v.key] = "********";
        } else if (v.value !== undefined) {
          dict[v.key] = v.value;
        }
      }
    }
    ctx.writeOut(JSON.stringify(dict, null, 2));
    return ExitCode.SUCCESS;
  }

  if (sub === "get") {
    const key = subArgs[1];
    if (!key) {
      ctx.writeErr("Error: config key required");
      return ExitCode.INVALID_ARGUMENT;
    }
    try {
      const item = await ctx.service.management.config.get(ctx.options.packageId, key);
      if (item.redactedPaths.includes("") || (item.configured && item.value === undefined)) {
        ctx.writeOut("<hidden>");
      } else if (item.value === undefined) {
        ctx.writeOut("<not configured>");
      } else {
        ctx.writeOut(JSON.stringify(item.value));
      }
      return ExitCode.SUCCESS;
    } catch (err: any) {
      if (isServiceCapabilityError(err)) {
        ctx.writeOut("undefined");
        return ExitCode.SUCCESS;
      }
      ctx.writeErr(`Error reading config '${key}': ${err?.message || String(err)}`);
      return ExitCode.FAILURE;
    }
  }

  if (sub === "set") {
    let parsed: ReturnType<typeof parseSetInput>;
    let value: JsonValue;
    try {
      parsed = parseSetInput(subArgs, false);
      assertConcreteConfigKey(parsed.key);
      value = await resolveValueInput({
        ...parsed.input,
        flatArgs,
        signal,
        stdin,
        policy: { sanitizeInputErrors: true },
      });
      signal?.throwIfAborted();
    } catch (err: any) {
      return ctx.emitError(subArgs.includes("--json"), err?.code || "INVALID_ARGUMENT", err?.message || String(err), ExitCode.INVALID_ARGUMENT, {
        details: err?.details,
      });
    }
    await ctx.service.management.config.set(ctx.options.packageId, parsed.key, value);
    ctx.writeOut(`Config '${parsed.key}' updated`);
    return ExitCode.SUCCESS;
  }

  if (sub === "delete") {
    const key = subArgs[1];
    if (!key) {
      ctx.writeErr("Error: config key required");
      return ExitCode.INVALID_ARGUMENT;
    }
    await ctx.service.management.config.delete(ctx.options.packageId, key);
    ctx.writeOut(`Config '${key}' deleted`);
    return ExitCode.SUCCESS;
  }

  ctx.writeErr(`Unknown config subcommand: '${sub}'`);
  return ExitCode.INVALID_ARGUMENT;
}

function decodeStateKeyArg(key: string): { namespace: string; key: string } {
  try {
    return decodeStateKey(key);
  } catch {
    return { namespace: "", key };
  }
}

export async function handleState(
  ctx: CommandContext,
  subArgs: string[],
  flatArgs?: string[],
  signal?: AbortSignal,
  stdin?: NodeJS.ReadableStream
): Promise<number> {
  const sub = subArgs[0] || "list";
  let namespace: string | undefined;
  let isAll = false;
  let isJson = false;

  if (!ctx.service.management) {
    ctx.writeErr("Error: management port is not enabled on this service");
    return ExitCode.FAILURE;
  }

  for (let i = 1; i < subArgs.length; i++) {
    if ((subArgs[i] === "-n" || subArgs[i] === "--namespace") && i + 1 < subArgs.length) {
      namespace = subArgs[++i];
    } else if (subArgs[i].startsWith("--namespace=")) {
      namespace = subArgs[i].slice(12);
    } else if (subArgs[i] === "-a" || subArgs[i] === "--all") {
      isAll = true;
    } else if (subArgs[i] === "--json") {
      isJson = true;
    }
  }

  if (sub === "list") {
    const prefix = subArgs[1] && !subArgs[1].startsWith("-") ? subArgs[1] : "";
    const keys = await ctx.service.management.state.list(ctx.options.packageId, "", {
      namespace: (namespace !== undefined ? namespace : null) as any,
      prefix: prefix || undefined,
      all: isAll,
    });
    ctx.writeOut(JSON.stringify(keys, null, 2));
    return ExitCode.SUCCESS;
  }

  if (sub === "get") {
    const key = subArgs[1] && !subArgs[1].startsWith("-") ? subArgs[1] : subArgs[2];
    if (!key) {
      ctx.writeErr("Error: state key required");
      return ExitCode.INVALID_ARGUMENT;
    }
    let ns = namespace;
    let actualKey = key;
    if (ns === undefined) {
      const decoded = decodeStateKeyArg(key);
      ns = decoded.namespace || undefined;
      actualKey = decoded.key;
    }
    const val = await ctx.service.management.state.get(ctx.options.packageId, "", actualKey, { namespace: ns });
    if (isJson) {
      ctx.writeOut(JSON.stringify({ key, value: val }, null, 2));
    } else {
      ctx.writeOut(val !== undefined ? JSON.stringify(val) : "undefined");
    }
    return ExitCode.SUCCESS;
  }

  if (sub === "set") {
    let parsed: ReturnType<typeof parseSetInput>;
    let value: JsonValue;
    try {
      parsed = parseSetInput(subArgs, true);
      value = await resolveValueInput({
        ...parsed.input,
        flatArgs,
        signal,
        stdin,
        policy: { sanitizeInputErrors: true },
      });
      signal?.throwIfAborted();
    } catch (err: any) {
      return ctx.emitError(isJson, err?.code || "INVALID_ARGUMENT", err?.message || String(err), ExitCode.INVALID_ARGUMENT, {
        details: err?.details,
      });
    }

    let ns = parsed.namespace || "";
    let actualKey = parsed.key;
    if (parsed.namespace === undefined) {
      const decoded = decodeStateKeyArg(parsed.key);
      ns = decoded.namespace;
      actualKey = decoded.key;
    }

    await ctx.service.management.state.set(ctx.options.packageId, "", actualKey, value, { namespace: ns, ttl: parsed.ttl });
    const displayKey = ns ? `${ns}:${actualKey}` : actualKey;
    ctx.writeOut(`State '${displayKey}' updated`);
    return ExitCode.SUCCESS;
  }

  if (sub === "delete" || sub === "rm") {
    const key = subArgs[1] && !subArgs[1].startsWith("-") ? subArgs[1] : subArgs[2];
    if (!key) {
      ctx.writeErr("Error: state key required");
      return ExitCode.INVALID_ARGUMENT;
    }
    let ns = namespace;
    let actualKey = key;
    if (ns === undefined) {
      const decoded = decodeStateKeyArg(key);
      ns = decoded.namespace || undefined;
      actualKey = decoded.key;
    }
    const deleted = await ctx.service.management.state.delete(ctx.options.packageId, "", actualKey, { namespace: ns });
    if (deleted) {
      ctx.writeOut(`State '${key}' deleted`);
      return ExitCode.SUCCESS;
    }
    ctx.writeErr(`Error: State key '${key}' not found`);
    return ExitCode.FAILURE;
  }

  if (sub === "clear" || sub === "clean") {
    const prefix = subArgs[1] && !subArgs[1].startsWith("-") ? subArgs[1] : "";
    const count = await ctx.service.management.state.clear(ctx.options.packageId, "", {
      namespace,
      all: isAll,
      prefix: prefix || undefined,
    });
    ctx.writeOut(`Cleared ${count} state entry(s)`);
    return ExitCode.SUCCESS;
  }

  ctx.writeErr(`Unknown state subcommand: '${sub}'`);
  return ExitCode.INVALID_ARGUMENT;
}
