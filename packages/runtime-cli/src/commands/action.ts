import { existsSync, readFileSync } from "node:fs";
import {
  ActionRunner,
  createStorage,
  executeRemoteAction,
  fetchRemoteActions,
  fetchRemoteActionShow,
  filterWithFallbackInfo,
  findProjectRoot,
  listLinkedPackages,
  loadActions,
  loadProjectConfig,
  parseDuration,
  resolveActionProject,
  resolveTarget,
  validateSchema,
} from "@actiondock/core";
import { Command } from "commander";
import { ArgumentError, ExecutionError, SigintError } from "../errors";
import {
  renderActionDetail,
  renderActionList,
  renderActionValidation,
  renderResult,
  writeStdout,
} from "../renderer";
import type { RuntimeCliContext } from "../types";
import { getEffectiveOptions, resolveIntent } from "../utils";

/**
 * 统一执行 Action 核心逻辑。
 */
export async function executeAction(
  id: string,
  options: any,
  context?: RuntimeCliContext
): Promise<void> {
  if (!id) {
    throw new ArgumentError("Action ID is required for run");
  }

  let input: unknown = {};
  if (options.input) {
    try {
      input = JSON.parse(options.input);
    } catch (err: any) {
      throw new ArgumentError(`Error parsing --input JSON: ${err.message}`);
    }
  } else if (options.inputFile) {
    try {
      input = JSON.parse(readFileSync(options.inputFile, "utf-8"));
    } catch (err: any) {
      throw new ArgumentError(`Error reading --input-file: ${err.message}`);
    }
  }

  let timeoutMs: number | undefined;
  if (options.timeout) {
    try {
      timeoutMs = parseDuration(options.timeout);
    } catch (err: any) {
      throw new ArgumentError(`Invalid timeout format: ${err.message}`);
    }
  }

  const configOverrides: Record<string, unknown> = {};
  if (options.config) {
    const list = Array.isArray(options.config) ? options.config : [options.config];
    for (const item of list) {
      const [k, ...v] = item.split("=");
      if (k) configOverrides[k] = v.join("=");
    }
  }

  const controller = new AbortController();
  let receivedSigint = false;
  const sigintHandler = () => {
    receivedSigint = true;
    controller.abort(new Error("Interrupted by SIGINT"));
  };
  process.once("SIGINT", sigintHandler);

  try {
    // 1. 独立运行模式分支
    if (context?.standalone) {
      if (options.async) {
        throw new ArgumentError(
          "Async execution is not supported in standalone single-execution binaries."
        );
      }

      const sa = context.standalone;
      const actionsMap =
        sa.actions instanceof Map
          ? sa.actions
          : new Map(sa.actions.map((a) => [a.id, a]));

      const storage = createStorage(sa.packageId, {
        dataDir: options.dataDir || context.dataDir,
      });

      const runner = new ActionRunner({
        packageId: sa.packageId,
        storage,
        configOverrides,
        projectConfig: {
          id: sa.packageId,
          name: sa.packageId,
          version: sa.version,
          description: sa.description,
          config: sa.configDefs,
        },
        actions: actionsMap,
      });

      try {
        const result = await runner.execute(id, input, {
          signal: controller.signal,
          timeoutMs,
        });

        // 无论何种模式，run 输出标准信封
        writeStdout(JSON.stringify(result, null, 2), context);

        if (!result.ok) {
          throw new ExecutionError(
            result.error?.message || `Action '${id}' execution failed`,
            result.error
          );
        }
        return;
      } finally {
        storage.close();
      }
    }

    // 2. 远端服务目标执行分支
    const target = resolveTarget({
      profile: options.profile,
      server: options.server,
      token: options.token,
    });

    if (target.type === "remote") {
      const result = await executeRemoteAction(target.serverUrl!, id, input, {
        configOverrides,
        token: target.token,
        timeoutMs,
        signal: controller.signal,
        async: Boolean(options.async),
      });

      writeStdout(JSON.stringify(result, null, 2), context);

      if (!result.ok) {
        throw new ExecutionError(
          result.error?.message || `Remote action '${id}' execution failed`,
          result.error
        );
      }
      return;
    }

    // 3. 本地环境执行分支
    if (options.async) {
      throw new ArgumentError(
        "Async execution requires a long-running ActionDock server.\nUse --profile, --server, or start 'ad serve'."
      );
    }

    const resolved = await resolveActionProject(id);
    const config = loadProjectConfig(resolved.projectRoot);
    const actions = await loadActions(resolved.projectRoot, config.actionsDir);
    const storage = createStorage(config.id, {
      projectRoot: resolved.projectRoot,
      dataDir: options.dataDir || context?.dataDir,
    });

    try {
      const runner = new ActionRunner({
        packageId: config.id,
        storage,
        projectConfig: config,
        configOverrides,
        actions,
      });

      const result = await runner.execute(resolved.actionId, input, {
        signal: controller.signal,
        timeoutMs,
      });

      writeStdout(JSON.stringify(result, null, 2), context);

      if (!result.ok) {
        throw new ExecutionError(
          result.error?.message || `Action '${id}' execution failed`,
          result.error
        );
      }
    } finally {
      storage.close();
    }
  } catch (err: any) {
    if (receivedSigint || err?.name === "AbortError" || err?.message?.includes("SIGINT")) {
      throw new SigintError();
    }
    throw err;
  } finally {
    process.removeListener("SIGINT", sigintHandler);
  }
}

