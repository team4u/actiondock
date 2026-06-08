import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../../lib/command.js";
import { renderPlaybookSession } from "../../../lib/render.js";
export default class PlaybookSessionCompleteCommand extends BaseCommand {
    static description = "Complete an ActionDock playbook session";
    static args = {
        "session-id": Args.string({ required: true, description: "Playbook session ID" })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        status: Flags.string({
            description: "Terminal session status",
            options: ["COMPLETED", "STOPPED", "FAILED", "CANCELLED", "HANDED_OFF"],
            default: "COMPLETED"
        }),
        "final-summary": Flags.string({ description: "Final session summary" }),
        "failure-reason": Flags.string({ description: "Failure or stop reason" }),
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(PlaybookSessionCompleteCommand);
        try {
            const session = await this.getClient(flags).playbooks.completeSession(args["session-id"], {
                status: flags.status,
                finalSummary: flags["final-summary"],
                failureReason: flags["failure-reason"]
            });
            flags.json ? this.printJson(session) : this.log(renderPlaybookSession(session));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
