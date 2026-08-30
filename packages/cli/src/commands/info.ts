import {
  findProjectRoot,
  loadActions,
  loadPlaybooks,
  loadProjectConfig,
} from "@actiondock/core";
import { Command } from "commander";

export function registerInfoCommand(program: Command): void {
  program
    .command("info")
    .description("Display information about the current ActionDock project")
    .option("--json", "Output information as JSON")
    .action(async (options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project (actiondock.json not found)");
        process.exit(1);
      }

      try {
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
              const def = item?.default !== undefined ? ` (default: ${JSON.stringify(item.default)})` : "";
              console.log(`  - ${k.padEnd(24)} ${item?.description || ""}${def}`);
            }
          }
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}
