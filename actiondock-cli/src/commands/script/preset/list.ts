import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../../lib/command.js";
import { createClient, intentFlag, listWithIntentFallback } from "../../../lib/command-helpers.js";
import { renderExecutionPresetList } from "../../../lib/render.js";

export default class ScriptPresetListCommand extends BaseCommand {
  static description = "List script execution presets";

  static args = {
    scriptId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    intent: intentFlag,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ScriptPresetListCommand);
    try {
      const client = this.getClient(flags);
      const items = await listWithIntentFallback(flags.intent, (intent) => client.presets.list(args.scriptId, intent));
      flags.json ? this.printJson(items) : this.log(renderExecutionPresetList(items));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
