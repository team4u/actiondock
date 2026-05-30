import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, readDefinitionFile, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderPlaybookGroupDetail } from "../../lib/render.js";
import type { PlaybookGroup } from "../../lib/types.js";

export default class PlaybookGroupUpdateCommand extends BaseCommand {
  static description = "Update an ActionDock playbook group from a definition file";

  static args = {
    "group-id": Args.string({ required: true, description: "Playbook group ID" })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    "definition-file": Flags.string({ description: "Path to playbook group JSON definition", required: true }),
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PlaybookGroupUpdateCommand);
    try {
      const payload = readDefinitionFile<PlaybookGroup>(flags["definition-file"]);
      const item = await createClient(flags).updatePlaybookGroup(args["group-id"], payload);
      flags.json ? this.printJson(item) : this.log(renderPlaybookGroupDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
