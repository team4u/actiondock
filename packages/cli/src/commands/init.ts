import { initProject } from "@actiondock/core";
import { ExecutionError } from "@actiondock/runtime-cli";
import { Command } from "commander";

export function registerInitCommand(program: Command): void {
  program
    .command("init [directory]")
    .description("Initialize a new ActionDock project")
    .option("-i, --id <id>", "Project identifier")
    .option("-n, --name <name>", "Project display name")
    .option("-d, --desc <description>", "Project description")
    .action((dir = ".", options) => {
      try {
        initProject(dir, {
          id: options.id,
          name: options.name,
          description: options.desc,
        });
        console.log(`Successfully initialized ActionDock project in ${dir}`);
      } catch (err: any) {
        throw new ExecutionError(err.message);
      }
    });
}
