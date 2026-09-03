import { existsSync } from "node:fs";
import {
  fetchRemoteInfo,
  filterWithFallbackInfo,
  findProjectRoot,
  getRegistryStatus,
  listLinkedPackages,
  loadActions,
  loadPlaybooks,
  loadProjectConfig,
  resolvePackageRoot,
  resolveTarget,
} from "@actiondock/core";
import { Command } from "commander";
import { resolveIntent } from "../utils/filter";

interface AggregatedPackage {
  id: string;
  name: string;
  version: string;
  description?: string;
  path: string;
  actionsCount: number;
  playbooksCount: number;
  actions: string[];
  playbooks: string[];
  configDeclared: string[];
}

async function getProjectDetailInfo(root: string) {
  const config = loadProjectConfig(root);
  const actions = await loadActions(root, config.actionsDir);
  const playbooks = loadPlaybooks(root, config.playbooksDir);

  return {
    id: config.id,
    name: config.name,
    version: config.version,
    description: config.description,
    projectRoot: root,
    actionsDir: config.actionsDir || "actions",
    playbooksDir: config.playbooksDir || "playbooks",
    actionsCount: actions.size,
    playbooksCount: playbooks.size,
    actions: Array.from(actions.keys()),
    playbooks: Array.from(playbooks.keys()),
    configDeclared: config.config ? Object.keys(config.config) : [],
    configDef: config.config,
    actionsMap: actions,
    playbooksMap: playbooks,
  };
}

function projectDetailToJson(info: Awaited<ReturnType<typeof getProjectDetailInfo>>) {
  return {
    id: info.id,
    name: info.name,
    version: info.version,
    description: info.description,
    projectRoot: info.projectRoot,
    actionsDir: info.actionsDir,
    playbooksDir: info.playbooksDir,
    actionsCount: info.actionsCount,
    playbooksCount: info.playbooksCount,
    actions: info.actions,
    playbooks: info.playbooks,
    configDeclared: info.configDeclared,
  };
}

function printProjectDetail(info: Awaited<ReturnType<typeof getProjectDetailInfo>>) {
  console.log(`ActionDock Project: ${info.name} (${info.id})`);
  console.log(`Version:     ${info.version}`);
  if (info.description) console.log(`Description: ${info.description}`);
  console.log(`Root:        ${info.projectRoot}`);
  console.log(`\nActions (${info.actionsCount}):`);
  for (const [id, act] of info.actionsMap.entries()) {
    console.log(`  - ${id.padEnd(28)} ${act.description || ""}`);
  }
  console.log(`\nPlaybooks (${info.playbooksCount}):`);
  for (const [id, pb] of info.playbooksMap.entries()) {
    console.log(`  - ${id.padEnd(28)} ${pb.description || ""}`);
  }
  if (info.configDeclared.length > 0) {
    console.log(`\nDeclared Config Keys:`);
    for (const k of info.configDeclared) {
      const item = info.configDef?.[k];
      const isSec = item?.secret ? " [secret]" : "";
      const def =
        item?.default !== undefined
          ? ` (default: ${JSON.stringify(item.default)})`
          : "";
      console.log(
        `  - ${k.padEnd(24)} ${item?.description || ""}${def}${isSec}`
      );
    }
  }
}

function printAggregatedPackages(
  packages: AggregatedPackage[],
  options?: { header?: string; showTip?: boolean }
) {
  if (options?.header) {
    console.log(options.header);
  } else {
    console.log(`ActionDock Linked Packages (${packages.length}):\n`);
  }
  for (const p of packages) {
    console.log(`* ${p.name} (${p.id}) v${p.version}`);
    console.log(`  Path:      ${p.path}`);
    if (p.description) {
      console.log(`  Desc:      ${p.description}`);
    }
    console.log(
      `  Actions (${p.actionsCount}):   ${p.actions.join(", ") || "(none)"}`
    );
    console.log(
      `  Playbooks (${p.playbooksCount}): ${p.playbooks.join(", ") || "(none)"}`
    );
    console.log("");
  }
  if (options?.showTip !== false) {
    console.log(
      "Tip: Run 'ad info <package-id>' to view detailed package configuration and schema."
    );
  }
}

