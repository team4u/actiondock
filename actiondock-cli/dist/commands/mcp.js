import { Flags } from "@oclif/core";
import { BaseCommand } from "../lib/command.js";
import { startActionDockMcp } from "../mcp/index.js";
import { defaultPolicy } from "../mcp/types.js";
import { splitCsv } from "../mcp/core/names.js";
export default class McpCommand extends BaseCommand {
    static description = "Run an ActionDock MCP server exposing scripts and tools to AI clients";
    static flags = {
        ...BaseCommand.baseFlags,
        ...BaseCommand.connectionFlags,
        transport: Flags.string({
            description: "Transport to serve (stdio for local clients, http for network clients)",
            options: ["stdio", "http"],
            default: "stdio"
        }),
        host: Flags.string({
            description: "HTTP bind address (stdio mode ignores this)",
            default: "127.0.0.1"
        }),
        port: Flags.integer({
            description: "HTTP bind port (stdio mode ignores this)",
            default: 5178
        }),
        endpoint: Flags.string({
            description: "HTTP request path (stdio mode ignores this)",
            default: "/mcp"
        }),
        "enable-execute-tools": Flags.boolean({
            description: "Expose execute-classified tools (e.g. run scripts)",
            default: true
        }),
        "enable-write-tools": Flags.boolean({
            description: "Expose write-classified tools (e.g. mutate repositories)",
            default: false
        }),
        "enable-admin-tools": Flags.boolean({
            description: "Expose admin-classified tools (e.g. token / config management)",
            default: false
        }),
        "enable-dynamic-tools": Flags.boolean({
            description: "Expose one dynamic tool per published script",
            default: true
        }),
        "allowed-scripts": Flags.string({
            description: "Comma-separated allowlist of script ids exposed as dynamic tools"
        }),
        "denied-scripts": Flags.string({
            description: "Comma-separated denylist of script ids never exposed as dynamic tools"
        }),
        "max-result-bytes": Flags.integer({
            description: "Maximum serialized tool result size in bytes before truncation",
            default: 200_000
        }),
        "redact-secrets": Flags.boolean({
            description: "Redact secret-looking fields from tool results",
            default: true
        }),
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(McpCommand);
        try {
            const client = this.getClient(flags);
            const policy = {
                ...defaultPolicy(),
                enableExecuteTools: flags["enable-execute-tools"],
                enableWriteTools: flags["enable-write-tools"],
                enableAdminTools: flags["enable-admin-tools"],
                enableDynamicTools: flags["enable-dynamic-tools"],
                allowedScripts: splitCsv(flags["allowed-scripts"]),
                deniedScripts: splitCsv(flags["denied-scripts"]),
                maxResultBytes: flags["max-result-bytes"],
                redactSecrets: flags["redact-secrets"]
            };
            await startActionDockMcp({
                client,
                policy,
                transport: flags.transport,
                host: flags.host,
                port: flags.port,
                endpoint: flags.endpoint
            });
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
