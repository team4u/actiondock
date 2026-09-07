import { findProjectRoot, syncManifest } from "@actiondock/core";
import { ExecutionError } from "@actiondock/runtime-cli";
import type { Command } from "commander";

export function registerActionSyncCommand(actionCmd: Command): void {
  actionCmd
    .command("sync")
    .description("Synchronize action metadata manifest with TypeScript definitions")
    .option("--check", "Check if manifest is synchronized without modifying files")
    .option("--no-prune", "Do not remove deleted actions from manifest")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const root = findProjectRoot();
      if (!root) {
        throw new ExecutionError("Not in an ActionDock project (actiondock.json not found)");
      }

      try {
        const result = await syncManifest(root, {
          check: Boolean(options.check),
          prune: options.prune !== false,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          if (options.check && !result.inSync) {
            process.exitCode = 1;
          }
          return;
        }

        if (options.check) {
          if (result.inSync) {
            console.log("[OK] actiondock.manifest.json is up to date.");
          } else {
            console.log("[FAIL] actiondock.manifest.json is out of sync with action definitions:\n");
            if (result.added.length > 0) {
              console.log(`  - Added actions:   ${result.added.join(", ")}`);
            }
            if (result.updated.length > 0) {
              console.log(`  - Updated actions: ${result.updated.join(", ")}`);
            }
            if (result.removed.length > 0) {
              console.log(`  - Removed actions: ${result.removed.join(", ")}`);
            }
            console.log("\nRun 'ad action sync' to synchronize metadata manifest.");
            process.exitCode = 1;
          }
        } else {
          if (result.inSync) {
            console.log(`[OK] actiondock.manifest.json is already up to date (${result.unchanged.length} action(s)).`);
          } else {
            console.log("[OK] Successfully synchronized actiondock.manifest.json:\n");
            if (result.added.length > 0) {
              console.log(`  - Added:   ${result.added.join(", ")}`);
            }
            if (result.updated.length > 0) {
              console.log(`  - Updated: ${result.updated.join(", ")}`);
            }
            if (result.removed.length > 0) {
              console.log(`  - Removed: ${result.removed.join(", ")}`);
            }
            console.log(`\nManifest updated at ${result.manifestPath}`);
          }
        }
      } catch (err: any) {
        if (err instanceof ExecutionError) throw err;
        throw new ExecutionError(err.message);
      }
    });
}
