import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { parseIncomingEventPayload } from "../../lib/event.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";

export default class EventSourceTestNormalizationCommand extends BaseCommand {
  static description = "Test normalization for an ActionDock event source";

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
    const { args, flags } = await this.parse(EventSourceTestNormalizationCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      const result = await client.testEventSourceNormalization(
        args.sourceId,
        parseIncomingEventPayload(flags["payload-json"], flags["payload-file"])
      );

      this.printJson(result);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
