import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockCliError } from "../../lib/error.js";
import { parseJsonValueInput } from "../../lib/input.js";

export default class StatePutCommand extends BaseCommand {
  static description = "Create or update shared state";

  static args = {
    namespace: Args.string({ required: true }),
    key: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    "value-json": Flags.string({
      description: "JSON value payload"
    }),
    "value-file": Flags.string({
      description: "Path to a file containing the JSON value payload"
    }),
    secret: Flags.boolean({
      description: "Mark the shared state value as secret"
    }),
    "expires-at": Flags.string({
      description: "Optional expiry time in local ISO format, for example 2026-04-28T12:00:00"
    }),
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(StatePutCommand);

    try {
      const client = this.getClient(flags);
      const value = parseJsonValueInput(flags["value-json"], flags["value-file"], {
        jsonFlag: "`--value-json`",
        fileFlag: "`--value-file`"
      });
      if (value === undefined) {
        throw new ActionDockCliError("`state put` 需要通过 `--value-json` 或 `--value-file` 提供值。", 2);
      }
      const response = await client.sharedState.put({
        namespace: args.namespace,
        key: args.key,
        value,
        secret: flags.secret,
        expiresAt: flags["expires-at"] ?? null
      });

      this.printJson(response);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
