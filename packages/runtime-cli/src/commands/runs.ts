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
import type { RuntimeCliContext } from "../types";
import { getEffectiveOptions, resolveIntent } from "../utils";

/**
 * 注册 runs 动作执行历史管理命令（list、show、clear、cancel）。
 * 
 * @param program Commander 实例
 * @param context 运行时上下文
 */
export function registerRunsCommands(program: Command, context?: RuntimeCliContext): void {
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
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (patterns: string[] = [], rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const effectiveIntent = resolveIntent(options.intent, patterns);
      const shouldFallback = options.fallback !== false;
      const limit = Number.parseInt(options.limit, 10) || 20;

      // 1. 独立运行模式
      if (context?.standalone) {
        const sa = context.standalone;
        const storage = createStorage(sa.packageId, { dataDir: context.dataDir });
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
              `Execution Runs in ${sa.packageId}`,
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

      // 3. 本地工程与链接包
      const targetRoot = options.package
        ? resolvePackageRoot(options.package)
        : findProjectRoot();

      if (options.package && !targetRoot) {
        throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
      }

      if (targetRoot) {
        const projConfig = loadProjectConfig(targetRoot);
        const storage = createStorage(projConfig.id, { projectRoot: targetRoot });
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
              `Execution Runs in ${projConfig.id}`,
              filterRes.isFallback,
              effectiveIntent
            ),
          context,
        });
        return;
      }

      // 全局扫描所有链接包
      const linkedList = listLinkedPackages();
      if (linkedList.length === 0) {
        renderResult([], {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            "No ActionDock project in current directory, and no packages linked.\nRun 'ad link' inside an Action package to register it.",
          context,
        });
        return;
      }

      let allRecords: any[] = [];
      for (const pkg of linkedList) {
        if (!existsSync(pkg.path)) continue;
        try {
          const projConfig = loadProjectConfig(pkg.path);
          const storage = createStorage(projConfig.id, { projectRoot: pkg.path });
          const records = storage.listRuns({
            actionId: options.action,
            limit,
          });
          storage.close();
          for (const r of records) {
            allRecords.push({ ...r, packageId: projConfig.id });
          }
        } catch {
          // 忽略失效链接
        }
      }

      allRecords.sort((a, b) => (b.startedAt > a.startedAt ? 1 : b.startedAt < a.startedAt ? -1 : 0));
      allRecords = allRecords.slice(0, limit);

      const filterRes = filterWithFallbackInfo(
        allRecords,
        effectiveIntent,
        [(r) => r.id, (r) => r.actionId, (r) => r.packageId, (r) => r.status, (r) => r.error?.message],
        shouldFallback
      );

      renderResult(filterRes.items, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () =>
          renderRunsList(
            filterRes.items,
            "Execution Runs across Linked Packages",
            filterRes.isFallback,
            effectiveIntent
          ),
        context,
      });
    });

  // runs show
  runsCmd
    .command("show <id>")
    .description("Show details of a specific execution run")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-p, --profile <name>", "Query run against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (id: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!id) {
        throw new ArgumentError("Run ID is required for show");
      }

      // 1. 独立运行模式
      if (context?.standalone) {
        const sa = context.standalone;
        const storage = createStorage(sa.packageId, { dataDir: context.dataDir });
        const run = storage.getRun(id);
        storage.close();

        if (!run) {
          throw new ExecutionError(`Run record '${id}' not found in ${sa.packageId}`);
        }

        renderResult(run, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderRunDetail(run),
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
        const run = await fetchRemoteRun(target.serverUrl!, id, target.token);
        renderResult(run, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderRunDetail(run),
          context,
        });
        return;
      }

      // 3. 本地存储模式
      let foundRun: any = null;

      if (options.package) {
        const targetRoot = resolvePackageRoot(options.package);
        if (!targetRoot) {
          throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
        }
        const projConfig = loadProjectConfig(targetRoot);
        const storage = createStorage(projConfig.id, { projectRoot: targetRoot });
        foundRun = storage.getRun(id);
        storage.close();
        if (foundRun && !foundRun.packageId) {
          foundRun.packageId = projConfig.id;
        }
      } else {
        const currentRoot = findProjectRoot();
        if (currentRoot) {
          try {
            const projConfig = loadProjectConfig(currentRoot);
            const storage = createStorage(projConfig.id, { projectRoot: currentRoot });
            foundRun = storage.getRun(id);
            storage.close();
            if (foundRun && !foundRun.packageId) {
              foundRun.packageId = projConfig.id;
            }
          } catch {}
        }

        if (!foundRun) {
          const linkedList = listLinkedPackages();
          for (const pkg of linkedList) {
            if (!existsSync(pkg.path)) continue;
            try {
              const projConfig = loadProjectConfig(pkg.path);
              const storage = createStorage(projConfig.id, { projectRoot: pkg.path });
              const r = storage.getRun(id);
              storage.close();
              if (r) {
                foundRun = { ...r, packageId: projConfig.id };
                break;
              }
            } catch {}
          }
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
      });

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
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      // 1. 独立运行模式
      if (context?.standalone) {
        const sa = context.standalone;
        const storage = createStorage(sa.packageId, { dataDir: context.dataDir });
        const count = storage.clearRuns({ actionId: options.action });
        storage.close();

        const payload = { ok: true, clearedCount: count };
        renderResult(payload, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => `Cleared ${count} execution run(s) in standalone package '${sa.packageId}'.`,
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

      // 3. 本地存储模式
      const targetRoot = options.package
        ? resolvePackageRoot(options.package)
        : findProjectRoot();

      if (targetRoot) {
        const projConfig = loadProjectConfig(targetRoot);
        const storage = createStorage(projConfig.id, { projectRoot: targetRoot });
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
