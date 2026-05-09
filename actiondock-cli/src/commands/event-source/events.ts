import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderEventRecordList } from "../../lib/render.js";

export default class EventSourceEventsCommand extends BaseCommand {
  static description = "List recent event records for an ActionDock event source";

  static args = {
    sourceId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    limit: Flags.integer({
      description: "Maximum number of records to return"
    }),
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
    const { args, flags } = await this.parse(EventSourceEventsCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      const items = await client.listEventSourceEvents(args.sourceId, flags.limit);

      if (flags.json) {
        this.printJson(items);
        return;
      }

      this.log(renderEventRecordList(items));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
