import { existsSync } from "node:fs";
import {
  cancelRemoteRun,
  clearRemoteRuns,
  createStorage,
  fetchRemoteRun,
  fetchRemoteRuns,
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

      // 1. 远端服务分支
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      }, context?.customHome);

      if (target.type === "remote") {
        const res = await fetchRemoteRuns(target.serverUrl!, target.token, {
          packageId: options.package,
          actionId: options.action,
          intent: effectiveIntent,
          limit,
        });

        renderResult(res.items, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            renderRunsList(
              res.items,
              `Execution Runs on remote server ${target.serverUrl}${target.profileName ? ` (Profile: ${target.profileName})` : ""}`,
              false,
              effectiveIntent
            ),
          context,
        });
        return;
      }

      // 2. 本地工程与链接包
      const targetRoot = options.package
        ? resolvePackageRoot(options.package)
        : findProjectRoot();

      if (options.package && !targetRoot) {
        throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
      }

      if (targetRoot) {
        const projConfig = loadProjectConfig(targetRoot);
        const storage = createStorage(projConfig.id, {
          customHome: context?.customHome,
          dataDir: options.dataDir || context?.dataDir,
        });
        const records = storage.listRuns({
          actionId: options.action,
          limit,
        });
        storage.close();

        const filterRes = filterWithFallbackInfo(
          records,
          effectiveIntent,
          [(r) => r.id, (r) => r.actionId, (r) => r.status, (r) => r.error?.message],
          shouldFallback
        );

        renderResult(filterRes.items, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            renderRunsList(
              filterRes.items,
              `Execution Runs in ${projConfig.name} (${projConfig.id})`,
              filterRes.isFallback,
              effectiveIntent
            ),
          context,
        });
        return;
      }

      // 扫描所有已链接的包
      const linked = listLinkedPackages();
      if (linked.length === 0) {
        renderResult(
          [],
          {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => "No ActionDock project in current directory, and no packages linked.",
            context,
          }
        );
        return;
      }

      const allRecords: any[] = [];
      for (const pkg of linked) {
        if (!existsSync(pkg.path)) continue;
        try {
          const config = loadProjectConfig(pkg.path);
          const storage = createStorage(config.id, {
            customHome: context?.customHome,
            dataDir: options.dataDir || context?.dataDir,
          });
          const recs = storage.listRuns({
            actionId: options.action,
            limit,
          });
          storage.close();
          for (const r of recs) {
            allRecords.push({ ...r, packageId: config.id });
          }
        } catch {}
      }

      allRecords.sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
      const capped = allRecords.slice(0, limit);

      const filterRes = filterWithFallbackInfo(
        capped,
        effectiveIntent,
        [(r) => r.id, (r) => r.actionId, (r) => r.packageId, (r) => r.status],
        shouldFallback
      );

      renderResult(filterRes.items, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () =>
          renderRunsList(
            filterRes.items,
            "Execution Runs (Linked Packages)",
            filterRes.isFallback,
            effectiveIntent
          ),
        context,
      });
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

      // 1. 远端服务模式
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      }, context?.customHome);

      if (target.type === "remote") {
        const run = await fetchRemoteRun(target.serverUrl!, id, target.token);
        if (!run) {
          throw new ExecutionError(`Run record '${id}' not found on remote server`);
        }

        renderResult(run, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderRunDetail(run),
          context,
        });
        return;
      }

      // 2. 本地项目模式
      if (options.package) {
        const root = resolvePackageRoot(options.package);
        if (!root) {
          throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
        }
        const projConfig = loadProjectConfig(root);
        const storage = createStorage(projConfig.id, {
          customHome: context?.customHome,
          dataDir: options.dataDir || context?.dataDir,
        });
        const run = storage.getRun(id);
        storage.close();

        if (!run) {
          throw new ExecutionError(`Run record '${id}' not found in package '${projConfig.id}'`);
        }

        renderResult(run, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderRunDetail(run),
          context,
        });
        return;
      }

      let foundRun: any = null;
      const currentRoot = findProjectRoot();
      if (currentRoot) {
        try {
          const projConfig = loadProjectConfig(currentRoot);
          const storage = createStorage(projConfig.id, {
            customHome: context?.customHome,
            dataDir: options.dataDir || context?.dataDir,
          });
          foundRun = storage.getRun(id);
          storage.close();
        } catch {}
      }

      if (!foundRun) {
        const linked = listLinkedPackages();
        for (const pkg of linked) {
          if (!existsSync(pkg.path)) continue;
          try {
            const config = loadProjectConfig(pkg.path);
            const storage = createStorage(config.id, {
              customHome: context?.customHome,
              dataDir: options.dataDir || context?.dataDir,
            });
            const r = storage.getRun(id);
            storage.close();
            if (r) {
              foundRun = { ...r, packageId: config.id };
              break;
            }
          } catch {}
        }
      }

      if (!foundRun) {
        throw new ExecutionError(`Run record '${id}' not found in current project or any linked packages`);
      }

      renderResult(foundRun, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () => renderRunDetail(foundRun),
        context,
      });
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

      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      }, context?.customHome);

      if (target.type === "local") {
        throw new ArgumentError(
          "'ad runs cancel' is only supported for remote execution targets. Use --profile <name> or --server <url>."
        );
      }

      const result = await cancelRemoteRun(
        target.serverUrl!,
        id,
        target.token,
        options.reason
      );

      renderResult(result, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () => `Run '${id}' cancellation requested (Status: ${result.status}).`,
        context,
      });
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

      // 1. 远端服务模式
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      }, context?.customHome);

      if (target.type === "remote") {
        const res = await clearRemoteRuns(target.serverUrl!, target.token, {
          packageId: options.package,
          actionId: options.action,
        });

        renderResult(res, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => `Cleared ${res.clearedCount} execution run(s) on remote server.`,
          context,
        });
        return;
      }

      // 2. 本地存储模式
      const targetRoot = options.package
        ? resolvePackageRoot(options.package)
        : findProjectRoot();

      if (options.package && !targetRoot) {
        throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
      }

      if (targetRoot) {
        const projConfig = loadProjectConfig(targetRoot);
        const storage = createStorage(projConfig.id, {
          customHome: context?.customHome,
          dataDir: options.dataDir || context?.dataDir,
        });
        const count = storage.clearRuns({ actionId: options.action });
        storage.close();

        const payload = { ok: true, clearedCount: count };
        renderResult(payload, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => `Cleared ${count} execution run(s) in package '${projConfig.id}'.`,
          context,
        });
        return;
      }

      throw new ArgumentError(
        "Not in an ActionDock project. Please specify -P, --package <id> or cd into a project directory."
      );
    });
}
