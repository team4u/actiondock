import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { intentFlag, listWithIntentFallback } from "../../lib/command-helpers.js";
import { renderScheduleList } from "../../lib/render.js";
export default class ScheduleListCommand extends BaseCommand {
    static description = "List ActionDock schedules";
    static flags = {
        ...BaseCommand.baseFlags,
        "script-id": Flags.string({
            description: "Only list schedules for the given script ID"
        }),
        intent: intentFlag,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(ScheduleListCommand);
        try {
            const client = this.getClient(flags);
            const items = await listWithIntentFallback(flags.intent, (intent) => client.schedules.list(flags["script-id"], intent));
            if (flags.json) {
                this.printJson(items);
                return;
            }
            this.log(renderScheduleList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
