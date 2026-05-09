import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { buildConfigView, upsertProfile } from "../../lib/config.js";

export default class ConfigAddCommand extends BaseCommand {
  static description = "Create or update a CLI server profile";

  static args = {
    name: Args.string({ description: "profile name", required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    server: Flags.string({
      description: "ActionDock server URL",
      required: true
    }),
    token: Flags.string({
      description: "ActionDock bearer token"
    }),
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigAddCommand);

    try {
      const next = upsertProfile(args.name, {
        serverUrl: flags.server,
        token: flags.token?.trim() || undefined
      });
      const view = buildConfigView(next, args.name);
      if (flags.json) {
        this.printJson(view);
        return;
      }

      this.log(`Profile ${args.name} 已保存。`);
      this.log(`Current profile: ${view.currentProfile ?? "<not set>"}`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
