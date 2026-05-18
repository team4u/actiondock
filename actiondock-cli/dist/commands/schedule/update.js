import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderScheduleDetail } from "../../lib/render.js";
import { buildScheduleInput, resolveScheduleEnabled } from "../../lib/schedule.js";
export default class ScheduleUpdateCommand extends BaseCommand {
    static description = "Update an ActionDock schedule";
    static args = {
        scheduleId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        "schedule-name": Flags.string({
            description: "Human-readable schedule name"
        }),
        "schedule-cron": Flags.string({
            description: "Cron expression"
        }),
        "schedule-enabled": Flags.boolean({
            description: "Mark the schedule as enabled"
        }),
        "schedule-disabled": Flags.boolean({
            description: "Mark the schedule as disabled"
        }),
        "replace-input": Flags.boolean({
            description: "Replace the saved schedule input instead of merging into it"
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
        const { args, flags } = await this.parse(ScheduleUpdateCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const existing = await client.getSchedule(args.scheduleId);
            const input = await buildScheduleInput({
                client,
                scriptId: existing.scriptId,
                argv: this.argv,
                positionals: [args.scheduleId],
                inputJson: flags["input-json"],
                inputFile: flags["input-file"],
                existingInput: flags["replace-input"] ? {} : (existing.input ?? {}),
                booleanFlags: ["schedule-enabled", "schedule-disabled", "replace-input"],
                valueFlags: ["schedule-name", "schedule-cron"]
            });
            const schedule = await client.updateSchedule(args.scheduleId, {
                scriptId: existing.scriptId,
                name: flags["schedule-name"] ?? existing.name ?? existing.id,
                cronExpression: flags["schedule-cron"] ?? existing.cronExpression ?? "",
                input,
                enabled: resolveScheduleEnabled({
                    enabledFlag: flags["schedule-enabled"],
                    disabledFlag: flags["schedule-disabled"],
                    fallback: existing.enabled ?? true
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
