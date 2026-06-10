import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { renderSharedStateNamespaces } from "../../lib/render.js";

export default class StateNamespacesCommand extends BaseCommand {
  static description = "List shared-state namespaces";

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(StateNamespacesCommand);

    try {
      const client = this.getClient(flags);
      const items = await client.sharedState.listNamespaces();

      if (flags.json) {
        this.printJson(items);
        return;
      }

      this.log(renderSharedStateNamespaces(items));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
