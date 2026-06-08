import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../../lib/command.js";
import { createClient, serverTokenFlags } from "../../../lib/command-helpers.js";
import { renderPluginConfigList } from "../../../lib/render.js";

export default class PluginConfigListCommand extends BaseCommand {
  static description = "List saved configs for an installed plugin";

  static args = {
    pluginId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginConfigListCommand);
    try {
      const items = await createClient(flags).plugins.listConfigs(args.pluginId);
      flags.json ? this.printJson(items) : this.log(renderPluginConfigList(items));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
