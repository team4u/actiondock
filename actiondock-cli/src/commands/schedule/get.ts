import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderScheduleDetail } from "../../lib/render.js";

export default class ScheduleGetCommand extends BaseCommand {
  static description = "Show an ActionDock schedule";

  static args = {
    scheduleId: Args.string({ required: true })
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
    const { args, flags } = await this.parse(ScheduleGetCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      const schedule = await client.getSchedule(args.scheduleId);

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
