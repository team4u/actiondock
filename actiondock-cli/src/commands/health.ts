import { Flags } from "@oclif/core";

import { BaseCommand } from "../lib/command.js";

export default class HealthCommand extends BaseCommand {
  static description = "Check ActionDock server health";

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(HealthCommand);

    try {
      const client = this.getClient(flags);
      const health = await client.health.health();

      if (flags.json) {
        this.printJson(health);
        return;
      }

      this.log(`ActionDock server ${health.status ?? "UNKNOWN"} at ${health.server}`);
      if (!health.ok) {
        this.exit(5);
      }
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
