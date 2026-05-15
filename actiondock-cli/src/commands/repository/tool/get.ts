import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../../lib/command.js";
import { createClient, serverTokenFlags } from "../../../lib/command-helpers.js";
import { renderRepositoryToolDetail } from "../../../lib/render.js";

export default class RepositoryToolGetCommand extends BaseCommand {
  static description = "Show a repository script";

  static args = {
    repositoryId: Args.string({ required: true }),
    toolId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepositoryToolGetCommand);
    try {
      const item = await createClient(flags).getRepositoryTool(args.repositoryId, args.toolId);
      flags.json ? this.printJson(item) : this.log(renderRepositoryToolDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
