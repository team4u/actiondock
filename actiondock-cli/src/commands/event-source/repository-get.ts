import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderRepositoryEventSourceDetail } from "../../lib/render.js";

export default class EventSourceRepositoryGetCommand extends BaseCommand {
  static description = "Show a repository event source";

  static args = {
    repositoryId: Args.string({ required: true }),
    eventSourceId: Args.string({ required: true })
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
    const { args, flags } = await this.parse(EventSourceRepositoryGetCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags.server),
        token: resolveToken(flags.token)
      });
      const item = await client.getRepositoryEventSource(args.repositoryId, args.eventSourceId);

      if (flags.json) {
        this.printJson(item);
        return;
      }

      this.log(renderRepositoryEventSourceDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
