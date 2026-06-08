import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, intentFlag, listWithIntentFallback } from "../../lib/command-helpers.js";
import { renderRepositoryScriptList } from "../../lib/render.js";

export default class ScriptRepositoryListCommand extends BaseCommand {
  static description = "List repository scripts";

  static flags = {
    ...BaseCommand.baseFlags,
    repository: Flags.string({ description: "Filter by repository ID" }),
    intent: intentFlag,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ScriptRepositoryListCommand);
    try {
      const client = this.getClient(flags);
      const items = await listWithIntentFallback(flags.intent, (intent) => client.repositories.listScripts(flags.repository, intent));
      flags.json ? this.printJson(items) : this.log(renderRepositoryScriptList(items));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
