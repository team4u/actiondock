import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";

export default class PlaybookDeleteCommand extends BaseCommand {
  static description = "Delete an ActionDock playbook";

  static args = {
    "playbook-id": Args.string({ required: true, description: "Playbook ID" })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PlaybookDeleteCommand);
    try {
      await this.getClient(flags).playbooks.delete(args["playbook-id"]);
      flags.json ? this.printJson({ deleted: true, id: args["playbook-id"] }) : this.log(`Deleted playbook: ${args["playbook-id"]}`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
