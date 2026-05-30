import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderPlaybookGroupDetail } from "../../lib/render.js";

export default class PlaybookGroupGetCommand extends BaseCommand {
  static description = "Get an ActionDock playbook group";

  static args = {
    "group-id": Args.string({ required: true, description: "Playbook group ID" })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PlaybookGroupGetCommand);
    try {
      const item = await createClient(flags).getPlaybookGroup(args["group-id"]);
      flags.json ? this.printJson(item) : this.log(renderPlaybookGroupDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
