import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderRepositoryLocalAsset } from "../../lib/render.js";

export default class ScriptRepositoryWorkingCopyCommand extends BaseCommand {
  static description = "Create a script working copy from a repository script";

  static examples = [
    "<%= config.bin %> <%= command.id %> demo-repo hello-groovy",
    "<%= config.bin %> <%= command.id %> demo-repo hello-groovy --script-id hello-groovy-copy"
  ];

  static args = {
    repositoryId: Args.string({ required: true }),
    scriptId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    "script-id": Flags.string({ description: "Working copy script ID override" }),
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ScriptRepositoryWorkingCopyCommand);
    try {
      const item = await createClient(flags).createRepositoryToolWorkingCopy(args.repositoryId, args.scriptId, flags["script-id"]);
      flags.json ? this.printJson(item) : this.log(renderRepositoryLocalAsset(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
