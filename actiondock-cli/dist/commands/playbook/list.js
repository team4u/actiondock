import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderPlaybookList } from "../../lib/render.js";
export default class PlaybookListCommand extends BaseCommand {
    static description = "List ActionDock playbooks";
    static flags = {
        ...BaseCommand.baseFlags,
        group: Flags.string({ description: "Filter by playbook group ID" }),
        "repository-id": Flags.string({ description: "Filter by repository ID" }),
        tag: Flags.string({ description: "Filter by tag" }),
        enabled: Flags.boolean({ description: "Only enabled playbooks" }),
        managed: Flags.boolean({ description: "Only managed playbooks" }),
        keyword: Flags.string({ description: "Keyword filter" }),
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(PlaybookListCommand);
        try {
            const items = await createClient(flags).listPlaybooks({
                groupId: flags.group,
                repositoryId: flags["repository-id"],
                tag: flags.tag,
                enabled: flags.enabled ? true : undefined,
                managed: flags.managed ? true : undefined,
                keyword: flags.keyword
            });
            flags.json ? this.printJson(items) : this.log(renderPlaybookList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
