import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
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
    async run() {
        const { flags } = await this.parse(ExecutionListCommand);
        try {
            if (!flags["script-id"] && !flags["schedule-id"]) {
                throw new ActionDockCliError("`execution list` 需要提供 `--script-id` 或 `--schedule-id`。", 2);
            }
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const items = await client.listExecutions({
                scriptId: flags["script-id"],
                scheduleId: flags["schedule-id"]
            });
            if (flags.json) {
                this.printJson(items);
                return;
            }
            this.log(renderExecutionList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
