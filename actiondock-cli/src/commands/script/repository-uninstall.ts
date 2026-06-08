import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";

export default class ScriptRepositoryUninstallCommand extends BaseCommand {
  static description = "Uninstall an installed repository script by script ID";

  static args = {
    scriptId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ScriptRepositoryUninstallCommand);
    try {
      await this.getClient(flags).repositories.uninstallTool(args.scriptId);
      flags.json ? this.printJson({ uninstalled: true, scriptId: args.scriptId }) : this.log(`仓库脚本已卸载: ${args.scriptId}`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
