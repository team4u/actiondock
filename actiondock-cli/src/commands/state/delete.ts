import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";

export default class StateDeleteCommand extends BaseCommand {
  static description = "Delete a shared-state entry";

  static args = {
    namespace: Args.string({ required: true }),
    key: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(StateDeleteCommand);

    try {
      const client = this.getClient(flags);
      await client.sharedState.delete(args.namespace, args.key);

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
