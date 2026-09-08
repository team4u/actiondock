import {
  fetchRemoteActionShow,
  loadManifest,
  loadProjectConfig,
  resolveActionProject,
  resolvePackageRoot,
  resolveTarget,
} from "@actiondock/core";
import {
  ArgumentError,
  ExecutionError,
  getEffectiveOptions,
  renderResult,
} from "@actiondock/runtime-cli";
import type { Command } from "commander";

export function registerActionShowCommand(actionCmd: Command): void {
  actionCmd
    .command("show <id>")
    .alias("describe")
    .description("Show action definition, schema, and description")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-p, --profile <name>", "Execute or query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (id, rawOptions, cmd) => {
      try {
        const options = getEffectiveOptions(rawOptions, cmd);
        if (!id) {
          throw new ArgumentError("Action ID is required for show/describe");
        }

        const target = resolveTarget({
          profile: options.profile,
          server: options.server,
          token: options.token,
        });

        if (target.type === "remote") {
          const detail = await fetchRemoteActionShow(
            target.serverUrl!,
            id,
            target.token
          );
          renderResult(detail, {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => {
              const lines = [`Action:      ${detail.id}`];
              if (detail.packageId) lines.push(`Package:     ${detail.packageId}`);
              if (detail.description) lines.push(`Description: ${detail.description}`);
              if (detail.inputSchema) {
                lines.push("\nInput Schema:", JSON.stringify(detail.inputSchema, null, 2));
              }
              if (detail.outputSchema) {
                lines.push("\nOutput Schema:", JSON.stringify(detail.outputSchema, null, 2));
              }
              return lines.join("\n");
            },
          });
          return;
        }

        let showTarget = id;
        if (options.package && !id.includes("/") && !id.includes(":")) {
          const pkgRoot = resolvePackageRoot(options.package);
          if (!pkgRoot) {
            throw new ArgumentError(
              `Package '${options.package}' not found in linked packages or path`
            );
          }
          showTarget = `${options.package}/${id}`;
        }

        let resolved;
        try {
          resolved = await resolveActionProject(showTarget);
        } catch (err: any) {
          if (err.message?.includes("not found") || err.message?.includes("no longer exists")) {
            throw new ArgumentError(err.message);
          }
          throw new ExecutionError(err.message);
        }

        const manifest = loadManifest(resolved.projectRoot);
        const actionMeta = manifest?.actions?.[resolved.actionId];

        if (!actionMeta) {
          throw new ArgumentError(
            `Action '${resolved.actionId}' not found in package '${resolved.packageId}'`
          );
        }

        const payload = {
          id: resolved.actionId,
          packageId: resolved.packageId,
          projectRoot: resolved.projectRoot,
          description: actionMeta.description,
          inputSchema: actionMeta.inputSchema,
          outputSchema: actionMeta.outputSchema,
        };

        renderResult(payload, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => {
            const lines = [
              `Action:      ${resolved.actionId}`,
              `Package:     ${resolved.packageId} (${resolved.projectRoot})`,
            ];
            if (actionMeta.description) lines.push(`Description: ${actionMeta.description}`);
            if (actionMeta.inputSchema) {
              lines.push("\nInput Schema:", JSON.stringify(actionMeta.inputSchema, null, 2));
            }
            if (actionMeta.outputSchema) {
              lines.push("\nOutput Schema:", JSON.stringify(actionMeta.outputSchema, null, 2));
            }
            return lines.join("\n");
          },
        });
      } catch (err: any) {
        if (err instanceof ArgumentError || err instanceof ExecutionError) throw err;
        throw new ExecutionError(err.message);
      }
    });
}
