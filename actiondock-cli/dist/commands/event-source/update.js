import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { applyProcessorFieldOverrides, mergeDefinitionPatch, mergeEventSourceDefinition, parseOptionalObject, resolveEnabledFlag } from "../../lib/event.js";
import { renderEventSourceDetail } from "../../lib/render.js";
export default class EventSourceUpdateCommand extends BaseCommand {
    static description = "Update an ActionDock event source";
    static args = {
        sourceId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        "definition-json": Flags.string({
            description: "Inline JSON object merged into the saved event source definition"
        }),
        "definition-file": Flags.string({
            description: "Path to a JSON file merged into the saved event source definition"
        }),
        name: Flags.string({
            description: "Event source name override"
        }),
        key: Flags.string({
            description: "Event source key override"
        }),
        description: Flags.string({
            description: "Event source description override"
        }),
        "transport-type": Flags.string({
            description: "Transport type override"
        }),
        enabled: Flags.boolean({
            description: "Mark the event source as enabled"
        }),
        disabled: Flags.boolean({
            description: "Mark the event source as disabled"
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
        const { args, flags } = await this.parse(EventSourceUpdateCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const existing = await client.getEventSource(args.sourceId);
            const patch = parseOptionalObject(flags["definition-json"], flags["definition-file"], {
                jsonFlag: "`--definition-json`",
                fileFlag: "`--definition-file`"
            }) ?? {};
            const mergedPatch = applyProcessorFieldOverrides(mergeDefinitionPatch(existing, patch), patch, ["normalizationProcessor"]);
            const merged = mergeEventSourceDefinition(mergedPatch, {
                id: args.sourceId,
                name: flags.name,
                key: flags.key,
                description: flags.description,
                enabled: resolveEnabledFlag({
                    enabledFlag: flags.enabled,
                    disabledFlag: flags.disabled,
                    fallback: existing.enabled
                }),
                transportType: flags["transport-type"]?.toUpperCase()
            });
            const item = await client.updateEventSource(args.sourceId, merged);
            if (flags.json) {
                this.printJson(item);
                return;
            }
            this.log(renderEventSourceDetail(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
