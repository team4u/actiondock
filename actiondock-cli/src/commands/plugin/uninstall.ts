import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";

export default class PluginUninstallCommand extends BaseCommand {
  static description = "Uninstall an ActionDock plugin";

  static args = {
    pluginId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    force: Flags.boolean({ description: "Force uninstall" }),
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginUninstallCommand);
    try {
      await this.getClient(flags).plugins.uninstall(args.pluginId, flags.force);
      flags.json ? this.printJson({ deleted: true, pluginId: args.pluginId }) : this.log(`插件已卸载: ${args.pluginId}`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
