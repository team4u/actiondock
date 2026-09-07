import {
  fetchRemoteActionShow,
  loadManifest,
  loadProjectConfig,
  resolveActionProject,
  resolveTarget,
} from "@actiondock/core";
import { ExecutionError } from "@actiondock/runtime-cli";
import type { Command } from "commander";

export function registerActionShowCommand(actionCmd: Command): void {
  actionCmd
    .command("show <id>")
    .alias("describe")
    .description("Show action definition, schema, and description")
    .option("-p, --profile <name>", "Execute or query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
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
          if (options.json) {
            console.log(JSON.stringify(detail, null, 2));
          } else {
            console.log(`Action:      ${detail.id}`);
            if (detail.packageId) console.log(`Package:     ${detail.packageId}`);
            if (detail.description) console.log(`Description: ${detail.description}`);
            if (detail.inputSchema) {
              console.log("\nInput Schema:");
              console.log(JSON.stringify(detail.inputSchema, null, 2));
            }
            if (detail.outputSchema) {
              console.log("\nOutput Schema:");
              console.log(JSON.stringify(detail.outputSchema, null, 2));
            }
          }
          return;
        }

        const resolved = await resolveActionProject(id);
        const manifest = loadManifest(resolved.projectRoot);
        const actionMeta = manifest?.actions?.[resolved.actionId];

        if (!actionMeta) {
          throw new ExecutionError(`Action '${resolved.actionId}' not found in package '${resolved.packageId}'`);
        }

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                id: resolved.actionId,
                packageId: resolved.packageId,
                description: actionMeta.description,
                inputSchema: actionMeta.inputSchema,
                outputSchema: actionMeta.outputSchema,
              },
              null,
              2
            )
          );
        } else {
          console.log(`Action:      ${resolved.actionId}`);
          console.log(`Package:     ${resolved.packageId} (${resolved.projectRoot})`);
          if (actionMeta.description) console.log(`Description: ${actionMeta.description}`);
          if (actionMeta.inputSchema) {
            console.log("\nInput Schema:");
            console.log(JSON.stringify(actionMeta.inputSchema, null, 2));
          }
          if (actionMeta.outputSchema) {
            console.log("\nOutput Schema:");
            console.log(JSON.stringify(actionMeta.outputSchema, null, 2));
          }
        }
      } catch (err: any) {
        if (err instanceof ExecutionError) throw err;
        throw new ExecutionError(err.message);
      }
    });
}
