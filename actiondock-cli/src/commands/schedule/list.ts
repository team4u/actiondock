import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderScheduleList } from "../../lib/render.js";

export default class ScheduleListCommand extends BaseCommand {
  static description = "List ActionDock schedules";

  static flags = {
    ...BaseCommand.baseFlags,
    "script-id": Flags.string({
      description: "Only list schedules for the given script ID"
    }),
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
    const { flags } = await this.parse(ScheduleListCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      const items = await client.listSchedules(flags["script-id"]);

      if (flags.json) {
        this.printJson(items);
        return;
      }

      this.log(renderScheduleList(items));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
