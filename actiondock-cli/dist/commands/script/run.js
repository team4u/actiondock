import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { collectDynamicFlags, buildInputFromSchema, parseInputObject } from "../../lib/input.js";
import { renderExecution } from "../../lib/render.js";
import { extractSchemaFields } from "../../lib/schema.js";
export default class ScriptRunCommand extends BaseCommand {
    static description = "Execute a published or draft ActionDock script";
    static args = {
        scriptId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        draft: Flags.boolean({
            description: "Execute the draft script instead of the published snapshot"
        }),
        mode: Flags.string({
            description: "Submit mode",
            options: ["sync", "async"],
            default: "sync"
        }),
        "response-view": Flags.string({
            description: "Response detail level",
            options: ["result", "debug"],
            default: "result"
        }),
        "input-json": Flags.string({
            description: "Base JSON object for script input"
        }),
        "input-file": Flags.string({
            description: "Path to a JSON file containing the base script input object"
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
        const { args, flags } = await this.parse(ScriptRunCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const script = await client.getScript(args.scriptId, flags.draft);
            const schema = flags.draft ? script.inputSchema : script.published?.inputSchema ?? script.inputSchema;
            const fields = extractSchemaFields(schema);
            const baseInput = parseInputObject(flags["input-json"], flags["input-file"]);
            const dynamicFlags = collectDynamicFlags(this.argv, {
                positionals: [args.scriptId]
            });
            const { input } = buildInputFromSchema(baseInput, dynamicFlags, fields);
            const response = await client.executeScript({
                scriptId: args.scriptId,
                input,
                mode: flags.mode.toUpperCase(),
                responseView: flags["response-view"].toUpperCase()
            }, flags.draft);
            if (flags.json) {
                this.printJson(response);
                return;
            }
            this.log(renderExecution(response));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