function printRegistryTree(status: ReturnType<typeof getRegistryStatus>): void {
  const hasWorkspaces = status.workspaces.length > 0;
  const hasPackages = status.packages.length > 0;

  if (!hasWorkspaces && !hasPackages) {
    console.log("[INFO] No ActionDock packages or workspaces currently linked.");
    console.log("       Run 'ad link' inside an Action package or workspace to register it.");
    return;
  }

  console.log("[ActionDock Workspace & Package Tree]\n");

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
    console.log(`[WARN] ${status.staleCount} stale entry/entries detected. Run 'ad unlink --prune' to clean up.`);
  }
}

export function registerInfoCommand(program: Command): void {
  program
    .command("info [patterns...]")
    .description(
      "Display information about current project, linked package, or remote target"
    )
    .option(
      "-i, --intent <pattern>",
      "Regex or fuzzy intent filter; falls back to full list when no match"
    )
    .option("-P, --package <id>", "Target package ID or path")
    .option("--tree", "Display packages in hierarchical tree view grouped by workspace")
    .option("-p, --profile <name>", "Query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option(
      "--no-fallback",
      "Disable fallback to full list when no items match intent"
    )
    .option("--json", "Output information as JSON")
    .action(async (patterns: string[] = [], options: any) => {
      try {
        const effectiveIntent = resolveIntent(options.intent, patterns);
        const shouldFallback = options.fallback !== false;

        const target = resolveTarget({
          profile: options.profile,
          server: options.server,
          token: options.token,
        });

        // 1. Remote target handling
        if (target.type === "remote") {
          const remoteInfo = await fetchRemoteInfo(
            target.serverUrl!,
            target.token,
            {
              intent: effectiveIntent,
              package: options.package,
              tree: Boolean(options.tree),
            }
          );

          if (options.json) {
            console.log(JSON.stringify(remoteInfo, null, 2));
            return;
          }

          console.log(
            `Remote ActionDock Server: ${target.serverUrl}${target.profileName ? ` (Profile: ${target.profileName})` : ""}\n`
          );

          // Remote Tree
          if (remoteInfo.type === "tree" || (options.tree && remoteInfo.workspaces)) {
            printRegistryTree(remoteInfo);
            return;
          }

          // Remote Package Detail
          if (remoteInfo.type === "package_detail" || (remoteInfo.id && !remoteInfo.packages)) {
            console.log(`ActionDock Project: ${remoteInfo.name || remoteInfo.id} (${remoteInfo.id})`);
            console.log(`Version:     ${remoteInfo.version || "unknown"}`);
            if (remoteInfo.description) console.log(`Description: ${remoteInfo.description}`);
            if (remoteInfo.path || remoteInfo.projectRoot) {
              console.log(`Root:        ${remoteInfo.path || remoteInfo.projectRoot}`);
            }

            const actions = remoteInfo.actionsDetail || remoteInfo.actions || [];
            console.log(`\nActions (${remoteInfo.actionsCount || actions.length}):`);
            for (const act of actions) {
              if (typeof act === "string") {
                console.log(`  - ${act}`);
              } else {
                console.log(`  - ${(act.id || "").padEnd(28)} ${act.description || ""}`);
              }
            }

            const playbooks = remoteInfo.playbooksDetail || remoteInfo.playbooks || [];
            console.log(`\nPlaybooks (${remoteInfo.playbooksCount || playbooks.length}):`);
            for (const pb of playbooks) {
              if (typeof pb === "string") {
                console.log(`  - ${pb}`);
              } else {
                console.log(`  - ${(pb.id || "").padEnd(28)} ${pb.description || ""}`);
              }
            }

            const declared = remoteInfo.configDeclared || {};
            const declaredKeys = Object.keys(declared);
            if (declaredKeys.length > 0) {
              console.log(`\nDeclared Config Keys:`);
              for (const k of declaredKeys) {
                const item = declared[k];
                const isSec = item?.secret ? " [secret]" : "";
                const def =
                  item?.default !== undefined
                    ? ` (default: ${JSON.stringify(item.default)})`
                    : "";
                console.log(
                  `  - ${k.padEnd(24)} ${item?.description || ""}${def}${isSec}`
                );
              }
            }
            return;
          }

          // Remote Package List
          const packages = remoteInfo.packages || remoteInfo.linkedPackages || [];
          if (Array.isArray(packages)) {
            console.log(`Remote ActionDock Packages (${packages.length}):\n`);
            for (const p of packages) {
              console.log(`* ${p.name || p.id} (${p.id}) v${p.version || "unknown"}`);
              if (p.path) console.log(`  Path:      ${p.path}`);
              if (p.description) console.log(`  Desc:      ${p.description}`);
              const actNames = Array.isArray(p.actions)
                ? p.actions.map((a: any) => (typeof a === "string" ? a : a.id)).join(", ")
                : "";
              const pbNames = Array.isArray(p.playbooks)
                ? p.playbooks.map((pb: any) => (typeof pb === "string" ? pb : pb.id)).join(", ")
                : "";
              console.log(`  Actions (${p.actionsCount || (p.actions ? p.actions.length : 0)}):   ${actNames || "(none)"}`);
              console.log(`  Playbooks (${p.playbooksCount || (p.playbooks ? p.playbooks.length : 0)}): ${pbNames || "(none)"}`);
              console.log("");
            }
            console.log("Tip: Run 'ad info <package-id> --server <url>' to view detailed package configuration and schema.");
            return;
          }

          console.log(JSON.stringify(remoteInfo, null, 2));
          return;
        }

        // Local Tree
        if (options.tree) {
          const status = getRegistryStatus();
          if (options.json) {
            console.log(JSON.stringify(status, null, 2));
          } else {
            printRegistryTree(status);
          }
          return;
        }

        // 2. Explicit package option (-P, --package)
        if (options.package) {
          const directRoot = resolvePackageRoot(options.package);
          if (directRoot) {
            const detail = await getProjectDetailInfo(directRoot);
            if (options.json) {
              console.log(JSON.stringify(projectDetailToJson(detail), null, 2));
            } else {
              printProjectDetail(detail);
            }
            return;
          }
          console.error(
            `Error: Package '${options.package}' not found in linked packages or path`
          );
          process.exit(1);
        }

        // 3. Collect local candidate packages (current project + linked packages)
        const currentRoot = findProjectRoot();
        const linkedList = listLinkedPackages();
        const aggregated: AggregatedPackage[] = [];
        const seenPaths = new Set<string>();

        if (currentRoot) {
          try {
            const config = loadProjectConfig(currentRoot);
            const actions = await loadActions(currentRoot, config.actionsDir);
            const playbooks = loadPlaybooks(currentRoot, config.playbooksDir);
            aggregated.push({
              id: config.id,
              name: config.name,
              version: config.version,
              description: config.description,
              path: currentRoot,
              actionsCount: actions.size,
              playbooksCount: playbooks.size,
              actions: Array.from(actions.keys()),
              playbooks: Array.from(playbooks.keys()),
              configDeclared: config.config ? Object.keys(config.config) : [],
            });
            seenPaths.add(currentRoot);
          } catch {
            // Ignore broken project root
          }
        }

        for (const pkg of linkedList) {
          if (!existsSync(pkg.path)) continue;
          if (seenPaths.has(pkg.path)) continue;
          try {
            const config = loadProjectConfig(pkg.path);
            const actions = await loadActions(pkg.path, config.actionsDir);
            const playbooks = loadPlaybooks(pkg.path, config.playbooksDir);

            aggregated.push({
              id: config.id,
              name: config.name,
              version: config.version,
              description: config.description,
              path: pkg.path,
              actionsCount: actions.size,
              playbooksCount: playbooks.size,
              actions: Array.from(actions.keys()),
              playbooks: Array.from(playbooks.keys()),
              configDeclared: config.config ? Object.keys(config.config) : [],
            });
            seenPaths.add(pkg.path);
          } catch {
            // Ignore broken linked package
          }
        }

        // 4. Case: No pattern / intent specified
        if (!effectiveIntent) {
          if (currentRoot) {
            const detail = await getProjectDetailInfo(currentRoot);
            if (options.json) {
              console.log(JSON.stringify(projectDetailToJson(detail), null, 2));
            } else {
              printProjectDetail(detail);
            }
            return;
          }

          if (aggregated.length === 0) {
            console.log(
              "No ActionDock project in current directory, and no packages linked."
            );
            console.log(
              "Run 'ad link' inside an Action package to register it."
            );
            return;
          }

          if (options.json) {
            console.log(
              JSON.stringify({ linkedPackages: aggregated }, null, 2)
            );
          } else {
            printAggregatedPackages(aggregated);
          }
          return;
        }

        // 5. Case: Pattern / intent specified
        // 5.1 Check if single positional argument directly matches an exact path or package ID/slug
        if (patterns.length === 1 && !options.intent) {
          const directRoot = resolvePackageRoot(patterns[0]);
          if (directRoot) {
            const detail = await getProjectDetailInfo(directRoot);
            if (options.json) {
              console.log(JSON.stringify(projectDetailToJson(detail), null, 2));
            } else {
              printProjectDetail(detail);
            }
            return;
          }
        }

        if (aggregated.length === 0) {
          console.error(
            `Error: No ActionDock project or linked packages available to match '${effectiveIntent}'`
          );
          process.exit(1);
        }

        // 5.2 Intent filtering across candidate packages
        const filterRes = filterWithFallbackInfo(
          aggregated,
          effectiveIntent,
          [
            (p) => p.id,
            (p) => p.name,
            (p) => p.description,
            (p) => p.path,
            (p) => p.actions,
            (p) => p.playbooks,
          ],
          shouldFallback
        );

        // Subcase A: 0 items matched
        if (filterRes.matchedCount === 0) {
          if (!shouldFallback) {
            if (options.json) {
              console.log(JSON.stringify({ linkedPackages: [] }, null, 2));
            } else {
              console.error(
                `Error: No packages matched intent '${effectiveIntent}'`
              );
            }
            process.exit(1);
          }

          // Fallback enabled: display all packages with a notice
          if (options.json) {
            console.log(
              JSON.stringify(
                { linkedPackages: filterRes.items, isFallback: true },
                null,
                2
              )
            );
          } else {
            console.log(
              `(No linked packages matched intent '${effectiveIntent}', showing all packages)\n`
            );
            printAggregatedPackages(filterRes.items);
          }
          return;
        }

        // Subcase B: Exactly 1 item matched -> Display its full project detail
        if (filterRes.matchedCount === 1 && !filterRes.isFallback) {
          const matchedPkg = filterRes.items[0];
          const detail = await getProjectDetailInfo(matchedPkg.path);
          if (options.json) {
            console.log(JSON.stringify(projectDetailToJson(detail), null, 2));
          } else {
            printProjectDetail(detail);
          }
          return;
        }

        // Subcase C: Multiple items matched -> Display filtered summary list
        if (options.json) {
          console.log(
            JSON.stringify({ linkedPackages: filterRes.items }, null, 2)
          );
        } else {
          printAggregatedPackages(filterRes.items, {
            header: `ActionDock Linked Packages (${filterRes.matchedCount} matches for '${effectiveIntent}'):\n`,
            showTip: true,
          });
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}


