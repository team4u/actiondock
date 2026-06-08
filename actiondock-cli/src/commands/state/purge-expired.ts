import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";

export default class StatePurgeExpiredCommand extends BaseCommand {
  static description = "Purge expired shared-state entries";

  static args = {
    namespace: Args.string({ required: false })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(StatePurgeExpiredCommand);

    try {
      const client = this.getClient(flags);
      const count = await client.sharedState.purgeExpired(args.namespace);

      if (flags.json) {
        this.printJson({ purged: count, namespace: args.namespace ?? null });
        return;
      }

      this.log(`已清理 ${count} 条过期共享状态。`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
