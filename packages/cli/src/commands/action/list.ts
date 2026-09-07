import { existsSync } from "node:fs";
import {
  fetchRemoteActions,
  filterWithFallbackInfo,
  findProjectRoot,
  listLinkedPackages,
  loadManifest,
  loadProjectConfig,
  resolveTarget,
} from "@actiondock/core";
import { ExecutionError } from "@actiondock/runtime-cli";
import type { Command } from "commander";
import { resolveIntent } from "../../utils/filter";

export function registerActionListCommand(actionCmd: Command): void {
  actionCmd
    .command("list [patterns...]")
    .description("List actions in current project, linked packages, or remote profile")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("-p, --profile <name>", "Execute or query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .action(async (patterns, options) => {
      try {
        const effectiveIntent = resolveIntent(options.intent, patterns);
        const shouldFallback = options.fallback !== false;

        const target = resolveTarget({
          profile: options.profile,
          server: options.server,
          token: options.token,
        });

        if (target.type === "remote") {
          let list = await fetchRemoteActions(
            target.serverUrl!,
            target.token,
            effectiveIntent
          );

          let isFallback = false;
          if (list.length === 0 && effectiveIntent && shouldFallback) {
            list = await fetchRemoteActions(target.serverUrl!, target.token);
            isFallback = true;
          }

          if (options.json) {
            console.log(JSON.stringify(list, null, 2));
          } else {
            console.log(
              `Actions on remote server ${target.serverUrl}${target.profileName ? ` (Profile: ${target.profileName})` : ""}:\n`
            );
            if (isFallback && effectiveIntent) {
              console.log(`(No remote actions matched intent '${effectiveIntent}', showing all actions)\n`);
            }
            for (const a of list) {
              console.log(`  ${a.id.padEnd(28)} ${a.description}`);
            }
          }
          return;
        }

        const root = findProjectRoot();
        if (root) {
          const config = loadProjectConfig(root);
          const manifest = loadManifest(root);
          const rawList = manifest?.actions
            ? Object.entries(manifest.actions).map(([actId, a]) => ({
                id: actId,
                description: a.description || "",
                packageId: config.id,
              }))
            : [];

          const filterRes = filterWithFallbackInfo(
            rawList,
            effectiveIntent,
            [(a) => a.id, (a) => a.description, (a) => a.packageId],
            shouldFallback
          );

          if (options.json) {
            console.log(JSON.stringify(filterRes.items, null, 2));
          } else {
            console.log(`Actions in ${config.id} (${root}):\n`);
            if (filterRes.isFallback && effectiveIntent) {
              console.log(`(No actions matched intent '${effectiveIntent}', showing all actions)\n`);
            }
            for (const a of filterRes.items) {
              console.log(`  ${a.id.padEnd(28)} ${a.description}`);
            }
          }
        } else {
          // List actions across all linked packages
          const linkedList = listLinkedPackages();
          if (linkedList.length === 0) {
            console.log("No ActionDock project in current directory, and no packages linked.");
            console.log("Run 'ad link' inside an Action package to register it.");
            return;
          }

          const aggregated: Array<{
            packageId: string;
            packageName: string;
            path: string;
            actions: Array<{ id: string; description: string }>;
          }> = [];

          for (const pkg of linkedList) {
            if (!existsSync(pkg.path)) continue;
            try {
              const config = loadProjectConfig(pkg.path);
              const manifest = loadManifest(pkg.path);
              const pkgActions = manifest?.actions
                ? Object.entries(manifest.actions).map(([actId, a]) => ({
                    id: actId,
                    description: a.description || "",
                  }))
                : [];

              aggregated.push({
                packageId: pkg.id,
                packageName: pkg.name,
                path: pkg.path,
                actions: pkgActions,
              });
            } catch {
              // Ignore broken linked package
            }
          }

          let filteredPackages: typeof aggregated = [];
          if (!effectiveIntent) {
            filteredPackages = aggregated;
          } else {
            for (const pkg of aggregated) {
              const pkgMatches = filterWithFallbackInfo(
                [pkg],
                effectiveIntent,
                [(p) => p.packageId, (p) => p.packageName, (p) => p.path],
                false
              ).matchedCount > 0;

              if (pkgMatches) {
                filteredPackages.push(pkg);
              } else {
                const matchedActions = filterWithFallbackInfo(
                  pkg.actions,
                  effectiveIntent,
                  [(a) => a.id, (a) => a.description],
                  false
                ).items;

                if (matchedActions.length > 0) {
                  filteredPackages.push({
                    ...pkg,
                    actions: matchedActions,
                  });
                }
              }
            }

            if (filteredPackages.length === 0 && shouldFallback) {
              filteredPackages = aggregated;
            }
          }

          if (options.json) {
            console.log(JSON.stringify(filteredPackages, null, 2));
          } else {
            console.log("Linked Action Packages:\n");
            for (const pkg of filteredPackages) {
              console.log(`* Package: ${pkg.packageId} (${pkg.path})`);
              for (const a of pkg.actions) {
                console.log(`    - ${a.id.padEnd(26)} ${a.description}`);
              }
            }
          }
        }
      } catch (err: any) {
        throw new ExecutionError(err.message);
      }
    });
}
