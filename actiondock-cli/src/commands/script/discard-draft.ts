import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { renderScriptDetail } from "../../lib/render.js";

export default class ScriptDiscardDraftCommand extends BaseCommand {
  static description = "Discard draft changes and restore the published snapshot";

  static args = {
    scriptId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ScriptDiscardDraftCommand);

    try {
      const client = this.getClient(flags);
      const script = await client.scripts.discardDraft(args.scriptId);

      if (flags.json) {
        this.printJson(script);
        return;
      }

      this.log(renderScriptDetail(script, "draft"));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
