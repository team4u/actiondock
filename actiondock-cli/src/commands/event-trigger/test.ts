import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { parseNormalizedEvent } from "../../lib/event.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderEventTriggerTestResult } from "../../lib/render.js";

export default class EventTriggerTestCommand extends BaseCommand {
  static description = "Test an ActionDock event trigger";

  static args = {
    triggerId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    "event-json": Flags.string({
      description: "Inline JSON object for the normalized event",
      required: true
    }),
    "event-file": Flags.string({
      description: "Path to a JSON file containing the normalized event"
    }),
    execute: Flags.boolean({
      description: "Execute the target script after mapping"
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
    const { args, flags } = await this.parse(EventTriggerTestCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags.server),
        token: resolveToken(flags.token)
      });
      const result = await client.testEventTrigger(args.triggerId, {
        event: parseNormalizedEvent(flags["event-json"], flags["event-file"]),
        execute: flags.execute
      });

      if (flags.json) {
        this.printJson(result);
        return;
      }

      this.log(renderEventTriggerTestResult(result));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
