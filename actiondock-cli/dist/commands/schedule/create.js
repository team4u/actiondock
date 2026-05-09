import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderScheduleDetail } from "../../lib/render.js";
import { buildScheduleInput, resolveScheduleEnabled } from "../../lib/schedule.js";
export default class ScheduleCreateCommand extends BaseCommand {
    static description = "Create an ActionDock schedule";
    static flags = {
        ...BaseCommand.baseFlags,
        "script-id": Flags.string({
            description: "Target script ID",
            required: true
        }),
        "schedule-name": Flags.string({
            description: "Human-readable schedule name",
            required: true
        }),
        "schedule-cron": Flags.string({
            description: "Cron expression",
            required: true
        }),
        "schedule-enabled": Flags.boolean({
            description: "Create the schedule as enabled"
        }),
        "schedule-disabled": Flags.boolean({
            description: "Create the schedule as disabled"
        }),
        "input-json": Flags.string({
            description: "Base JSON object for schedule input"
        }),
        "input-file": Flags.string({
            description: "Path to a JSON file containing the base schedule input object"
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
    static strict = false;
    static ["--"] = false;
    async run() {
        const { flags } = await this.parse(ScheduleCreateCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const input = await buildScheduleInput({
                client,
                scriptId: flags["script-id"],
                argv: this.argv,
                positionals: [],
                inputJson: flags["input-json"],
                inputFile: flags["input-file"],
                booleanFlags: ["schedule-enabled", "schedule-disabled"],
                valueFlags: ["script-id", "schedule-name", "schedule-cron"]
            });
            const schedule = await client.createSchedule({
                scriptId: flags["script-id"],
                name: flags["schedule-name"],
                cronExpression: flags["schedule-cron"],
                input,
                enabled: resolveScheduleEnabled({
                    enabledFlag: flags["schedule-enabled"],
                    disabledFlag: flags["schedule-disabled"],
                    fallback: true
                })
            });
            if (flags.json) {
                this.printJson(schedule);
                return;
            }
            this.log(renderScheduleDetail(schedule));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
