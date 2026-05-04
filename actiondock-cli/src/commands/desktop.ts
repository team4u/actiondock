import { Flags } from "@oclif/core";

import { BaseCommand } from "../lib/command.js";
import { runRuntimeCommand } from "../lib/runtime.js";

export default class DesktopCommand extends BaseCommand {
  static description = "Open the local ActionDock desktop tray app";

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
    const { flags } = await this.parse(DesktopCommand);

    const args: string[] = [];

    if (flags.port !== undefined) {
      args.push(`--server.port=${flags.port}`);
    }

    if (flags["server-address"]) {
      args.push(`--server.address=${flags["server-address"]}`);
    }

    const exitCode = await runRuntimeCommand("actiondock-desktop-runtime", args);
    this.exit(exitCode);
  }
}
