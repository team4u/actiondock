import {
  linkPackage,
  listLinkedPackages,
  unlinkPackage,
} from "@actiondock/core";
import { Command } from "commander";

export function registerLinkCommands(program: Command): void {
  // ac link [path]
  program
    .command("link [path]")
    .option("-r, --recursive", "Recursively discover and link packages in subdirectories")
    .description("Link local Action package(s) or workspace directory into global registry for instant cross-directory execution")
    .action(async (targetPath, options) => {
      try {
        const result = linkPackage(targetPath || process.cwd(), undefined, {
          recursive: options.recursive,
        });

        if (result.isWorkspace) {
          console.log(`[OK] Linked workspace '${result.path}' (${result.entries.length} package${result.entries.length > 1 ? "s" : ""}):`);
          for (const e of result.entries) {
            console.log(`  - ${e.id} (v${e.version}) -> ${e.path}`);
          }
          console.log(`[INFO] Sub-packages added to this workspace will be automatically discovered.`);
        } else {
          console.log(`[OK] Linked package '${result.id}' (v${result.version}) from ${result.path}`);
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // ac unlink [id|path]
  program
    .command("unlink [identifier]")
    .description("Unlink a package or workspace from the global developer registry")
    .action((identifier) => {
      try {
        const removed = unlinkPackage(identifier || process.cwd());
        if (removed) {
          if (removed.type === "workspace") {
            console.log(`[OK] Unlinked workspace '${removed.path}' (${removed.packagesCount || 0} package${(removed.packagesCount || 0) > 1 ? "s" : ""} unlinked)`);
          } else {
            console.log(`[OK] Unlinked package '${removed.id}' (${removed.path})`);
          }
        } else {
          console.log(`Package or workspace '${identifier || process.cwd()}' was not linked in registry`);
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}

