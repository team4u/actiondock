import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderRepositoryEventSourceList } from "../../lib/render.js";

export default class EventSourceRepositoryListCommand extends BaseCommand {
  static description = "List repository event sources";

  static flags = {
    ...BaseCommand.baseFlags,
    repository: Flags.string({
      description: "Only show event sources from one repository"
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
    const { flags } = await this.parse(EventSourceRepositoryListCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags.server),
        token: resolveToken(flags.token)
      });
      const items = flags.repository
        ? await client.listRepositoryEventSourcesByRepository(flags.repository)
        : await client.listRepositoryEventSources();

      if (flags.json) {
        this.printJson(items);
        return;
      }

      this.log(renderRepositoryEventSourceList(items));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
