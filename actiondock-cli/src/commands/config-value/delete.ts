import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";

export default class ConfigValueDeleteCommand extends BaseCommand {
  static description = "Delete an ActionDock config value";

  static args = {
    key: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigValueDeleteCommand);
    try {
      await this.getClient(flags).configValues.delete(args.key);
      flags.json ? this.printJson({ deleted: true, key: args.key }) : this.log(`配置值已删除: ${args.key}`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
