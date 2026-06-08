import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { renderScriptDetail } from "../../lib/render.js";

export default class ScriptGetCommand extends BaseCommand {
  static description = "Show a published or draft ActionDock script definition";

  static args = {
    scriptId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    draft: Flags.boolean({
      description: "Read the draft script instead of the published snapshot"
    }),
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ScriptGetCommand);

    try {
      const client = this.getClient(flags);
      const script = await client.scripts.get(args.scriptId, flags.draft);

      if (flags.json) {
        this.printJson(script);
        return;
      }

      this.log(renderScriptDetail(script, flags.draft ? "draft" : "published"));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
