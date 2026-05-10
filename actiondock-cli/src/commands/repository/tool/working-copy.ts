import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../../lib/command.js";
import { createClient, serverTokenFlags } from "../../../lib/command-helpers.js";
import { renderScriptDetail } from "../../../lib/render.js";

export default class RepositoryToolWorkingCopyCommand extends BaseCommand {
  static description = "Create a script working copy from a repository tool";

  static examples = [
    "<%= config.bin %> <%= command.id %> demo-repo hello-groovy",
    "<%= config.bin %> <%= command.id %> demo-repo hello-groovy --script-id hello-groovy-copy"
  ];

  static args = {
    repositoryId: Args.string({ required: true }),
    toolId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    "script-id": Flags.string({ description: "Working copy script ID override" }),
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepositoryToolWorkingCopyCommand);
    try {
      const item = await createClient(flags).createRepositoryToolWorkingCopy(args.repositoryId, args.toolId, flags["script-id"]);
      flags.json ? this.printJson(item) : this.log(renderScriptDetail(item, "draft"));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
