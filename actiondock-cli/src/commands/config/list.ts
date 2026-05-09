import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { buildConfigListView, readConfig } from "../../lib/config.js";

export default class ConfigListCommand extends BaseCommand {
  static description = "List CLI server profiles";

  static flags = {
    ...BaseCommand.baseFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigListCommand);
    const view = buildConfigListView(readConfig());

    if (flags.json) {
      this.printJson(view);
      return;
    }

    if (view.profiles.length === 0) {
      this.log("No profiles configured.");
      return;
    }

    this.log(
      view.profiles
        .map((profile) => [
          profile.current ? "*" : " ",
          profile.name,
          profile.serverUrl ?? "<not set>",
          profile.tokenConfigured ? "token: configured" : "token: <not set>"
        ].join("  "))
        .join("\n")
    );
  }
}
