import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { mergeEventTriggerDefinition, parseDefinitionInput, resolveEnabledFlag } from "../../lib/event.js";
import { renderEventTriggerDetail } from "../../lib/render.js";
export default class EventTriggerCreateCommand extends BaseCommand {
    static description = "Create an ActionDock event trigger";
    static flags = {
        ...BaseCommand.baseFlags,
        "definition-json": Flags.string({
            description: "Inline JSON object for the event trigger definition",
            required: true
        }),
        "definition-file": Flags.string({
            description: "Path to a JSON file containing the event trigger definition"
        }),
        "trigger-id": Flags.string({
            description: "Event trigger ID override"
        }),
        name: Flags.string({
            description: "Event trigger name override"
        }),
        description: Flags.string({
            description: "Event trigger description override"
        }),
        "source-id": Flags.string({
            description: "Event source ID override"
        }),
        "target-script-id": Flags.string({
            description: "Target script ID override"
        }),
        "submit-mode": Flags.string({
            description: "Submit mode override",
            options: ["sync", "async"]
        }),
        "response-view": Flags.string({
            description: "Execution response view override",
            options: ["result", "debug"]
        }),
        enabled: Flags.boolean({
            description: "Create the event trigger as enabled"
        }),
        disabled: Flags.boolean({
            description: "Create the event trigger as disabled"
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
        const { flags } = await this.parse(EventTriggerCreateCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags.server),
                token: resolveToken(flags.token)
            });
            const definition = mergeEventTriggerDefinition(parseDefinitionInput(flags["definition-json"], flags["definition-file"], {
                jsonFlag: "`--definition-json`",
                fileFlag: "`--definition-file`"
            }), {
                id: flags["trigger-id"],
                name: flags.name,
                description: flags.description,
                sourceId: flags["source-id"],
                targetScriptId: flags["target-script-id"],
                submitMode: flags["submit-mode"]?.toUpperCase(),
                responseView: flags["response-view"]?.toUpperCase(),
                enabled: resolveEnabledFlag({
                    enabledFlag: flags.enabled,
                    disabledFlag: flags.disabled
                })
            });
            const item = await client.createEventTrigger(definition);
            if (flags.json) {
                this.printJson(item);
                return;
            }
            this.log(renderEventTriggerDetail(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
