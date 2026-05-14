import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../../lib/command.js";
import { buildRepositoryInstallRequest, createClient, serverTokenFlags } from "../../../lib/command-helpers.js";
import { renderRepositoryLocalAsset } from "../../../lib/render.js";

export default class RepositoryToolUpdateCommand extends BaseCommand {
  static description = "Update an installed repository tool";

  static args = {
    repositoryId: Args.string({ required: true }),
    toolId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    "install-schedules": Flags.boolean({ description: "Update schedule templates" }),
    "install-script-dependencies": Flags.boolean({ description: "Update script dependencies" }),
    "install-plugin-dependencies": Flags.boolean({ description: "Update plugin dependencies" }),
    "force-plugin-upgrade": Flags.boolean({ description: "Force plugin dependency upgrades" }),
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepositoryToolUpdateCommand);
    try {
      const item = await createClient(flags).updateRepositoryTool(args.repositoryId, args.toolId, buildRepositoryInstallRequest(flags));
      flags.json ? this.printJson(item) : this.log(renderRepositoryLocalAsset(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
