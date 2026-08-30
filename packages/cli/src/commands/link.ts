import {
  linkPackage,
  listLinkedPackages,
  loadActions,
  loadProjectConfig,
  unlinkPackage,
} from "@actiondock/core";
import { Command } from "commander";

export function registerLinkCommands(program: Command): void {
  // ac link [path]
  program
    .command("link [path]")
    .description("Link a local Action package into the global developer registry for instant cross-directory execution")
    .action(async (targetPath) => {
      try {
        const entry = linkPackage(targetPath || process.cwd());
        console.log(`[OK] Linked package '${entry.id}' (v${entry.version}) from ${entry.path}`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // ac unlink [id|path]
  program
    .command("unlink [identifier]")
    .description("Unlink a package from the global developer registry")
    .action((identifier) => {
      try {
        const removed = unlinkPackage(identifier || process.cwd());
        if (removed) {
          console.log(`[OK] Unlinked package '${removed.id}' (${removed.path})`);
        } else {
          console.log(`Package '${identifier || process.cwd()}' was not linked in registry`);
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}
