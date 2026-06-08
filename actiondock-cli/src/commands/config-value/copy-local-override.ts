import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { renderConfigValueDetail } from "../../lib/render.js";

export default class ConfigValueCopyLocalOverrideCommand extends BaseCommand {
  static description = "Copy a managed config value as a local override";

  static args = {
    key: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigValueCopyLocalOverrideCommand);
    try {
      const item = await this.getClient(flags).configValues.copyLocalOverride(args.key);
      flags.json ? this.printJson(item) : this.log(renderConfigValueDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
