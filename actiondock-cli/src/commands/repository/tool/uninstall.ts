import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../../lib/command.js";
import { createClient, serverTokenFlags } from "../../../lib/command-helpers.js";

export default class RepositoryToolUninstallCommand extends BaseCommand {
  static description = "Uninstall an installed repository tool by script ID";

  static args = {
    scriptId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepositoryToolUninstallCommand);
    try {
      await createClient(flags).uninstallRepositoryTool(args.scriptId);
      flags.json ? this.printJson({ uninstalled: true, scriptId: args.scriptId }) : this.log(`仓库工具已卸载: ${args.scriptId}`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
