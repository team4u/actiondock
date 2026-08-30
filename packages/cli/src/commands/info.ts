import {
  fetchRemoteInfo,
  findProjectRoot,
  loadActions,
  loadPlaybooks,
  loadProjectConfig,
  resolveTarget,
} from "@actiondock/core";
import { Command } from "commander";

export function registerInfoCommand(program: Command): void {
  program
    .command("info")
    .description("Display information about the current ActionDock project or remote target")
    .option("-p, --profile <name>", "Query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--json", "Output information as JSON")
    .action(async (options) => {
      try {
        const target = resolveTarget({
          profile: options.profile,
          server: options.server,
          token: options.token,
        });

        if (target.type === "remote") {
          const remoteInfo = await fetchRemoteInfo(
            target.serverUrl!,
            target.token
          );
          if (options.json) {
            console.log(JSON.stringify(remoteInfo, null, 2));
          } else {
            console.log(
              `Remote ActionDock Server: ${target.serverUrl}${target.profileName ? ` (Profile: ${target.profileName})` : ""}`
            );
            if (remoteInfo.id) {
              console.log(`Project:     ${remoteInfo.name || remoteInfo.id} (${remoteInfo.id})`);
              console.log(`Version:     ${remoteInfo.version || "unknown"}`);
              if (remoteInfo.description) {
                console.log(`Description: ${remoteInfo.description}`);
              }
              if (Array.isArray(remoteInfo.actions)) {
                console.log(`\nActions (${remoteInfo.actions.length}):`);
                for (const actId of remoteInfo.actions) {
                  console.log(`  - ${actId}`);
                }
              }
            } else if (Array.isArray(remoteInfo.linkedPackages)) {
              console.log(`Version:     ${remoteInfo.version || "2.0.0"}`);
              console.log(`\nLinked Packages (${remoteInfo.linkedPackages.length}):`);
              for (const pkg of remoteInfo.linkedPackages) {
                console.log(`  - ${pkg.id} (${pkg.path})`);
              }
            } else {
              console.log(JSON.stringify(remoteInfo, null, 2));
            }
          }
          return;
        }

        const root = findProjectRoot();
        if (!root) {
          console.error("Error: Not in an ActionDock project (actiondock.json not found)");
          process.exit(1);
        }

        const config = loadProjectConfig(root);
        const actions = await loadActions(root, config.actionsDir);
        const playbooks = loadPlaybooks(root, config.playbooksDir);

        const info = {
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
        };

        if (options.json) {
          console.log(JSON.stringify(info, null, 2));
        } else {
          console.log(`ActionDock Project: ${info.name} (${info.id})`);
          console.log(`Version:     ${info.version}`);
          if (info.description) console.log(`Description: ${info.description}`);
          console.log(`Root:        ${info.projectRoot}`);
          console.log(`\nActions (${info.actionsCount}):`);
          for (const [id, act] of actions.entries()) {
            console.log(`  - ${id.padEnd(28)} ${act.description || ""}`);
          }
          console.log(`\nPlaybooks (${info.playbooksCount}):`);
          for (const [id, pb] of playbooks.entries()) {
            console.log(`  - ${id.padEnd(28)} ${pb.description || ""}`);
          }
          if (info.configDeclared.length > 0) {
            console.log(`\nDeclared Config Keys:`);
            for (const k of info.configDeclared) {
              const item = config.config?.[k];
              const isSec = item?.secret ? " [secret]" : "";
              const def = item?.default !== undefined ? ` (default: ${JSON.stringify(item.default)})` : "";
              console.log(`  - ${k.padEnd(24)} ${item?.description || ""}${def}${isSec}`);
            }
          }
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}
