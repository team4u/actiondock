import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../../lib/command.js";
import { ActionDockClient } from "../../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../../lib/config.js";
import { renderPluginConfig } from "../../../lib/render.js";

export default class PluginConfigGetCommand extends BaseCommand {
  static description = "Show the saved config for an installed plugin";

  static args = {
    pluginId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    profile: Flags.string({
      description: "Use a configured server profile"
    }),
    server: Flags.string({
      description: "Override ActionDock server URL"
    }),
    token: Flags.string({
      description: "Override ActionDock bearer token"
    }),
    "config-name": Flags.string({
      description: "Named plugin config to show"
    }),
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginConfigGetCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      const config = flags["config-name"]
        ? await client.plugins.getNamedConfig(args.pluginId, flags["config-name"])
        : await client.plugins.getConfig(args.pluginId);

      if (flags.json) {
        this.printJson(config);
        return;
      }

      this.log(renderPluginConfig(config));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
