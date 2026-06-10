import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";

export default class ScriptValidateCommand extends BaseCommand {
  static description = "Validate an ActionDock draft script";

  static args = {
    scriptId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ScriptValidateCommand);

    try {
      const client = this.getClient(flags);
      await client.scripts.validate(args.scriptId);

      if (flags.json) {
        this.printJson({ ok: true, scriptId: args.scriptId });
        return;
      }

      this.log(`Validated: ${args.scriptId}`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
