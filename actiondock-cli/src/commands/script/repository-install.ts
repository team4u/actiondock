import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { buildRepositoryInstallRequest, createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderRepositoryLocalAsset } from "../../lib/render.js";

export default class ScriptRepositoryInstallCommand extends BaseCommand {
  static description = "Install a repository script";

  static args = {
    repositoryId: Args.string({ required: true }),
    scriptId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    "install-schedules": Flags.boolean({ description: "Install schedule templates" }),
    "install-script-dependencies": Flags.boolean({ description: "Install script dependencies" }),
    "install-plugin-dependencies": Flags.boolean({ description: "Install plugin dependencies" }),
    "force-plugin-upgrade": Flags.boolean({ description: "Force plugin dependency upgrades" }),
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ScriptRepositoryInstallCommand);
    try {
      const item = await createClient(flags).installRepositoryTool(args.repositoryId, args.scriptId, buildRepositoryInstallRequest(flags));
      flags.json ? this.printJson(item) : this.log(renderRepositoryLocalAsset(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
