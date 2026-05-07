import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderEventSourceDetail } from "../../lib/render.js";

export default class EventSourceDevelopmentPullCommand extends BaseCommand {
  static description = "Pull remote updates into a development event source";

  static args = {
    sourceId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    force: Flags.boolean({
      description: "Overwrite local changes when pulling",
      default: false
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
    const { args, flags } = await this.parse(EventSourceDevelopmentPullCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags.server),
        token: resolveToken(flags.token)
      });
      const item = await client.pullDevelopmentEventSource(args.sourceId, flags.force);

      if (flags.json) {
        this.printJson(item);
        return;
      }

      this.log(renderEventSourceDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
