import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderEventDispatchList } from "../../lib/render.js";

export default class EventTriggerDispatchesCommand extends BaseCommand {
  static description = "List dispatch records for an ActionDock event trigger";

  static args = {
    triggerId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    server: Flags.string({
      description: "Override ActionDock server URL"
    }),
    token: Flags.string({
      description: "Override ActionDock bearer token"
    }),
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EventTriggerDispatchesCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags.server),
        token: resolveToken(flags.token)
      });
      const items = await client.listEventTriggerDispatches(args.triggerId);

      if (flags.json) {
        this.printJson(items);
        return;
      }

      this.log(renderEventDispatchList(items));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
