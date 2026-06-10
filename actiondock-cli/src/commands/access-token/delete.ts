import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";

export default class AccessTokenDeleteCommand extends BaseCommand {
  static description = "Delete an ActionDock access token";

  static args = {
    tokenId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AccessTokenDeleteCommand);
    try {
      await this.getClient(flags).accessTokens.delete(args.tokenId);
      flags.json ? this.printJson({ deleted: true, id: args.tokenId }) : this.log(`访问令牌已删除: ${args.tokenId}`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
