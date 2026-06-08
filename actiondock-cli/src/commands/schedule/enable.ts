import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { renderScheduleDetail } from "../../lib/render.js";

export default class ScheduleEnableCommand extends BaseCommand {
  static description = "Enable an ActionDock schedule";

  static args = {
    scheduleId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ScheduleEnableCommand);

    try {
      const client = this.getClient(flags);
      const schedule = await client.schedules.enable(args.scheduleId);

      if (flags.json) {
        this.printJson(schedule);
        return;
      }

      this.log(renderScheduleDetail(schedule));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
