import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, intentFlag, listWithIntentFallback } from "../../lib/command-helpers.js";
import { renderPlaybookList, summarizePlaybookList } from "../../lib/render.js";

export default class PlaybookListCommand extends BaseCommand {
  static description = "List ActionDock playbooks";

  static flags = {
    ...BaseCommand.baseFlags,
    "repository-id": Flags.string({ description: "Filter by repository ID" }),
    tag: Flags.string({ description: "Filter by tag" }),
    enabled: Flags.boolean({ description: "Only enabled playbooks" }),
    managed: Flags.boolean({ description: "Only managed playbooks" }),
    intent: intentFlag,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PlaybookListCommand);
    try {
      const client = this.getClient(flags);
      const params = {
        repositoryId: flags["repository-id"],
        tag: flags.tag,
        enabled: flags.enabled ? true : undefined,
        managed: flags.managed ? true : undefined
      };
      const items = await listWithIntentFallback(flags.intent, (intent) => client.playbooks.list({ ...params, intent }));
      flags.json ? this.printJson(summarizePlaybookList(items)) : this.log(renderPlaybookList(items));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
