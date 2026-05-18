import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderProjectRepositoryResolution } from "../../lib/render.js";

export default class RepositoryResolveCommand extends BaseCommand {
  static description = "Resolve an ActionDock project repository and read its ACTIONDOCK.md";

  static flags = {
    ...BaseCommand.baseFlags,
    "repository-id": Flags.string({ description: "Repository id", required: true }),
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(RepositoryResolveCommand);
    try {
      const item = await createClient(flags).resolveProjectRepository(flags["repository-id"]);
      flags.json ? this.printJson(item) : this.log(renderProjectRepositoryResolution(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
