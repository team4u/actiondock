import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
export default class ScheduleDeleteCommand extends BaseCommand {
    static description = "Delete an ActionDock schedule";
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
    async run() {
        const { args, flags } = await this.parse(ScheduleDeleteCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            await client.deleteSchedule(args.scheduleId);
            if (flags.json) {
                this.printJson({ deleted: true, scheduleId: args.scheduleId });
                return;
            }
            this.log(`已删除定时任务: ${args.scheduleId}`);
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
