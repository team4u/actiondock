import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockCliError } from "../../lib/error.js";
import { renderExecutionList } from "../../lib/render.js";

export default class ExecutionListCommand extends BaseCommand {
  static description = "List ActionDock execution records";

  static flags = {
    ...BaseCommand.baseFlags,
    "script-id": Flags.string({
      description: "Filter by script ID"
    }),
    "schedule-id": Flags.string({
      description: "Filter by schedule ID"
    }),
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ExecutionListCommand);

    try {
      if (!flags["script-id"] && !flags["schedule-id"]) {
        throw new ActionDockCliError("`execution list` 需要提供 `--script-id` 或 `--schedule-id`。", 2);
      }

      const client = this.getClient(flags);
      const items = await client.executions.list({
        scriptId: flags["script-id"],
        scheduleId: flags["schedule-id"]
      });

      if (flags.json) {
        this.printJson(items);
        return;
      }

      this.log(renderExecutionList(items));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
