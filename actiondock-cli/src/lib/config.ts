import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ActionDockCliError, isRecord } from "./error.js";
import type { ConfigFile, ConfigProfile } from "./types.js";

const DEFAULT_SERVER_URL = "http://127.0.0.1:5177";
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

export interface ConnectionFlags {
  server?: string;
  token?: string;
  profile?: string;
}

function configDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "actiondock");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "actiondock");
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "actiondock");
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

  const profiles = isRecord(parsed.profiles) ? parseProfiles(parsed.profiles) : undefined;
  return {
    currentProfile: typeof parsed.currentProfile === "string" ? parsed.currentProfile : undefined,
    profiles
  };
}

function parseProfiles(value: Record<string, unknown>): Record<string, ConfigProfile> {
  const profiles: Record<string, ConfigProfile> = {};
  for (const [name, profile] of Object.entries(value)) {
    if (!isRecord(profile)) {
      continue;
    }
    profiles[name] = {
      serverUrl: typeof profile.serverUrl === "string" ? profile.serverUrl : undefined,
      token: typeof profile.token === "string" ? profile.token : undefined
    };
  }
  return profiles;
}

export function writeConfig(config: ConfigFile): void {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function validateProfileName(name: string): string {
  const value = name.trim();
  if (!value) {
    throw new ActionDockCliError("Profile 名称不能为空。", 2);
  }
  if (!PROFILE_NAME_PATTERN.test(value)) {
    throw new ActionDockCliError("Profile 名称只能包含字母、数字、下划线、短横线和点号。", 2);
  }
  return value;
}

export function upsertProfile(name: string, profile: ConfigProfile): ConfigFile {
  const profileName = validateProfileName(name);
  const current = readConfig();
  const existing = current.profiles?.[profileName] ?? {};
  const nextProfile = {
    ...existing,
    ...profile
  };
  if (!normalizeServerUrl(nextProfile.serverUrl)) {
    throw new ActionDockCliError("Profile server 不能为空。", 2);
  }

  const next: ConfigFile = {
    currentProfile: current.currentProfile ?? profileName,
    profiles: {
      ...(current.profiles ?? {}),
      [profileName]: {
        ...nextProfile,
        serverUrl: normalizeServerUrl(nextProfile.serverUrl)
      }
    }
  };
  writeConfig(next);
  return next;
}

export function useProfile(name: string): ConfigFile {
  const profileName = validateProfileName(name);
  const current = readConfig();
  if (!current.profiles?.[profileName]) {
    throw new ActionDockCliError(`Profile 不存在: ${profileName}`, 2);
  }
  const next = {
    ...current,
    currentProfile: profileName
  };
  writeConfig(next);
  return next;
}

export function removeProfile(name: string): ConfigFile {
  const profileName = validateProfileName(name);
  const current = readConfig();
  if (!current.profiles?.[profileName]) {
    throw new ActionDockCliError(`Profile 不存在: ${profileName}`, 2);
  }
  const profiles = { ...current.profiles };
  delete profiles[profileName];
  const next: ConfigFile = {
    currentProfile: current.currentProfile === profileName ? undefined : current.currentProfile,
    profiles
  };
  writeConfig(next);
  return next;
}

export function setConfigValue(key: keyof ConfigProfile, value: string, profile?: string): ConfigFile {
  const profileName = resolveConfigMutationProfile(profile);
  const normalized = key === "serverUrl" ? normalizeServerUrl(value) : value.trim();
  if (!normalized) {
    throw new ActionDockCliError(`配置项 ${key === "serverUrl" ? "server" : "token"} 不能为空。`, 2);
  }
  return upsertProfile(profileName, { [key]: normalized });
}

export function clearConfigValue(key: keyof ConfigProfile, profile?: string): ConfigFile {
  const profileName = resolveConfigMutationProfile(profile);
  const current = readConfig();
  const currentProfile = current.profiles?.[profileName];
  if (!currentProfile) {
    throw new ActionDockCliError(`Profile 不存在: ${profileName}`, 2);
  }
  const nextProfile = { ...currentProfile };
  delete nextProfile[key];
  const next: ConfigFile = {
    ...current,
    profiles: {
      ...(current.profiles ?? {}),
      [profileName]: nextProfile
    }
  };
  writeConfig(next);
  return next;
}

function resolveConfigMutationProfile(profile: string | undefined): string {
  if (profile) {
    return validateProfileName(profile);
  }
  const current = readConfig().currentProfile;
  if (!current) {
    throw new ActionDockCliError("未设置当前 profile，请先执行 `actiondock config add <name> --server <url>`。", 2);
  }
  return validateProfileName(current);
}

export function resolveProfileName(flagValue: string | undefined, config = readConfig()): string | undefined {
  const value = flagValue ?? process.env.ACTIONDOCK_PROFILE ?? config.currentProfile;
  return value?.trim() ? validateProfileName(value) : undefined;
}

export function resolveProfile(flagValue: string | undefined, config = readConfig()): ConfigProfile | undefined {
  const profileName = resolveProfileName(flagValue, config);
  if (!profileName) {
    return undefined;
  }
  const profile = config.profiles?.[profileName];
  if (!profile) {
    throw new ActionDockCliError(`Profile 不存在: ${profileName}`, 2);
  }
  return profile;
}

export function resolveServerUrl(flagsOrServer?: ConnectionFlags | string): string {
  const flags = normalizeConnectionFlags(flagsOrServer);
  if (flags.server) {
    return normalizeServerUrl(flags.server) ?? DEFAULT_SERVER_URL;
  }

  const config = readConfig();
  if (flags.profile) {
    return normalizeServerUrl(resolveProfile(flags.profile, config)?.serverUrl) ?? DEFAULT_SERVER_URL;
  }

  const profile = process.env.ACTIONDOCK_BASE_URL ? undefined : resolveProfile(undefined, config);
  return normalizeServerUrl(process.env.ACTIONDOCK_BASE_URL ?? profile?.serverUrl) ?? DEFAULT_SERVER_URL;
}

export function resolveToken(flagsOrToken?: ConnectionFlags | string): string | undefined {
  const flags = typeof flagsOrToken === "string" || flagsOrToken === undefined ? { token: flagsOrToken } : flagsOrToken;
  if (flags.token?.trim()) {
    return flags.token.trim();
  }

  const config = readConfig();
  if (flags.profile) {
    return resolveProfile(flags.profile, config)?.token?.trim() || undefined;
  }

  const profile = process.env.ACTIONDOCK_TOKEN ? undefined : resolveProfile(undefined, config);
  const token = process.env.ACTIONDOCK_TOKEN ?? profile?.token;
  return token?.trim() ? token.trim() : undefined;
}

function normalizeConnectionFlags(flagsOrServer?: ConnectionFlags | string): ConnectionFlags {
  if (typeof flagsOrServer === "string" || flagsOrServer === undefined) {
    return { server: flagsOrServer };
  }
  return flagsOrServer;
}

export function normalizeServerUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  return value.trim().replace(/\/+$/, "");
}

export function buildConfigView(config: ConfigFile, profile?: string) {
  const profileName = resolveProfileName(profile, config);
  const selected = profileName ? config.profiles?.[profileName] : undefined;
  return {
    path: configPath(),
    currentProfile: config.currentProfile ?? null,
    profile: profileName ?? null,
    serverUrl: normalizeServerUrl(selected?.serverUrl),
    tokenConfigured: Boolean(selected?.token?.trim())
  };
}

export function buildConfigListView(config: ConfigFile) {
  return {
    path: configPath(),
    currentProfile: config.currentProfile ?? null,
    profiles: Object.entries(config.profiles ?? {}).map(([name, profile]) => ({
      name,
      current: name === config.currentProfile,
      serverUrl: normalizeServerUrl(profile.serverUrl),
      tokenConfigured: Boolean(profile.token?.trim())
    }))
  };
}
