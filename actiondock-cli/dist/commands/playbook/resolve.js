import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderPlaybookResolveMatches } from "../../lib/render.js";
export default class PlaybookResolveCommand extends BaseCommand {
    static description = "Resolve playbooks for an intent";
    static flags = {
        ...BaseCommand.baseFlags,
        intent: Flags.string({ description: "Intent text", required: true }),
        "repository-id": Flags.string({ description: "Target repository ID" }),
        group: Flags.string({ description: "Target playbook group ID" }),
        tag: Flags.string({ description: "Repeatable tag", multiple: true }),
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(PlaybookResolveCommand);
        try {
            const items = await createClient(flags).resolvePlaybooks({
                intent: flags.intent,
                repositoryId: flags["repository-id"],
                groupId: flags.group,
                tags: flags.tag?.length ? flags.tag : undefined
            });
            flags.json ? this.printJson(items) : this.log(renderPlaybookResolveMatches(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
