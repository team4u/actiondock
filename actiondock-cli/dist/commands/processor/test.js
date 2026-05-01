import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { parseExpectedOutputSchema, parseProcessorContext, parseProcessorDefinition } from "../../lib/event.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderProcessorTestResult } from "../../lib/render.js";
export default class ProcessorTestCommand extends BaseCommand {
    static description = "Test an ActionDock processor definition";
    static flags = {
        ...BaseCommand.baseFlags,
        "processor-json": Flags.string({
            description: "Inline JSON object for the processor definition",
            required: true
        }),
        "processor-file": Flags.string({
            description: "Path to a JSON file containing the processor definition"
        }),
        "context-json": Flags.string({
            description: "Inline JSON object for processor context"
        }),
        "context-file": Flags.string({
            description: "Path to a JSON file containing processor context"
        }),
        "expected-output-schema-json": Flags.string({
            description: "Inline JSON object for expected output schema"
        }),
        "expected-output-schema-file": Flags.string({
            description: "Path to a JSON file containing expected output schema"
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
        const { flags } = await this.parse(ProcessorTestCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags.server),
                token: resolveToken(flags.token)
            });
            const result = await client.testProcessor({
                processor: parseProcessorDefinition(flags["processor-json"], flags["processor-file"]),
                context: parseProcessorContext(flags["context-json"], flags["context-file"]),
                expectedOutputSchema: parseExpectedOutputSchema(flags["expected-output-schema-json"], flags["expected-output-schema-file"])
            });
            if (flags.json) {
                this.printJson(result);
                return;
            }
            this.log(renderProcessorTestResult(result));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
