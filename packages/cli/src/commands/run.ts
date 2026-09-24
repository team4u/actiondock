import {
  validateActionInputValue,
  mapInputValidationFailure,
} from "@actiondock/core/project";
import {
  resolveTarget,
} from "@actiondock/core/profile";
import {
  type InvocationControl,
} from "@actiondock/core/server";
import {
  ACTION_CANCELLED,
} from "@actiondock/core";
import type { ExecutionResult, JsonValue } from "@actiondock/sdk";
import { Command } from "commander";
import { ArgumentError, ExecutionError, SigintError, packageNotFoundError } from "../errors";
import { writeStderr, writeStdout } from "../renderer";
import type { CliContext } from "../types";
import {
  applyTargetOptions,
  getEffectiveOptions,
  resolveActionInput,
  resolveLocalPackageRoot,
  resolveTimeoutMs,
  withService,
} from "../utils";

/**
 * 以原始纯文本形式渲染 Action 执行终态结果（默认纯文本模式）。
 *
 * 设计契约：
 * 1. stdout: 仅承载业务有效载荷（payload）。保持原生排版、未转义多行与真实换行，供用户阅读或下游管道直接消费。
 */
export function renderRawExecutionResult(
  targetRef: string,
  result: ExecutionResult,
  context?: CliContext
): void {
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
      const title = metaInfo.path ? String(metaInfo.path) : targetRef;
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
        writeStderr(`[${parts.join(" | ")}]`, context);
      }
    }

    writeStdout(rawText, context);
  } else {
    writeStderr(`Error [${result.error.code}]: ${result.error.message}`, context);
    if (result.error.details) {
      writeStderr(
        typeof result.error.details === "string"
          ? result.error.details
          : JSON.stringify(result.error.details, null, 2),
        context
      );
    }
    if (context) {
      context.exitCode = 1;
    }
    if (!context?.control) {
      process.exitCode = 1;
    }
  }
}

/**
 * 统一执行 Action 核心逻辑（使用 ActionDockService 服务端口）。
 * 
 * @param id 目标 Action 标识
 * @param options 执行选项（由 Command 统一构造）
 */
