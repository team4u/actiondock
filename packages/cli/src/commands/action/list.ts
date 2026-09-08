import { existsSync } from "node:fs";
import {
  fetchRemoteActions,
  filterWithFallbackInfo,
  findProjectRoot,
  listLinkedPackages,
  loadManifest,
  loadProjectConfig,
  resolvePackageRoot,
  resolveTarget,
} from "@actiondock/core";
import { ArgumentError, ExecutionError, getEffectiveOptions, renderResult } from "@actiondock/runtime-cli";
import type { Command } from "commander";
import { resolveIntent } from "../../utils/filter";

export function registerActionListCommand(actionCmd: Command): void {
  actionCmd
    .command("list [patterns...]")
    .description("List actions in current project, linked packages, or remote profile")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-p, --profile <name>", "Execute or query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--fallback", "Enable fallback to full list when no items match intent")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (patterns, rawOptions, cmd) => {
      try {
        const options = getEffectiveOptions(rawOptions, cmd);
        const effectiveIntent = resolveIntent(options.intent, patterns);
        const isMachine = Boolean(options.json || options.envelope);
        const fallbackExplicit = options.fallback === true || (Array.isArray(process.argv) && process.argv.includes("--fallback"));
        const shouldFallback = isMachine ? fallbackExplicit : options.fallback !== false;

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

          if (isFallback && isMachine) {
            renderResult(
              { items: list, isFallback: true, matchedCount: 0 },
              { json: options.json, envelope: options.envelope }
            );
            return;
          }

          renderResult(list, {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => {
              const lines = [
                `Actions on remote server ${target.serverUrl}${target.profileName ? ` (Profile: ${target.profileName})` : ""}:\n`,
              ];
              if (isFallback && effectiveIntent) {
                lines.push(`(No remote actions matched intent '${effectiveIntent}', showing all actions)\n`);
              }
              for (const a of list) {
                lines.push(`  ${a.id.padEnd(28)} ${a.description}`);
              }
              return lines.join("\n");
            },
          });
          return;
        }

        let targetRoot: string | null = null;
        if (options.package) {
          targetRoot = resolvePackageRoot(options.package);
          if (!targetRoot) {
            throw new ArgumentError(
              `Package '${options.package}' not found in linked packages or path`
            );
          }
        } else {
          targetRoot = findProjectRoot();
        }

        if (targetRoot) {
          const config = loadProjectConfig(targetRoot);
          const manifest = loadManifest(targetRoot);
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

          if (filterRes.isFallback && isMachine) {
            renderResult(
              { items: filterRes.items, isFallback: true, matchedCount: 0 },
              { json: options.json, envelope: options.envelope }
            );
            return;
          }

          renderResult(filterRes.items, {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => {
              const lines = [`Actions in ${config.id} (${targetRoot}):\n`];
              if (filterRes.isFallback && effectiveIntent) {
                lines.push(`(No actions matched intent '${effectiveIntent}', showing all actions)\n`);
              }
              for (const a of filterRes.items) {
                lines.push(`  ${a.id.padEnd(28)} ${a.description}`);
              }
              return lines.join("\n");
            },
          });
          return;
        }

        // List actions across all linked packages
        const linkedList = listLinkedPackages();
        if (linkedList.length === 0) {
          renderResult([], {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () =>
              "No ActionDock project in current directory, and no packages linked.\nRun 'ad link' inside an Action package to register it.",
          });
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
        let isFallback = false;
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
            isFallback = true;
          }
        }

        if (isFallback && isMachine) {
          renderResult(
            { packages: filteredPackages, isFallback: true, matchedCount: 0 },
            { json: options.json, envelope: options.envelope }
          );
          return;
        }

        renderResult(filteredPackages, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => {
            const lines = ["Linked Action Packages:\n"];
            for (const pkg of filteredPackages) {
              lines.push(`* Package: ${pkg.packageId} (${pkg.path})`);
              for (const a of pkg.actions) {
                lines.push(`    - ${a.id.padEnd(26)} ${a.description}`);
              }
            }
            return lines.join("\n");
          },
        });
      } catch (err: any) {
        if (err instanceof ArgumentError || err instanceof ExecutionError) {
          throw err;
        }
        throw new ExecutionError(err.message);
      }
    });
}
