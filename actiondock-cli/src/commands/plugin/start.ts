import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { renderPluginDetail } from "../../lib/render.js";

export default class PluginStartCommand extends BaseCommand {
  static description = "Start an ActionDock plugin";

  static args = {
    pluginId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginStartCommand);
    try {
      const plugin = await this.getClient(flags).plugins.start(args.pluginId);
      flags.json ? this.printJson(plugin) : this.log(renderPluginDetail(plugin));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
