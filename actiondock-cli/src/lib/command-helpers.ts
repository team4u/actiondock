import fs from "node:fs";
import path from "node:path";

import { Flags } from "@oclif/core";

import { ActionDockClient } from "./client.js";
import { resolveServerUrl, resolveToken } from "./config.js";
import { ActionDockCliError } from "./error.js";
import { parseInputObject } from "./input.js";
import type { RepositoryInstallRequest } from "./types.js";

export function createClient(flags: { server?: string; token?: string; profile?: string }): ActionDockClient {
  return new ActionDockClient({
    serverUrl: resolveServerUrl(flags),
    token: resolveToken(flags)
  });
}

export const serverTokenFlags = {
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

export const jsonObjectFlags = (name: string, description: string) => ({
  [`${name}-json`]: Flags.string({
    description: `Inline JSON object for ${description}`
  }),
  [`${name}-file`]: Flags.string({
    description: `Path to a JSON file containing ${description}`
  })
});

export function parseNamedObject(flags: Record<string, unknown>, name: string, _label: string): Record<string, unknown> {
  const json = flags[`${name}-json`];
  const file = flags[`${name}-file`];
  return parseInputObject(typeof json === "string" ? json : undefined, typeof file === "string" ? file : undefined, {
    jsonFlag: `\`--${name}-json\``,
    fileFlag: `\`--${name}-file\``
  });
}

export function buildRepositoryInstallRequest(flags: {
  "install-schedules"?: boolean;
  "install-script-dependencies"?: boolean;
  "install-plugin-dependencies"?: boolean;
  "force-plugin-upgrade"?: boolean;
}): RepositoryInstallRequest {
  return {
    installSchedules: Boolean(flags["install-schedules"]),
    installScriptDependencies: Boolean(flags["install-script-dependencies"]),
    installPluginDependencies: Boolean(flags["install-plugin-dependencies"]),
    forcePluginUpgrade: Boolean(flags["force-plugin-upgrade"])
  };
}

export function resolveOutputPath(output: string | undefined, defaultFilename: string, force = false): string {
  const target = output ?? defaultFilename;
  const stat = fs.existsSync(target) ? fs.statSync(target) : undefined;
  const outputPath = stat?.isDirectory() ? path.join(target, defaultFilename) : target;
  if (!force && fs.existsSync(outputPath)) {
    throw new ActionDockCliError(`输出文件已存在: ${outputPath}。如需覆盖请加 --force。`, 2);
  }
  return outputPath;
}
