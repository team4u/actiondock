import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ActionDockCliError, isRecord } from "./error.js";
import type { ConfigFile } from "./types.js";

const DEFAULT_SERVER_URL = "http://127.0.0.1:5177";

function configDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "actiondock-cli");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "actiondock-cli");
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "actiondock-cli");
}

export function configPath(): string {
  return path.join(configDir(), "config.json");
}

export function readConfig(): ConfigFile {
  const file = configPath();
  if (!fs.existsSync(file)) {
    return {};
  }
  const text = fs.readFileSync(file, "utf8");
  if (!text.trim()) {
    return {};
  }
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) {
    throw new ActionDockCliError(`配置文件格式非法: ${file}`, 2);
  }
  return {
    serverUrl: typeof parsed.serverUrl === "string" ? parsed.serverUrl : undefined,
    token: typeof parsed.token === "string" ? parsed.token : undefined
  };
}

export function writeConfig(config: ConfigFile): void {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function setConfigValue(key: keyof ConfigFile, value: string): ConfigFile {
  const current = readConfig();
  const next = { ...current, [key]: value };
  writeConfig(next);
  return next;
}

export function clearConfigValue(key: keyof ConfigFile): ConfigFile {
  const current = readConfig();
  const next = { ...current };
  delete next[key];
  writeConfig(next);
  return next;
}

export function resolveServerUrl(flagValue: string | undefined): string {
  return normalizeServerUrl(flagValue ?? process.env.ACTIONDOCK_BASE_URL ?? readConfig().serverUrl) ?? DEFAULT_SERVER_URL;
}

export function resolveToken(flagValue: string | undefined): string | undefined {
  const token = flagValue ?? process.env.ACTIONDOCK_TOKEN ?? readConfig().token;
  return token?.trim() ? token.trim() : undefined;
}

export function normalizeServerUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  return value.trim().replace(/\/+$/, "");
}

export function buildConfigView(config: ConfigFile) {
  return {
    path: configPath(),
    serverUrl: normalizeServerUrl(config.serverUrl),
    tokenConfigured: Boolean(config.token?.trim())
  };
}
