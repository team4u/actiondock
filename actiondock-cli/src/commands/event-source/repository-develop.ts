import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderEventSourceDetail } from "../../lib/render.js";

export default class EventSourceRepositoryDevelopCommand extends BaseCommand {
  static description = "Sync a repository event source into a local development event source";

  static args = {
    repositoryId: Args.string({ required: true }),
    eventSourceId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    sourceId: Flags.string({
      description: "Override the local development event source ID"
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
    const { args, flags } = await this.parse(EventSourceRepositoryDevelopCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags.server),
        token: resolveToken(flags.token)
      });
      const item = await client.developRepositoryEventSource(args.repositoryId, args.eventSourceId, flags.sourceId);

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
