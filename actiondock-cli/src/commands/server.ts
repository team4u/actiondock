import { Flags } from "@oclif/core";

import { BaseCommand } from "../lib/command.js";
import { runRuntimeCommand } from "../lib/runtime.js";

export default class ServerCommand extends BaseCommand {
  static description = "Run the local ActionDock server in the foreground";

  static strict = false;

  static flags = {
    ...BaseCommand.baseFlags,
    port: Flags.integer({
      description: "Local server port",
    }),
    "server-address": Flags.string({
      description: "Server bind address",
    }),
    help: Flags.help({ char: "h" }),
  };

  async run(): Promise<void> {
    if (this.argv.includes("--help") || this.argv.includes("-h")) {
      await this.parse(ServerCommand);
      return;
    }

    const args: string[] = [];
    const argv = [...this.argv];

    for (let index = 0; index < argv.length; index += 1) {
      const value = argv[index];

      if (value === "--") {
        args.push(...argv.slice(index + 1));
        break;
      }

      if (value === "--json") {
        continue;
      }

      if (value === "--port") {
        const port = argv[index + 1];
        if (port === undefined) {
          this.error("Flag --port expects a value", { exit: 2 });
        }
        args.push(`--server.port=${port}`);
        index += 1;
        continue;
      }

      if (value?.startsWith("--port=")) {
        args.push(`--server.port=${value.slice("--port=".length)}`);
        continue;
      }

      if (value === "--server-address") {
        const address = argv[index + 1];
        if (address === undefined) {
          this.error("Flag --server-address expects a value", { exit: 2 });
        }
        args.push(`--server.address=${address}`);
        index += 1;
        continue;
      }

      if (value?.startsWith("--server-address=")) {
        args.push(`--server.address=${value.slice("--server-address=".length)}`);
        continue;
      }

      if (value !== undefined) {
        args.push(value);
      }
    }

    const exitCode = await runRuntimeCommand("actiondock-runtime", args);
    this.exit(exitCode);
  }
}
