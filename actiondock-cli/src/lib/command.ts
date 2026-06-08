import fs from "node:fs";
import path from "node:path";

import { Command, Flags } from "@oclif/core";

import { ActionDockCliError } from "./error.js";
import { ActionDockClient } from "./client.js";
import { resolveServerUrl, resolveToken } from "./config.js";

export abstract class BaseCommand extends Command {
  static baseFlags = {
    json: Flags.boolean({
      description: "Output machine-readable JSON"
    }),
    "output-file": Flags.string({
      description: "Write JSON output to a file instead of stdout"
    }),
    "overwrite-output": Flags.boolean({
      description: "Overwrite an existing output file"
    })
  };

  static connectionFlags = {
    profile: Flags.string({
      description: "Use a configured server profile"
    }),
    server: Flags.string({
      description: "Override ActionDock server URL"
    }),
    token: Flags.string({
      description: "Override ActionDock bearer token"
    })
  };

  protected getClient(flags: { server?: string; token?: string; profile?: string }): ActionDockClient {
    return new ActionDockClient({
      serverUrl: resolveServerUrl(flags),
      token: resolveToken(flags)
    });
  }

  protected printJson(data: unknown): void {
    const text = `${JSON.stringify(data, null, 2)}\n`;
    const outputFile = this.findFlagValue("output-file");
    if (!outputFile) {
      this.log(text.trimEnd());
      return;
    }

    const outputPath = this.resolveJsonOutputPath(outputFile);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, text, "utf8");
    this.log(JSON.stringify({ outputFile: outputPath, bytes: Buffer.byteLength(text, "utf8") }, null, 2));
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

  private findFlagValue(name: string): string | undefined {
    const prefix = `--${name}=`;
    for (let index = 0; index < this.argv.length; index += 1) {
      const token = this.argv[index];
      if (token === `--${name}`) {
        const next = this.argv[index + 1];
        return next && !next.startsWith("-") ? next : undefined;
      }
      if (token?.startsWith(prefix)) {
        return token.slice(prefix.length);
      }
    }
    return undefined;
  }

  private hasFlag(name: string): boolean {
    return this.argv.some((token) => token === `--${name}` || token.startsWith(`--${name}=`));
  }

  private resolveJsonOutputPath(outputFile: string): string {
    const stat = fs.existsSync(outputFile) ? fs.statSync(outputFile) : undefined;
    const outputPath = stat?.isDirectory() ? path.join(outputFile, "actiondock-output.json") : outputFile;
    if (!this.hasFlag("overwrite-output") && fs.existsSync(outputPath)) {
      throw new ActionDockCliError(`输出文件已存在: ${outputPath}。如需覆盖请加 --overwrite-output。`, 2);
    }
    return outputPath;
  }
}
