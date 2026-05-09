import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { parseIncomingEventPayload } from "../../lib/event.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderEventIngestionResult } from "../../lib/render.js";

export default class EventSourceIngestCommand extends BaseCommand {
  static description = "Simulate webhook ingestion for an ActionDock event source";

  static args = {
    sourceId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    "payload-json": Flags.string({
      description: "Inline JSON object for the incoming event payload"
    }),
    "payload-file": Flags.string({
      description: "Path to a JSON file containing the incoming event payload"
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
    const { args, flags } = await this.parse(EventSourceIngestCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      const result = await client.ingestEventSource(
        args.sourceId,
        parseIncomingEventPayload(flags["payload-json"], flags["payload-file"])
      );

      if (flags.json) {
        this.printJson(result);
        return;
      }

      this.log(renderEventIngestionResult(result));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
