import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { intentFlag, listWithIntentFallback } from "../../lib/command-helpers.js";
import { renderPluginList } from "../../lib/render.js";

export default class PluginListCommand extends BaseCommand {
  static description = "List installed ActionDock plugins";

  static flags = {
    ...BaseCommand.baseFlags,
    intent: intentFlag,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PluginListCommand);

    try {
      const client = this.getClient(flags);
      const items = await listWithIntentFallback(flags.intent, (intent) => client.plugins.list(intent));

      if (flags.json) {
        this.printJson(items);
        return;
      }

      this.log(renderPluginList(items));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
