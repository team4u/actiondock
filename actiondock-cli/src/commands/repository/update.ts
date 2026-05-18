import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderRepositoryDetail } from "../../lib/render.js";

export default class RepositoryUpdateCommand extends BaseCommand {
  static description = "Update an ActionDock repository";

  static args = {
    repositoryId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    name: Flags.string({ description: "Repository name", required: true }),
    type: Flags.string({ description: "Repository type", options: ["git", "local-dir"], required: true }),
    purpose: Flags.string({ description: "Repository purpose", options: ["capability", "project"], default: "capability" }),
    url: Flags.string({ description: "Repository URL or local path", required: true }),
    branch: Flags.string({ description: "Git branch" }),
    "trust-level": Flags.string({ description: "Repository trust level", options: ["trusted", "untrusted"], default: "untrusted" }),
    description: Flags.string({ description: "Repository description" }),
    enabled: Flags.boolean({ description: "Mark repository as enabled" }),
    disabled: Flags.boolean({ description: "Mark repository as disabled" }),
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepositoryUpdateCommand);
    try {
      const isProject = flags.purpose === "project";
      const item = await createClient(flags).updateRepository(args.repositoryId, {
        id: args.repositoryId,
        name: flags.name,
        type: flags.type.toUpperCase().replace("-", "_"),
        url: flags.url,
        branch: flags.branch,
        trustLevel: flags["trust-level"].toUpperCase().replace("-", "_"),
        description: flags.description,
        enabled: flags.disabled ? false : true,
        purpose: isProject ? "PROJECT" : undefined
      });
      flags.json ? this.printJson(item) : this.log(renderRepositoryDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
