import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";

export default class ScriptValidateCommand extends BaseCommand {
  static description = "Validate an ActionDock draft script";

  static args = {
    scriptId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    profile: Flags.string({
      description: "Use a configured server profile"
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
    const { args, flags } = await this.parse(ScriptValidateCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      await client.validateScript(args.scriptId);

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
