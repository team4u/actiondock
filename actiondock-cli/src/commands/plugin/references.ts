import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderPluginList } from "../../lib/render.js";

export default class PluginReferencesCommand extends BaseCommand {
  static description = "List plugin references available to scripts";

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
    const { flags } = await this.parse(PluginReferencesCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      const items = await client.listPluginReferences();

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
