import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderEventSourceDetail } from "../../lib/render.js";

export default class EventSourceUpstreamPullCommand extends BaseCommand {
  static description = "Pull upstream updates into an event source working copy";

  static examples = [
    "<%= config.bin %> <%= command.id %> webhook-source-copy",
    "<%= config.bin %> <%= command.id %> webhook-source-copy --force"
  ];

  static args = {
    sourceId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    force: Flags.boolean({
      description: "Overwrite local changes when pulling",
      default: false
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
    const { args, flags } = await this.parse(EventSourceUpstreamPullCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      const item = await client.pullUpstreamEventSource(args.sourceId, flags.force);

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
