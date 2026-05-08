import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderConfigValueDetail } from "../../lib/render.js";

export default class ConfigValueGetCommand extends BaseCommand {
  static description = "Show an ActionDock config value";

  static args = {
    key: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigValueGetCommand);
    try {
      const item = await createClient(flags).getConfigValue(args.key);
      flags.json ? this.printJson(item) : this.log(renderConfigValueDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
