import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";

export default class StateDeleteCommand extends BaseCommand {
  static description = "Delete a shared-state entry";

  static args = {
    namespace: Args.string({ required: true }),
    key: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    profile: Flags.string({
      description: "Use a configured server profile"
    }),
    server: Flags.string({
      description: "Override ActionDock server URL"
    }),
    token: Flags.string({
      description: "Override ActionDock bearer token"
    }),
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(StateDeleteCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      await client.deleteSharedState(args.namespace, args.key);

      if (flags.json) {
        this.printJson({ deleted: true, namespace: args.namespace, key: args.key });
        return;
      }

      this.log(`已删除共享状态: ${args.namespace}/${args.key}`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
