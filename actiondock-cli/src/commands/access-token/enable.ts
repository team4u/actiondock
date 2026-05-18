import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderAccessTokenDetail } from "../../lib/render.js";

export default class AccessTokenEnableCommand extends BaseCommand {
  static description = "Enable an ActionDock access token";

  static args = {
    tokenId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AccessTokenEnableCommand);
    try {
      const item = await createClient(flags).enableAccessToken(args.tokenId);
      flags.json ? this.printJson(item) : this.log(renderAccessTokenDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
