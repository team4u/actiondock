import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { renderPlaybookDetail } from "../../lib/render.js";

export default class PlaybookGetCommand extends BaseCommand {
  static description = "Get an ActionDock playbook";

  static args = {
    "playbook-id": Args.string({ required: true, description: "Playbook ID" })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PlaybookGetCommand);
    try {
      const item = await this.getClient(flags).playbooks.get(args["playbook-id"]);
      flags.json ? this.printJson(item) : this.log(renderPlaybookDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
