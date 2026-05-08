import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderAccessTokenList } from "../../lib/render.js";

export default class AccessTokenListCommand extends BaseCommand {
  static description = "List ActionDock access tokens";

  static flags = {
    ...BaseCommand.baseFlags,
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AccessTokenListCommand);
    try {
      const items = await createClient(flags).listAccessTokens();
      flags.json ? this.printJson(items) : this.log(renderAccessTokenList(items));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
