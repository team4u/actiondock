import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { buildConfigView, useProfile } from "../../lib/config.js";

export default class ConfigUseCommand extends BaseCommand {
  static description = "Set the current CLI server profile";

  static args = {
    name: Args.string({ description: "profile name", required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigUseCommand);

    try {
      const next = useProfile(args.name);
      const view = buildConfigView(next, args.name);
      if (flags.json) {
        this.printJson(view);
        return;
      }

      this.log(`Current profile: ${view.currentProfile}`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