export async function executeAction(
  id: string,
  options: any,
  context?: CliContext,
  flatArgs?: string[],
  control?: InvocationControl
): Promise<void> {
  if (!id) {
    throw new ArgumentError("Action ID is required for run");
  }

  const effectiveControl = control ?? context?.control;
  const effectiveSignal = effectiveControl?.signal;

  const effectiveFlatArgs = flatArgs ?? options.flatArgs;
  const input = await resolveActionInput({
    input: options.input,
    inputFile: options.inputFile,
    flatArgs: effectiveFlatArgs && effectiveFlatArgs.length > 0 ? effectiveFlatArgs : undefined,
    stdin: context?.stdin,
  });

  const check = validateActionInputValue(input);
  if (!check.valid) {
    throw mapInputValidationFailure("cli-pre-target", check);
  }

  const timeoutMs = resolveTimeoutMs(options.timeout);

  const configOverrides: Record<string, JsonValue> = {};
  if (options.config) {
    const list = Array.isArray(options.config) ? options.config : [options.config];
    for (const item of list) {
      const [k, ...v] = item.split("=");
      if (k) configOverrides[k] = v.join("=");
    }
  }

  try {
    // 异步执行仅支持远端目标，本地模式直接拒绝
    const resolvedTopology = resolveTarget(
      {
        profile: options.profile,
        server: options.server,
        token: options.token,
        insecure: options.insecure,
      },
      context?.customHome
    );
    if (resolvedTopology.type === "local" && options.async) {
      throw new ExecutionError(
        "Async execution requires a long-running ActionDock server.\nUse --profile, --server, or start 'ad serve'."
      );
    }

    // 目标拓扑解析（仅 local 分支需要包寻址）
    const targetPackageRoot = resolveLocalPackageRoot(options.package);
    if (options.package && !targetPackageRoot) {
      throw packageNotFoundError(options.package);
    }

    let targetRef = id;
    if (options.package && !id.includes("/")) {
      targetRef = `${options.package}/${id}`;
    }

    // 通过 Service 统一执行
    await withService(
      options,
      context,
      async (service) => {
        const isMachine = Boolean(options.json);

        if (options.async) {
          const ticket = await service.execution.start(targetRef, input as JsonValue, {
            signal: effectiveSignal,
            timeoutMs,
            config: configOverrides,
            requestId: options.requestId,
          });

          if (isMachine) {
            const asyncOutput = {
              ok: ticket.status !== "failed",
              runId: ticket.runId,
              status: ticket.status,
            };
            writeStdout(JSON.stringify(asyncOutput, null, 2), context);
          } else {
            writeStderr(`[${ticket.status}] runId: ${ticket.runId}`, context);
            writeStdout(ticket.runId, context);
          }

          if (ticket.status === "failed") {
            if (context) {
              context.exitCode = 1;
            }
            return;
          }
        } else {
          const result = await service.execution.run(targetRef, input as JsonValue, {
            signal: effectiveSignal,
            timeoutMs,
            config: configOverrides,
            requestId: options.requestId,
          });

          if (
            effectiveControl?.cancellationSource === "sigint" &&
            (effectiveSignal?.aborted || (!result.ok && result.error?.code === "ACTION_CANCELLED"))
          ) {
            throw new SigintError();
          }

          if (isMachine) {
            writeStdout(JSON.stringify(result, null, 2), context);
          } else {
            renderRawExecutionResult(targetRef, result, context);
          }

          if (!result.ok) {
            if (context) {
              context.exitCode = 1;
            }
            return;
          }
        }
      },
      { localRoot: targetPackageRoot || undefined, scanLinkedPackages: true, ownDataDir: true }
    );
  } catch (err: any) {
    // sigint 取消源、中断链路特征错误码或 SigintError 本身，均统一归并为 SigintError
    // 原 if 中额外的「cancellationSource 为 sigint 且 AbortError/aborted/ACTION_CANCELLED」
    // 子句被首项 cancellationSource === "sigint" 完全蕴含，等价化简后移除
    const isSigint =
      effectiveControl?.cancellationSource === "sigint" ||
      err?.code === "SIGINT_INTERRUPTED" ||
      err instanceof SigintError;
    if (isSigint) {
      throw new SigintError();
    }
    throw err;
  }
}

/**
 * 挂载 run 子命令至指定 Commander 节点。
 * 
 * @param parent 目标 Commander 命令节点
 * @param context 命令行上下文
 */
export function attachRunCommand(parent: Command, context?: CliContext): Command {
  const cmd = parent
    .command("run <id> [params...]")
    .description("Execute an action (from current project, linked packages, or remote profile)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-i, --input <json>", "Action input as inline JSON")
    .option("-f, --input-file <path>", "Action input from JSON file, or '-' for stdin")
    .option("-c, --config <key=value...>", "Temporary config override (repeatable)");

  return applyTargetOptions(cmd)
    .option("--timeout <duration>", "Execution timeout (e.g. 30s, 5m, 500ms)")
    .option("--request-id <id>", "Idempotency request ID for deduplication")
    .option("--async", "Execute asynchronously in background (requires remote server or profile)")
    .option("--data-dir <path>", "Custom database directory")
    .option("--json", "Output as JSON")
    .action(async (id: string, params: string[] | any, rawOptions: any, cmd: any) => {
      let flatArgs: string[] | undefined;
      let effectiveRawOptions = rawOptions;
      let effectiveCmd = cmd;
      if (Array.isArray(params)) {
        flatArgs = params.length > 0 ? params : undefined;
      } else {
        effectiveCmd = rawOptions;
        effectiveRawOptions = params;
      }
      const options = getEffectiveOptions(effectiveRawOptions, effectiveCmd);
      await executeAction(id, { ...options, flatArgs }, context, undefined, context?.control);
    });
}

/**
 * 注册顶层统一 run 命令：执行指定 Action。
 * 
 * @param program Commander 根程序对象
 * @param context 命令行上下文
 */
export function registerRunCommand(program: Command, context?: CliContext): void {
  attachRunCommand(program, context);
}
