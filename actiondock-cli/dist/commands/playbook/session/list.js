import { Flags } from "@oclif/core";
import { BaseCommand } from "../../../lib/command.js";
import { renderPlaybookSessionList } from "../../../lib/render.js";
export default class PlaybookSessionListCommand extends BaseCommand {
    static description = "List ActionDock playbook sessions";
    static flags = {
        ...BaseCommand.baseFlags,
        "playbook-id": Flags.string({ description: "Filter by Playbook ID" }),
        status: Flags.string({
            description: "Filter by session status",
            options: ["RUNNING", "WAITING_CONFIRMATION", "STOPPED", "HANDED_OFF", "COMPLETED", "FAILED", "CANCELLED"]
        }),
        "agent-run-id": Flags.string({ description: "Filter by external agent run ID" }),
        intent: Flags.string({ description: "Regex filter for session intent or prompt" }),
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(PlaybookSessionListCommand);
        try {
            const items = await this.getClient(flags).playbooks.listSessions({
                playbookId: flags["playbook-id"],
                status: flags.status,
                agentRunId: flags["agent-run-id"],
                intent: flags.intent
            });
            flags.json ? this.printJson(items) : this.log(renderPlaybookSessionList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
