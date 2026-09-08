import { findProjectRoot, syncManifest } from "@actiondock/core";
import { ExecutionError, getEffectiveOptions, renderResult } from "@actiondock/runtime-cli";
import type { Command } from "commander";

export function registerActionSyncCommand(actionCmd: Command): void {
  actionCmd
    .command("sync")
    .description("Synchronize action metadata manifest with TypeScript definitions")
    .option("--check", "Check if manifest is synchronized without modifying files")
    .option("--no-prune", "Do not remove deleted actions from manifest")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (rawOptions, cmd) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const root = findProjectRoot();
      if (!root) {
        throw new ExecutionError("Not in an ActionDock project (actiondock.json not found)");
      }

      try {
        const result = await syncManifest(root, {
          check: Boolean(options.check),
          prune: options.prune !== false,
        });

        renderResult(result, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => {
            const lines: string[] = [];
            if (options.check) {
              if (result.inSync) {
                lines.push("[OK] actiondock.manifest.json is up to date.");
              } else {
                lines.push("[FAIL] actiondock.manifest.json is out of sync with action definitions:\n");
                if (result.added.length > 0) {
                  lines.push(`  - Added actions:   ${result.added.join(", ")}`);
                }
                if (result.updated.length > 0) {
                  lines.push(`  - Updated actions: ${result.updated.join(", ")}`);
                }
                if (result.removed.length > 0) {
                  lines.push(`  - Removed actions: ${result.removed.join(", ")}`);
                }
                lines.push("\nRun 'ad action sync' to synchronize metadata manifest.");
              }
            } else {
              if (result.inSync) {
                lines.push(`[OK] actiondock.manifest.json is already up to date (${result.unchanged.length} action(s)).`);
              } else {
                lines.push("[OK] Successfully synchronized actiondock.manifest.json:\n");
                if (result.added.length > 0) {
                  lines.push(`  - Added:   ${result.added.join(", ")}`);
                }
                if (result.updated.length > 0) {
                  lines.push(`  - Updated: ${result.updated.join(", ")}`);
                }
                if (result.removed.length > 0) {
                  lines.push(`  - Removed: ${result.removed.join(", ")}`);
                }
                lines.push(`\nManifest updated at ${result.manifestPath}`);
              }
            }
            return lines.join("\n");
          },
        });

        if (options.check && !result.inSync) {
          process.exitCode = 1;
        }
      } catch (err: any) {
        if (err instanceof ExecutionError) throw err;
        throw new ExecutionError(err.message);
      }
    });
}
