import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";

export default class PluginInstallCommand extends BaseCommand {
  static description = "Install an ActionDock plugin from a local JAR";

  static args = {
    jarPath: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginInstallCommand);

    try {
      const client = this.getClient(flags);
      const plugin = await client.plugins.install(args.jarPath);

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
