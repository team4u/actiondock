import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderAccessTokenDetail } from "../../lib/render.js";

export default class AccessTokenRenameCommand extends BaseCommand {
  static description = "Rename an ActionDock access token";

  static args = {
    tokenId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    name: Flags.string({ description: "New access token name", required: true }),
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AccessTokenRenameCommand);
    try {
      const item = await createClient(flags).renameAccessToken(args.tokenId, flags.name);
      flags.json ? this.printJson(item) : this.log(renderAccessTokenDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