/**
 * 注册 Action 动作相关命令（list, show, validate, run 及根 run 别名）。
 * 
 * @param program Commander 实例
 * @param context 运行时上下文
 */
export function registerActionCommands(program: Command, context?: RuntimeCliContext): void {
  const actionCmd = program
    .command("action")
    .description("Manage and execute Actions");

  // action list
  actionCmd
    .command("list [patterns...]")
    .description("List actions in current project, linked packages, or remote profile")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("-p, --profile <name>", "Execute or query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (patterns: string[] = [], rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const effectiveIntent = resolveIntent(options.intent, patterns);
      const shouldFallback = options.fallback !== false;

      // 1. 独立运行模式
      if (context?.standalone) {
        const sa = context.standalone;
        const actionsMap =
          sa.actions instanceof Map
            ? sa.actions
            : new Map(sa.actions.map((a) => [a.id, a]));

        const rawList = Array.from(actionsMap.values()).map((a) => ({
          id: a.id,
          description: a.description || "",
          packageId: sa.packageId,
        }));

        const filterRes = filterWithFallbackInfo(
          rawList,
          effectiveIntent,
          [(a) => a.id, (a) => a.description],
          shouldFallback
        );

        renderResult(filterRes.items, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            renderActionList(
              filterRes.items,
              `Actions in ${sa.packageId} (v${sa.version})`,
              filterRes.isFallback,
              effectiveIntent
            ),
          context,
        });
        return;
      }

      // 2. 远端服务分支
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      });

      if (target.type === "remote") {
        let list = await fetchRemoteActions(target.serverUrl!, target.token, effectiveIntent);
        let isFallback = false;
        if (list.length === 0 && effectiveIntent && shouldFallback) {
          list = await fetchRemoteActions(target.serverUrl!, target.token);
          isFallback = true;
        }

        renderResult(list, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            renderActionList(
              list,
              `Actions on remote server ${target.serverUrl}${target.profileName ? ` (Profile: ${target.profileName})` : ""}`,
              isFallback,
              effectiveIntent
            ),
          context,
        });
        return;
      }

      // 3. 本地工程或全局已链接包分支
      const root = findProjectRoot();
      if (root) {
        const config = loadProjectConfig(root);
        const actions = await loadActions(root, config.actionsDir);
        const rawList = Array.from(actions.values()).map((a) => ({
          id: a.id,
          description: a.description || "",
          packageId: config.id,
        }));

        const filterRes = filterWithFallbackInfo(
          rawList,
          effectiveIntent,
          [(a) => a.id, (a) => a.description, (a) => a.packageId],
          shouldFallback
        );

        renderResult(filterRes.items, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            renderActionList(
              filterRes.items,
              `Actions in ${config.id} (${root})`,
              filterRes.isFallback,
              effectiveIntent
            ),
          context,
        });
        return;
      }

      // 扫描所有链接的包
      const linkedList = listLinkedPackages();
      if (linkedList.length === 0) {
        renderResult(
          [],
          {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () =>
              "No ActionDock project in current directory, and no packages linked.\nRun 'ad link' inside an Action package to register it.",
            context,
          }
        );
        return;
      }

      const aggregated: Array<{
        packageId: string;
        packageName: string;
        path: string;
        actions: Array<{ id: string; description: string }>;
      }> = [];

      for (const pkg of linkedList) {
        if (!existsSync(pkg.path)) continue;
        try {
          const config = loadProjectConfig(pkg.path);
          const actions = await loadActions(pkg.path, config.actionsDir);
          const pkgActions = Array.from(actions.values()).map((a) => ({
            id: a.id,
            description: a.description || "",
          }));

          aggregated.push({
            packageId: pkg.id,
            packageName: pkg.name,
            path: pkg.path,
            actions: pkgActions,
          });
        } catch {
          // 忽略失效链接
        }
      }

      let filteredPackages: typeof aggregated = [];
      if (!effectiveIntent) {
        filteredPackages = aggregated;
      } else {
        for (const pkg of aggregated) {
          const pkgMatches =
            filterWithFallbackInfo(
              [pkg],
              effectiveIntent,
              [(p) => p.packageId, (p) => p.packageName, (p) => p.path],
              false
            ).matchedCount > 0;

          if (pkgMatches) {
            filteredPackages.push(pkg);
          } else {
            const matchedActions = filterWithFallbackInfo(
              pkg.actions,
              effectiveIntent,
              [(a) => a.id, (a) => a.description],
              false
            ).items;

            if (matchedActions.length > 0) {
              filteredPackages.push({
                ...pkg,
                actions: matchedActions,
              });
            }
          }
        }

        if (filteredPackages.length === 0 && shouldFallback) {
          filteredPackages = aggregated;
        }
      }

      renderResult(filteredPackages, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () => {
          const lines: string[] = ["Linked Action Packages:\n"];
          for (const pkg of filteredPackages) {
            lines.push(`- Package: ${pkg.packageId} (${pkg.path})`);
            for (const a of pkg.actions) {
              lines.push(`    - ${a.id.padEnd(26)} ${a.description}`);
            }
          }
          return lines.join("\n");
        },
        context,
      });
    });

  // action show / describe
  actionCmd
    .command("show <id>")
    .alias("describe")
    .description("Show action definition, schema, and description")
    .option("-p, --profile <name>", "Execute or query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (id: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!id) {
        throw new ArgumentError("Action ID is required for show/describe");
      }

      // 1. 独立运行模式
      if (context?.standalone) {
        const sa = context.standalone;
        const actionsMap =
          sa.actions instanceof Map
            ? sa.actions
            : new Map(sa.actions.map((a) => [a.id, a]));

        const action = actionsMap.get(id);
        if (!action) {
          throw new ExecutionError(`Action '${id}' not found in package '${sa.packageId}'`);
        }

        const detail = {
          id: action.id,
          packageId: sa.packageId,
          description: action.description,
          inputSchema: action.inputSchema,
          outputSchema: action.outputSchema,
        };

        renderResult(detail, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderActionDetail(detail),
          context,
        });
        return;
      }

      // 2. 远端服务模式
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      });

      if (target.type === "remote") {
        const detail = await fetchRemoteActionShow(target.serverUrl!, id, target.token);
        renderResult(detail, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderActionDetail(detail),
          context,
        });
        return;
      }

      // 3. 本地工程模式
      const resolved = await resolveActionProject(id);
      const config = loadProjectConfig(resolved.projectRoot);
      const actions = await loadActions(resolved.projectRoot, config.actionsDir);
      const action = actions.get(resolved.actionId);

      if (!action) {
        throw new ExecutionError(
          `Action '${resolved.actionId}' not found in package '${resolved.packageId}'`
        );
      }

      const detail = {
        id: action.id,
        packageId: resolved.packageId,
        projectRoot: resolved.projectRoot,
        description: action.description,
        inputSchema: action.inputSchema,
        outputSchema: action.outputSchema,
      };

      renderResult(detail, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () => renderActionDetail(detail),
        context,
      });
    });

  // action validate
  actionCmd
    .command("validate [id]")
    .description("Validate action schemas and definitions")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (id: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      let toValidate: any[] = [];

      if (context?.standalone) {
        const sa = context.standalone;
        const actionsMap =
          sa.actions instanceof Map
            ? sa.actions
            : new Map(sa.actions.map((a) => [a.id, a]));

        if (id) {
          const act = actionsMap.get(id);
          if (!act) {
            throw new ExecutionError(`Action '${id}' not found in standalone package`);
          }
          toValidate = [act];
        } else {
          toValidate = Array.from(actionsMap.values());
        }
      } else {
        const root = findProjectRoot();
        if (!root) {
          throw new ArgumentError("Not in an ActionDock project (actiondock.json not found)");
        }
        const config = loadProjectConfig(root);
        const actions = await loadActions(root, config.actionsDir);

        if (id) {
          const act = actions.get(id);
          if (!act) {
            throw new ExecutionError(`Action '${id}' not found in project`);
          }
          toValidate = [act];
        } else {
          toValidate = Array.from(actions.values());
        }
      }

      const results: Array<{ id: string; valid: boolean; errors: string[] }> = [];

      for (const act of toValidate) {
        const errors: string[] = [];
        if (!act.id) errors.push("Missing id property");
        if (!act.run || typeof act.run !== "function") errors.push("Missing run method");
        if (act.inputSchema && typeof act.inputSchema !== "object") {
          errors.push("Invalid inputSchema object");
        }
        if (act.outputSchema && typeof act.outputSchema !== "object") {
          errors.push("Invalid outputSchema object");
        }
        results.push({
          id: act.id,
          valid: errors.length === 0,
          errors,
        });
      }

      const allValid = results.every((r) => r.valid);
      const validationPayload = { valid: allValid, results };

      renderResult(validationPayload, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () => renderActionValidation(results),
        context,
      });

      if (!allValid) {
        throw new ExecutionError("Action schema validation failed", results);
      }
    });

  // action run
  actionCmd
    .command("run <id>")
    .description("Execute an action (from current project, linked packages, or remote profile)")
    .option("-i, --input <json>", "Input as JSON string")
    .option("-f, --input-file <path>", "Input from JSON file")
    .option("-c, --config <key=value...>", "Temporary config override (repeatable)")
    .option("-p, --profile <name>", "Execute against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--timeout <duration>", "Execution timeout (e.g. 30s, 5m, 500ms)")
    .option("--async", "Execute asynchronously in background (requires remote server or profile)")
    .option("--data-dir <path>", "Custom database directory")
    .action(async (id: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      await executeAction(id, options, context);
    });

  // 顶层 run 别名: ad run <id>
  program
    .command("run <id>")
    .description("Alias for 'ad action run <id>'")
    .option("-i, --input <json>", "Input as JSON string")
    .option("-f, --input-file <path>", "Input from JSON file")
    .option("-c, --config <key=value...>", "Temporary config override")
    .option("-p, --profile <name>", "Execute against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--timeout <duration>", "Execution timeout (e.g. 30s, 5m, 500ms)")
    .option("--async", "Execute asynchronously in background (requires remote server or profile)")
    .option("--data-dir <path>", "Custom database directory")
    .action(async (id: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      await executeAction(id, options, context);
    });
}
