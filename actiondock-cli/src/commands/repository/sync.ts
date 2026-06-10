import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { renderRepositoryDetail } from "../../lib/render.js";

export default class RepositorySyncCommand extends BaseCommand {
  static description = "Sync an ActionDock repository";

  static args = {
    repositoryId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepositorySyncCommand);
    try {
      const item = await this.getClient(flags).repositories.sync(args.repositoryId);
      flags.json ? this.printJson(item) : this.log(renderRepositoryDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
