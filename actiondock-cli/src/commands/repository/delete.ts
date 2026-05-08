import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";

export default class RepositoryDeleteCommand extends BaseCommand {
  static description = "Delete an ActionDock repository";

  static args = {
    repositoryId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepositoryDeleteCommand);
    try {
      await createClient(flags).deleteRepository(args.repositoryId);
      flags.json ? this.printJson({ deleted: true, id: args.repositoryId }) : this.log(`仓库已删除: ${args.repositoryId}`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
