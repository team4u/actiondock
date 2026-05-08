import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderConfigValueList } from "../../lib/render.js";

export default class ConfigValueListCommand extends BaseCommand {
  static description = "List ActionDock config values";

  static flags = {
    ...BaseCommand.baseFlags,
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigValueListCommand);
    try {
      const items = await createClient(flags).listConfigValues();
      flags.json ? this.printJson(items) : this.log(renderConfigValueList(items));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
