import {
  createActionDockTarget,
  filterWithFallbackInfo,
  findProjectRoot,
  listLinkedPackages,
  loadProjectConfig,
  resolvePackageRoot,
  resolveTarget,
} from "@actiondock/core";
import { Command } from "commander";
import { ArgumentError, ExecutionError } from "../errors";
import { renderResult, renderRunDetail, renderRunsList } from "../renderer";
import type { CliContext } from "../types";
import { getEffectiveOptions, resolveIntent } from "../utils";

/**
 * 注册 runs 动作执行历史管理命令（list、show、clear、cancel）。
 * 
 * @param program Commander 实例
 * @param context 命令行上下文
 */
export function registerRunsCommands(program: Command, context?: CliContext): void {
  const runsCmd = program
    .command("runs")
    .description("Inspect action execution history");

  // runs list
  runsCmd
    .command("list [patterns...]")
    .description("List recent execution records")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("-a, --action <actionId>", "Filter by action ID")
    .option("-n, --limit <count>", "Maximum number of records to return", "20")
    .option("-p, --profile <name>", "Query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (patterns: string[] = [], rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const effectiveIntent = resolveIntent(options.intent, patterns);
      const shouldFallback = options.fallback !== false;
      const limit = Number.parseInt(options.limit, 10) || 20;

      // 1. 目标解析
      const resolved = resolveTarget(
        {
          profile: options.profile,
          server: options.server,
          token: options.token,
        },
        context?.customHome
      );

      let targetPackageRoot: string | undefined;
      let projConfig: any = null;
      if (resolved.type === "local") {
        if (options.package) {
          const root = resolvePackageRoot(options.package);
          if (!root) {
            throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
          }
          targetPackageRoot = root;
        } else {
          targetPackageRoot = findProjectRoot() || undefined;
        }
        if (targetPackageRoot) {
          try {
            projConfig = loadProjectConfig(targetPackageRoot);
          } catch {}
        }
      }

      // 2. 通过 Target 门面统一访问
      const target = await createActionDockTarget(
        resolved.type === "remote"
          ? {
              type: "remote",
              serverUrl: resolved.serverUrl!,
              token: resolved.token,
            }
          : {
              type: "local",
              projectRoot: targetPackageRoot,
              customHome: context?.customHome,
              dataDir: options.dataDir || context?.dataDir,
              scanLinkedPackages: true,
            }
      );

      try {
        const records = await target.listRuns({
          packageId: projConfig?.id || options.package,
          actionId: options.action,
          intent: effectiveIntent,
          limit,
        });

        // 若处于本地无项目环境且无任何软链接包，则直接输出友好提示
        if (resolved.type === "local" && !targetPackageRoot) {
          const linked = listLinkedPackages(context?.customHome);
          if (linked.length === 0) {
            renderResult([], {
              json: options.json,
              envelope: options.envelope,
              humanFormatter: () => "No ActionDock project in current directory, and no packages linked.",
              context,
            });
            return;
          }
        }

        const filterRes = filterWithFallbackInfo(
          records,
          effectiveIntent,
          [(r) => r.id, (r) => r.actionId, (r) => (r as any).packageId, (r) => r.status, (r) => r.error?.message],
          shouldFallback
        );

        const capped = filterRes.items.slice(0, limit);

        renderResult(capped, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => {
            let title = "Execution Runs";
            if (resolved.type === "remote") {
              title = `Execution Runs on remote server ${resolved.serverUrl}${resolved.profileName ? ` (Profile: ${resolved.profileName})` : ""}`;
            } else if (projConfig) {
              title = `Execution Runs in ${projConfig.name} (${projConfig.id})`;
            } else {
              title = "Execution Runs (Linked Packages)";
            }
            return renderRunsList(capped, title, filterRes.isFallback, effectiveIntent);
          },
          context,
        });
      } finally {
        await target.close();
      }
    });

  // runs show <id>
  runsCmd
    .command("show <id>")
    .description("Show details of a specific execution run")
    .option("-p, --profile <name>", "Query run against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("-P, --package <id>", "Target package ID or path")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (id: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!id) {
        throw new ArgumentError("Run ID is required");
      }

      // 1. 目标解析
      const resolved = resolveTarget(
        {
          profile: options.profile,
          server: options.server,
          token: options.token,
        },
        context?.customHome
      );

      let targetPackageRoot: string | undefined;
      let projConfig: any = null;
      if (resolved.type === "local") {
        if (options.package) {
          const root = resolvePackageRoot(options.package);
          if (!root) {
            throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
          }
          targetPackageRoot = root;
        } else {
          targetPackageRoot = findProjectRoot() || undefined;
        }
        if (targetPackageRoot) {
          try {
            projConfig = loadProjectConfig(targetPackageRoot);
          } catch {}
        }
      }

      // 2. 通过 Target 门面统一查询
      const target = await createActionDockTarget(
        resolved.type === "remote"
          ? {
              type: "remote",
              serverUrl: resolved.serverUrl!,
              token: resolved.token,
            }
          : {
              type: "local",
              projectRoot: targetPackageRoot,
              customHome: context?.customHome,
              dataDir: options.dataDir || context?.dataDir,
              scanLinkedPackages: true,
            }
      );

      try {
        const run = await target.getRun(id);
        if (!run) {
          if (resolved.type === "remote") {
            throw new ExecutionError(`Run record '${id}' not found on remote server`);
          } else if (options.package) {
            throw new ExecutionError(`Run record '${id}' not found in package '${projConfig?.id || options.package}'`);
          } else {
            throw new ExecutionError(`Run record '${id}' not found in current project or any linked packages`);
          }
        }

        renderResult(run, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderRunDetail(run),
          context,
        });
      } finally {
        await target.close();
      }
    });

  // runs cancel
  runsCmd
    .command("cancel <id>")
    .description("Cancel a running action execution on a remote server")
    .option("-p, --profile <name>", "Execute cancel against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("-r, --reason <reason>", "Reason for cancellation")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (id: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!id) {
        throw new ArgumentError("Run ID is required for cancel");
      }

      const resolved = resolveTarget(
        {
          profile: options.profile,
          server: options.server,
          token: options.token,
        },
        context?.customHome
      );

      if (resolved.type === "local") {
        throw new ArgumentError(
          "'ad runs cancel' is only supported for remote execution targets. Use --profile <name> or --server <url>."
        );
      }

      const target = await createActionDockTarget({
        type: "remote",
        serverUrl: resolved.serverUrl!,
        token: resolved.token,
      });

      try {
        const result = await target.cancelRun(id, options.reason);
        renderResult(result, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            `Run '${id}' cancellation requested (Status: ${(result as any).status || result.outcome}).`,
          context,
        });
      } finally {
        await target.close();
      }
    });

  // runs clear
  runsCmd
    .command("clear")
    .description("Clear execution run records")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-a, --action <actionId>", "Filter by action ID")
    .option("-p, --profile <name>", "Target profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);

      const resolved = resolveTarget(
        {
          profile: options.profile,
          server: options.server,
          token: options.token,
        },
        context?.customHome
      );

      let targetPackageRoot: string | undefined;
      let packageId = options.package;
      if (resolved.type === "local") {
        if (options.package) {
          const root = resolvePackageRoot(options.package);
          if (!root) {
            throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
          }
          targetPackageRoot = root;
        } else {
          targetPackageRoot = findProjectRoot() || undefined;
          if (!targetPackageRoot) {
            throw new ArgumentError(
              "Not in an ActionDock project. Please specify -P, --package <id> or cd into a project directory."
            );
          }
        }
        if (targetPackageRoot) {
          try {
            packageId = loadProjectConfig(targetPackageRoot).id;
          } catch {}
        }
      }

      const target = await createActionDockTarget(
        resolved.type === "remote"
          ? {
              type: "remote",
              serverUrl: resolved.serverUrl!,
              token: resolved.token,
            }
          : {
              type: "local",
              projectRoot: targetPackageRoot,
              customHome: context?.customHome,
              dataDir: options.dataDir || context?.dataDir,
            }
      );

      try {
        const count = target.clearRuns
          ? await target.clearRuns({ packageId, actionId: options.action })
          : 0;

        const payload = { ok: true, clearedCount: count };
        renderResult(payload, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            resolved.type === "remote"
              ? `Cleared ${count} execution run(s) on remote server.`
              : `Cleared ${count} execution run(s) in package '${packageId}'.`,
          context,
        });
      } finally {
        await target.close();
      }
    });
}
