import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";

export default class ConfigValueDeleteCommand extends BaseCommand {
  static description = "Delete an ActionDock config value";

  static args = {
    key: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigValueDeleteCommand);
    try {
      await createClient(flags).deleteConfigValue(args.key);
      flags.json ? this.printJson({ deleted: true, key: args.key }) : this.log(`配置值已删除: ${args.key}`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
