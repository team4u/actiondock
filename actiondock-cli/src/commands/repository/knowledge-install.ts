import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";

export default class RepositoryKnowledgeInstallCommand extends BaseCommand {
  static description = "Install a knowledge entry as a project repository";

  static flags = {
    ...BaseCommand.baseFlags,
    "repository-id": Flags.string({ description: "Repository ID", required: true }),
    "knowledge-id": Flags.string({ description: "Knowledge entry ID", required: true }),
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(RepositoryKnowledgeInstallCommand);
    try {
      const result = await createClient(flags).installRepositoryKnowledge(flags["repository-id"], flags["knowledge-id"]);
      flags.json ? this.printJson(result) : this.log(`Knowledge "${result.knowledgeId}" installed (repository: ${result.installedRepositoryId})`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
