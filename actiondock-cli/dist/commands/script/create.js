import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderScriptDetail } from "../../lib/render.js";
import { parseSchemaInput, resolveOptionalTextInput, resolveScriptSource } from "../../lib/script.js";
export default class ScriptCreateCommand extends BaseCommand {
    static description = "Create an ActionDock draft script";
    static flags = {
        ...BaseCommand.baseFlags,
        "script-id": Flags.string({
            description: "Script ID",
            required: true
        }),
        name: Flags.string({
            description: "Human-readable script name",
            required: true
        }),
        type: Flags.string({
            description: "Script runtime type",
            options: ["groovy", "python"],
            default: "groovy"
        }),
        source: Flags.string({
            description: "Inline script source"
        }),
        "source-file": Flags.string({
            description: "Path to a text file containing the script source"
        }),
        "python-requirements": Flags.string({
            description: "Inline Python requirements.txt content"
        }),
        "python-requirements-file": Flags.string({
            description: "Path to a requirements.txt file"
        }),
        description: Flags.string({
            description: "Script description"
        }),
        owner: Flags.string({
            description: "Script owner"
        }),
        tag: Flags.string({
            description: "Repeatable tag",
            multiple: true
        }),
        "input-schema-json": Flags.string({
            description: "Inline JSON object for inputSchema"
        }),
        "input-schema-file": Flags.string({
            description: "Path to a JSON file containing inputSchema"
        }),
        "output-schema-json": Flags.string({
            description: "Inline JSON object for outputSchema"
        }),
        "output-schema-file": Flags.string({
            description: "Path to a JSON file containing outputSchema"
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
        const { flags } = await this.parse(ScriptCreateCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const script = await client.createScript({
                id: flags["script-id"],
                name: flags.name,
                type: flags.type.toUpperCase(),
                source: resolveScriptSource(flags.source, flags["source-file"], true),
                pythonRequirements: resolveOptionalTextInput(flags["python-requirements"], flags["python-requirements-file"], {
                    valueFlag: "`--python-requirements`",
                    fileFlag: "`--python-requirements-file`"
                }),
                description: flags.description,
                owner: flags.owner,
                tags: flags.tag?.length ? flags.tag : undefined,
                inputSchema: parseSchemaInput(flags["input-schema-json"], flags["input-schema-file"], {
                    jsonFlag: "`--input-schema-json`",
                    fileFlag: "`--input-schema-file`"
                }),
                outputSchema: parseSchemaInput(flags["output-schema-json"], flags["output-schema-file"], {
                    jsonFlag: "`--output-schema-json`",
                    fileFlag: "`--output-schema-file`"
                })
            });
            if (flags.json) {
                this.printJson(script);
                return;
            }
            this.log(renderScriptDetail(script, "draft"));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
