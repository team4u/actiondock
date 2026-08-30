import {
  createStorage,
  filterWithFallbackInfo,
  findProjectRoot,
  loadProjectConfig,
} from "@actiondock/core";
import { Command } from "commander";
import { resolveIntent } from "../utils/filter";

export function registerRunsCommands(program: Command): void {
  const runsCmd = program
    .command("runs")
    .description("Inspect action execution history");

  // runs list
  runsCmd
    .command("list [patterns...]")
    .description("List recent execution records")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("-a, --action <actionId>", "Filter by action ID")
    .option("-n, --limit <count>", "Maximum number of records to return", "20")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .action((patterns, options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project");
        process.exit(1);
      }
      try {
        const effectiveIntent = resolveIntent(options.intent, patterns);
        const shouldFallback = options.fallback !== false;

        const projConfig = loadProjectConfig(root);
        const storage = createStorage(projConfig.id, { projectRoot: root });
        const limit = Number.parseInt(options.limit, 10) || 20;
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
          console.log(`Execution Runs (${filterRes.items.length}):\n`);
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
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });


  // runs show
  runsCmd
    .command("show <id>")
    .description("Show details of a specific execution run")
    .option("--json", "Output as JSON")
    .action((id, options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project");
        process.exit(1);
      }
      try {
        const projConfig = loadProjectConfig(root);
        const storage = createStorage(projConfig.id, { projectRoot: root });
        const run = storage.getRun(id);
        storage.close();

        if (!run) {
          console.error(`Error: Run record '${id}' not found`);
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(run, null, 2));
        } else {
          console.log(`Run:          ${run.id}`);
          console.log(`Action:       ${run.actionId}`);
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
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}
