import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { ActionDockCliError } from "../../lib/error.js";
import { renderScriptDetail } from "../../lib/render.js";
import { parsePatchObject, parseSchemaInput, resolveOptionalTextInput, resolveScriptSource, setPatchField } from "../../lib/script.js";
export default class ScriptPatchCommand extends BaseCommand {
    static description = "Apply a JSON Merge Patch to an ActionDock draft script";
    static args = {
        scriptId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        "patch-json": Flags.string({
            description: "Inline JSON Merge Patch object"
        }),
        "patch-file": Flags.string({
            description: "Path to a JSON file containing a Merge Patch object"
        }),
        source: Flags.string({
            description: "Replace script source inline"
        }),
        "source-file": Flags.string({
            description: "Replace script source using a text file"
        }),
        "python-requirements": Flags.string({
            description: "Replace pythonRequirements inline"
        }),
        "python-requirements-file": Flags.string({
            description: "Replace pythonRequirements using a requirements.txt file"
        }),
        "input-schema-json": Flags.string({
            description: "Merge-patch inputSchema using an inline JSON object"
        }),
        "input-schema-file": Flags.string({
            description: "Merge-patch inputSchema using a JSON file"
        }),
        "output-schema-json": Flags.string({
            description: "Merge-patch outputSchema using an inline JSON object"
        }),
        "output-schema-file": Flags.string({
            description: "Merge-patch outputSchema using a JSON file"
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
        const { args, flags } = await this.parse(ScriptPatchCommand);
        try {
            const patch = parsePatchObject(flags["patch-json"], flags["patch-file"]);
            const source = resolveScriptSource(flags.source, flags["source-file"], false);
            if (source !== undefined) {
                setPatchField(patch, "source", source);
            }
            const pythonRequirements = resolveOptionalTextInput(flags["python-requirements"], flags["python-requirements-file"], {
                valueFlag: "`--python-requirements`",
                fileFlag: "`--python-requirements-file`"
            });
            if (pythonRequirements !== undefined) {
                setPatchField(patch, "pythonRequirements", pythonRequirements);
            }
            const inputSchema = parseSchemaInput(flags["input-schema-json"], flags["input-schema-file"], {
                jsonFlag: "`--input-schema-json`",
                fileFlag: "`--input-schema-file`"
            });
            if (inputSchema !== undefined) {
                setPatchField(patch, "inputSchema", inputSchema);
            }
            const outputSchema = parseSchemaInput(flags["output-schema-json"], flags["output-schema-file"], {
                jsonFlag: "`--output-schema-json`",
                fileFlag: "`--output-schema-file`"
            });
            if (outputSchema !== undefined) {
                setPatchField(patch, "outputSchema", outputSchema);
            }
            if (Object.keys(patch).length === 0) {
                throw new ActionDockCliError("至少需要提供一个 Patch 字段。", 2);
            }
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const script = await client.patchScript(args.scriptId, patch);
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
