import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { renderAccessTokenDetail } from "../../lib/render.js";

export default class AccessTokenCreateCommand extends BaseCommand {
  static description = "Create an ActionDock access token";

  static flags = {
    ...BaseCommand.baseFlags,
    name: Flags.string({ description: "Access token name" }),
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AccessTokenCreateCommand);
    try {
      const item = await this.getClient(flags).accessTokens.create(flags.name);
      flags.json ? this.printJson(item) : this.log(renderAccessTokenDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
