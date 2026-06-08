import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";

export default class ScheduleDeleteCommand extends BaseCommand {
  static description = "Delete an ActionDock schedule";

  static args = {
    scheduleId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ScheduleDeleteCommand);

    try {
      const client = this.getClient(flags);
      await client.schedules.delete(args.scheduleId);

      if (flags.json) {
        this.printJson({ deleted: true, scheduleId: args.scheduleId });
        return;
      }

      this.log(`已删除定时任务: ${args.scheduleId}`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
