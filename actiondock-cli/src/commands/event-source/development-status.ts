import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderDevelopmentStatus } from "../../lib/render.js";

export default class EventSourceDevelopmentStatusCommand extends BaseCommand {
  static description = "Show development sync status for an event source";

  static args = {
    sourceId: Args.string({ required: true })
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
    const { args, flags } = await this.parse(EventSourceDevelopmentStatusCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      const item = await client.getEventSourceDevelopmentStatus(args.sourceId);

      if (flags.json) {
        this.printJson(item);
        return;
      }

      this.log(renderDevelopmentStatus(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
