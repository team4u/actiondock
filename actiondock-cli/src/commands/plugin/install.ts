import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";

export default class PluginInstallCommand extends BaseCommand {
  static description = "Install an ActionDock plugin from a local JAR";

  static args = {
    jarPath: Args.string({ required: true })
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
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginInstallCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      const plugin = await client.installPlugin(args.jarPath);

      if (flags.json) {
        this.printJson(plugin);
        return;
      }

      this.log(`插件已安装: ${plugin.pluginId}${plugin.version ? `@${plugin.version}` : ""}`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
