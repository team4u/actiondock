import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../lib/command.js";
import { ActionDockCliError } from "../lib/error.js";
import { runServiceAction, type ServiceAction } from "../lib/service.js";

const ALLOWED_ACTIONS = new Set([
  "install",
  "start",
  "stop",
  "status",
  "restart",
  "uninstall",
]);

export default class ServiceCommand extends BaseCommand {
  static description = "Manage the ActionDock background service";

  static strict = false;

  static args = {
    action: Args.string({
      description: "Service action: install, start, stop, status, restart, uninstall",
      required: true,
    }),
  };

  static flags = {
    ...BaseCommand.baseFlags,
    help: Flags.help({ char: "h" }),
  };

  async run(): Promise<void> {
    if (this.argv.includes("--help") || this.argv.includes("-h")) {
      await this.parse(ServiceCommand);
      return;
    }

    const argv = this.argv.filter((value) => value !== "--json");
    const action = argv[0];

    if (action === undefined) {
      this.error("Missing 1 required arg: action", { exit: 2 });
    }

    if (!ALLOWED_ACTIONS.has(action)) {
      this.error(`Unsupported service action: ${action}`, { exit: 2 });
    }

    try {
      const exitCode = await runServiceAction(action as ServiceAction, argv.slice(1));
      this.exit(exitCode);
    } catch (error) {
      if (error instanceof ActionDockCliError) {
        this.handleError(error);
      }

      throw error;
    }
  }
}
