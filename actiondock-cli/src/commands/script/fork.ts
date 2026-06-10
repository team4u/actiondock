import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { renderScriptDetail } from "../../lib/render.js";

export default class ScriptForkCommand extends BaseCommand {
  static description = "Fork an ActionDock script";

  static args = {
    sourceScriptId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    "script-id": Flags.string({
      description: "Target script ID",
      required: true
    }),
    name: Flags.string({
      description: "Target script name",
      required: true
    }),
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ScriptForkCommand);
    try {
      const script = await this.getClient(flags).scripts.fork(args.sourceScriptId, {
        id: flags["script-id"],
        name: flags.name
      });
      flags.json ? this.printJson(script) : this.log(renderScriptDetail(script, "draft"));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
