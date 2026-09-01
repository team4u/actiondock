import { existsSync } from "node:fs";
import {
  cancelRemoteRun,
  createStorage,
  fetchRemoteRun,
  filterWithFallbackInfo,
  findProjectRoot,
  listLinkedPackages,
  loadProjectConfig,
  resolvePackageRoot,
  resolveTarget,
} from "@actiondock/core";
import { Command } from "commander";
import { resolveIntent } from "../utils/filter";

function printRunRecord(run: any): void {
  console.log(`Run:          ${run.id}`);
  console.log(`Action:       ${run.actionId}`);
  if (run.packageId) console.log(`Package:      ${run.packageId}`);
  console.log(`Status:       ${run.status}`);
  if (run.parentRunId) console.log(`Parent Run:   ${run.parentRunId}`);
  console.log(`Started:      ${run.startedAt}`);
  if (run.finishedAt) console.log(`Finished:     ${run.finishedAt}`);

  console.log("\nInput:");
  console.log(JSON.stringify(run.input, null, 2));

  if (run.output !== undefined) {
    console.log("\nOutput:");
    console.log(JSON.stringify(run.output, null, 2));
  }

  if (run.error) {
    console.log("\nError:");
    console.log(JSON.stringify(run.error, null, 2));
  }
}

export function registerRunsCommands(program: Command): void {
  const runsCmd = program
    .command("runs")
    .description("Inspect action execution history");

  // runs list
  runsCmd
    .command("list [patterns...]")
    .description("List recent execution records (in current project or linked packages)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("-a, --action <actionId>", "Filter by action ID")
    .option("-n, --limit <count>", "Maximum number of records to return", "20")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .action((patterns, options) => {
      try {
        const effectiveIntent = resolveIntent(options.intent, patterns);
        const shouldFallback = options.fallback !== false;
        const limit = Number.parseInt(options.limit, 10) || 20;

        const targetRoot = options.package
          ? resolvePackageRoot(options.package)
          : findProjectRoot();

        if (options.package && !targetRoot) {
          console.error(`Error: Package '${options.package}' not found in linked packages or path`);
          process.exit(1);
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

          if (options.json) {
            console.log(JSON.stringify(filterRes.items, null, 2));
          } else {
            console.log(`Execution Runs in ${projConfig.id} (${filterRes.items.length}):\n`);
            if (filterRes.isFallback && effectiveIntent) {
              console.log(`(No runs matched intent '${effectiveIntent}', showing all runs)\n`);
            }
            console.log(
              `  ${"RUN ID".padEnd(38)} ${"ACTION".padEnd(24)} ${"STATUS".padEnd(10)} ${"STARTED"}`
            );
            console.log("  " + "-".repeat(90));
            for (const r of filterRes.items) {
              const time = r.startedAt.replace("T", " ").slice(0, 19);
              console.log(
                `  ${r.id.padEnd(38)} ${r.actionId.padEnd(24)} ${r.status.padEnd(10)} ${time}`
              );
            }
          }
          return;
        }

        // Outside project: List recent runs across all linked packages
        const linkedList = listLinkedPackages();
        if (linkedList.length === 0) {
          console.log("No ActionDock project in current directory, and no packages linked.");
          console.log("Run 'ac link' inside an Action package to register it.");
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
            // Ignore broken linked package
          }
        }

        // Sort by startedAt desc
        allRecords.sort((a, b) => (b.startedAt > a.startedAt ? 1 : b.startedAt < a.startedAt ? -1 : 0));
        allRecords = allRecords.slice(0, limit);

        const filterRes = filterWithFallbackInfo(
          allRecords,
          effectiveIntent,
          [(r) => r.id, (r) => r.actionId, (r) => r.packageId, (r) => r.status, (r) => r.error?.message],
          shouldFallback
        );

        if (options.json) {
          console.log(JSON.stringify(filterRes.items, null, 2));
        } else {
          console.log(`Execution Runs across Linked Packages (${filterRes.items.length}):\n`);
          if (filterRes.isFallback && effectiveIntent) {
            console.log(`(No runs matched intent '${effectiveIntent}', showing all runs)\n`);
          }
          console.log(
            `  ${"RUN ID".padEnd(38)} ${"PACKAGE".padEnd(20)} ${"ACTION".padEnd(22)} ${"STATUS".padEnd(10)} ${"STARTED"}`
          );
          console.log("  " + "-".repeat(110));
          for (const r of filterRes.items) {
            const time = r.startedAt.replace("T", " ").slice(0, 19);
            console.log(
              `  ${r.id.padEnd(38)} ${(r.packageId || "").padEnd(20)} ${r.actionId.padEnd(22)} ${r.status.padEnd(10)} ${time}`
            );
          }
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // runs show
  runsCmd
    .command("show <id>")
    .description("Show details of a specific execution run (searches current project or linked packages)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-p, --profile <name>", "Query run against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      let target;
      try {
        target = resolveTarget({
          profile: options.profile,
          server: options.server,
          token: options.token,
        });
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }

      if (target.type === "remote") {
        try {
          const run = await fetchRemoteRun(target.serverUrl!, id, target.token);
          if (options.json) {
            console.log(JSON.stringify(run, null, 2));
          } else {
            printRunRecord(run);
          }
          return;
        } catch (err: any) {
          console.error(`Error: ${err.message}`);
          process.exit(1);
        }
      }

      // Local show
      try {
        let foundRun: any = null;

        if (options.package) {
          const targetRoot = resolvePackageRoot(options.package);
          if (!targetRoot) {
            console.error(`Error: Package '${options.package}' not found in linked packages or path`);
            process.exit(1);
          }
          const projConfig = loadProjectConfig(targetRoot);
          const storage = createStorage(projConfig.id, { projectRoot: targetRoot });
          foundRun = storage.getRun(id);
          storage.close();
          if (foundRun && !foundRun.packageId) {
            foundRun.packageId = projConfig.id;
          }
        } else {
          // 1. Try current project root if exists
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

          // 2. If not found in current project, search across all linked packages
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
          console.error(`Error: Run record '${id}' not found in current project or any linked packages`);
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(foundRun, null, 2));
        } else {
          printRunRecord(foundRun);
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
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
    .action(async (id, options) => {
      let target;
      try {
        target = resolveTarget({
          profile: options.profile,
          server: options.server,
          token: options.token,
        });
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }

      if (target.type === "local") {
        console.error(
          "Error: 'ac runs cancel' is only supported for remote execution targets. Use --profile <name> or --server <url>."
        );
        process.exit(1);
      }

      try {
        const result = await cancelRemoteRun(
          target.serverUrl!,
          id,
          target.token,
          options.reason
        );
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Run '${id}' cancellation requested (Status: ${result.status}).`);
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}

