import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { buildConfigView, readConfig, setConfigValue } from "../../lib/config.js";
import { ActionDockCliError } from "../../lib/error.js";

export default class ConfigSetCommand extends BaseCommand {
  static description = "Persist local CLI configuration";

  static args = {
    key: Args.string({ description: "server or token", required: true }),
    value: Args.string({ description: "value to store", required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    profile: Flags.string({
      description: "Profile to update"
    }),
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigSetCommand);

    try {
      if (args.key !== "server" && args.key !== "token") {
        throw new ActionDockCliError("`config set` 只支持 `server` 或 `token`。", 2);
      }

      const next = setConfigValue(args.key === "server" ? "serverUrl" : "token", args.value, flags.profile);
      const view = buildConfigView(next, flags.profile);
      if (flags.json) {
        this.printJson(view);
        return;
      }

      this.log(`${args.key} 已保存到 profile ${view.profile}。`);
      this.log(`Config file: ${buildConfigView(readConfig()).path}`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
