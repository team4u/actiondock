import {
  getRegistryStatus,
  linkPackage,
  listLinkedPackages,
  pruneRegistry,
  unlinkPackage,
} from "@actiondock/core";
import { Command } from "commander";

function printRegistryTree(status: ReturnType<typeof getRegistryStatus>): void {
  const hasWorkspaces = status.workspaces.length > 0;
  const hasPackages = status.packages.length > 0;

  if (!hasWorkspaces && !hasPackages) {
    console.log("[INFO] No packages or workspaces currently linked in global registry.");
    console.log("       Run 'ac link' inside an Action package to register it.");
    return;
  }

  console.log("[ActionDock Global Registry]\n");

  if (hasWorkspaces) {
    console.log("Workspaces:");
    for (const ws of status.workspaces) {
      const tag = ws.status === "active" ? "[OK]" : "[STALE]";
      console.log(`  ${tag} ${ws.path} (${ws.packagesCount} package${ws.packagesCount === 1 ? "" : "s"})`);
      if (ws.children && ws.children.length > 0) {
        ws.children.forEach((child: any, idx: number) => {
          const isLast = idx === ws.children!.length - 1;
          const prefix = isLast ? "    +-- " : "    |-- ";
          console.log(`${prefix}${child.id} (v${child.version}) -> ${child.path}`);
        });
      }
    }
  }

  if (hasPackages) {
    if (hasWorkspaces) console.log("");
    console.log("Standalone Packages:");
    for (const pkg of status.packages) {
      const tag = pkg.status === "active" ? "[OK]" : "[STALE]";
      console.log(`  ${tag} ${pkg.id} (v${pkg.version || "unknown"}) -> ${pkg.path}`);
    }
  }

  console.log(`\n[Summary] Total: ${status.totalPackagesCount} active package(s), ${status.workspaces.length} workspace(s)`);
  if (status.staleCount > 0) {
    console.log(`[WARN] ${status.staleCount} stale entry/entries found. Run 'ac unlink --prune' to clean up.`);
  }
}

export function registerLinkCommands(program: Command): void {
  // ac link [path]
  program
    .command("link [path]")
    .option("-l, --list", "List all linked packages and workspaces in a tree view")
    .option("-r, --recursive", "Recursively discover and link packages in subdirectories")
    .option("--json", "Output registry status in JSON format (when used with --list or 'list')")
    .description("Link local Action package(s) or workspace directory into global registry for instant cross-directory execution")
    .action(async (targetPath, options) => {
      try {
        if (targetPath === "list" || options.list) {
          const status = getRegistryStatus();
          if (options.json) {
            console.log(JSON.stringify(status, null, 2));
          } else {
            printRegistryTree(status);
          }
          return;
        }

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
    .option("-p, --prune", "Automatically scan and prune any stale/missing paths from registry")
    .description("Unlink a package, workspace, or prune stale entries from global developer registry")
    .action((identifier, options) => {
      try {
        if (options.prune || identifier === "--prune") {
          const result = pruneRegistry();
          const totalPruned = result.prunedPackages.length + result.prunedWorkspaces.length;
          if (totalPruned === 0) {
            console.log("[OK] No stale registry entries found.");
          } else {
            console.log(`[OK] Pruned ${result.prunedWorkspaces.length} workspace(s) and ${result.prunedPackages.length} package(s) from registry.`);
            for (const ws of result.prunedWorkspaces) {
              console.log(`  - [workspace] ${ws.path}`);
            }
            for (const pkg of result.prunedPackages) {
              console.log(`  - [package] ${pkg.id} (${pkg.path})`);
            }
          }
          return;
        }

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


