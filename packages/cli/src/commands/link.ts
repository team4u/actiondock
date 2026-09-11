import {
  linkPackage,
  pruneRegistry,
  unlinkPackage,
} from "@actiondock/core";
import { ExecutionError } from "../errors";
import { writeStdout } from "../renderer";
import { Command } from "commander";

export function registerLinkCommands(program: Command): void {
  // ad link [path]
  program
    .command("link [path]")
    .option("-r, --recursive", "Recursively discover and link packages in subdirectories")
    .description("Link local Action package(s) or workspace directory into global registry for instant cross-directory execution")
    .action(async (targetPath, options) => {
      try {
        const result = await linkPackage(targetPath || process.cwd(), undefined, {
          recursive: options.recursive,
        });

        if (result.isWorkspace) {
          writeStdout(`[OK] Linked workspace '${result.path}' (${result.entries.length} package${result.entries.length > 1 ? "s" : ""}):`);
          for (const e of result.entries) {
            writeStdout(`  - ${e.id} (v${e.version}) -> ${e.path}`);
          }
          writeStdout("[INFO] Sub-packages added to this workspace will be automatically discovered.");
        } else {
          writeStdout(`[OK] Linked package '${result.id}' (v${result.version}) from ${result.path}`);
        }
      } catch (err: any) {
        throw new ExecutionError(err.message);
      }
    });

  // ad unlink [id|path]
  program
    .command("unlink [identifier]")
    .option("-p, --prune", "Automatically scan and prune any stale/missing paths from registry")
    .description("Unlink a package, workspace, or prune stale entries from global developer registry")
    .action(async (identifier, options) => {
      try {
        if (options.prune || identifier === "--prune") {
          const result = await pruneRegistry();
          const totalPruned = result.prunedPackages.length + result.prunedWorkspaces.length;
          if (totalPruned === 0) {
            writeStdout("[OK] No stale registry entries found.");
          } else {
            writeStdout(`[OK] Pruned ${result.prunedWorkspaces.length} workspace(s) and ${result.prunedPackages.length} package(s) from registry.`);
            for (const ws of result.prunedWorkspaces) {
              writeStdout(`  - [workspace] ${ws.path}`);
            }
            for (const pkg of result.prunedPackages) {
              writeStdout(`  - [package] ${pkg.id} (${pkg.path})`);
            }
          }
          return;
        }

        const removed = await unlinkPackage(identifier || process.cwd());
        if (removed) {
          if (removed.type === "workspace") {
            writeStdout(`[OK] Unlinked workspace '${removed.path}' (${removed.packagesCount || 0} package${(removed.packagesCount || 0) > 1 ? "s" : ""} unlinked)`);
          } else {
            writeStdout(`[OK] Unlinked package '${removed.id}' (${removed.path})`);
          }
        } else {
          writeStdout(`Package or workspace '${identifier || process.cwd()}' was not linked in registry`);
        }
      } catch (err: any) {
        throw new ExecutionError(err.message);
      }
    });
}
