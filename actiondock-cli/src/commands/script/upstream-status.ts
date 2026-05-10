import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderUpstreamStatus } from "../../lib/render.js";

export default class ScriptUpstreamStatusCommand extends BaseCommand {
  static description = "Show upstream sync status for a script working copy";

  static examples = [
    "<%= config.bin %> <%= command.id %> hello-groovy-copy",
    "<%= config.bin %> <%= command.id %> hello-groovy-copy --json"
  ];

  static args = {
    scriptId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ScriptUpstreamStatusCommand);
    try {
      const item = await createClient(flags).getScriptUpstreamStatus(args.scriptId);
      flags.json ? this.printJson(item) : this.log(renderUpstreamStatus(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
