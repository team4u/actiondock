import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderRepositoryList } from "../../lib/render.js";

export default class RepositoryListCommand extends BaseCommand {
  static description = "List ActionDock repositories";

  static flags = {
    ...BaseCommand.baseFlags,
    purpose: Flags.string({ description: "Repository purpose", options: ["capability", "project"] }),
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(RepositoryListCommand);
    try {
      const items = await createClient(flags).listRepositories(flags.purpose?.toUpperCase());
      flags.json ? this.printJson(items) : this.log(renderRepositoryList(items));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
