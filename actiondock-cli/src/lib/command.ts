import { Command, Flags } from "@oclif/core";

import { ActionDockCliError } from "./error.js";

export abstract class BaseCommand extends Command {
  static baseFlags = {
    json: Flags.boolean({
      description: "Output machine-readable JSON"
    }),
  };

  protected printJson(data: unknown): void {
    this.log(JSON.stringify(data, null, 2));
  }

  protected handleError(error: unknown, json = false): never {
    if (error instanceof ActionDockCliError) {
      if (json) {
        this.logToStderr(JSON.stringify({
          error: error.message,
          details: error.details ?? null,
          exitCode: error.exitCode
        }, null, 2));
      } else {
        this.logToStderr(error.message);
        if (error.details && typeof error.details !== "string") {
          this.logToStderr(JSON.stringify(error.details, null, 2));
        }
      }
      this.exit(error.exitCode);
    }

    throw error;
  }
}
