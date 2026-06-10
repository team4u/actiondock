import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { readDefinitionFile } from "../../lib/command-helpers.js";
import { renderPlaybookDetail } from "../../lib/render.js";
import type { Playbook } from "../../lib/types.js";

export default class PlaybookCreateCommand extends BaseCommand {
  static description = "Create an ActionDock playbook from a definition file";

  static flags = {
    ...BaseCommand.baseFlags,
    "definition-file": Flags.string({ description: "Path to playbook JSON definition", required: true }),
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PlaybookCreateCommand);
    try {
      const item = await this.getClient(flags).playbooks.create(readDefinitionFile<Playbook>(flags["definition-file"]));
      flags.json ? this.printJson(item) : this.log(renderPlaybookDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
