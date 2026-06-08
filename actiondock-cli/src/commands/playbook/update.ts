import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { readDefinitionFile } from "../../lib/command-helpers.js";
import { renderPlaybookDetail } from "../../lib/render.js";
import type { Playbook } from "../../lib/types.js";

export default class PlaybookUpdateCommand extends BaseCommand {
  static description = "Update an ActionDock playbook from a definition file";

  static args = {
    "playbook-id": Args.string({ required: true, description: "Playbook ID" })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    "definition-file": Flags.string({ description: "Path to playbook JSON definition", required: true }),
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PlaybookUpdateCommand);
    try {
      const payload = readDefinitionFile<Playbook>(flags["definition-file"]);
      const item = await this.getClient(flags).playbooks.update(args["playbook-id"], payload);
      flags.json ? this.printJson(item) : this.log(renderPlaybookDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
