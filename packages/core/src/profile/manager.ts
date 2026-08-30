import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { toSnakeUpperCase } from "../runtime/env";
import { getActionDockHome } from "../utils";
import type {
  ProfileEntry,
  ProfilesConfig,
  ResolvedTarget,
  TokenResolutionSource,
} from "./types";

const PROFILE_NAME_REGEX = /^[a-zA-Z0-9_\-\.]+$/;

export const DEFAULT_PROFILES_CONFIG: ProfilesConfig = {
  currentProfile: "local",
  profiles: {
    local: {
      serverUrl: "local",
      description: "Local execution environment",
    },
  },
};

export function normalizeServerUrl(url: string): string {
  let cleaned = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(cleaned) && cleaned !== "local") {
    cleaned = `http://${cleaned}`;
  }
  return cleaned;
}

export function getProfilesFilePath(customHome?: string): string {
  const baseDir = getActionDockHome(customHome);
  return join(baseDir, ".actiondock", "profiles.json");
}

export function loadProfiles(customHome?: string): ProfilesConfig {
  const filePath = getProfilesFilePath(customHome);
  if (!existsSync(filePath)) {
    return structuredClone(DEFAULT_PROFILES_CONFIG);
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.profiles) {
      return structuredClone(DEFAULT_PROFILES_CONFIG);
    }
    return parsed as ProfilesConfig;
  } catch {
    return structuredClone(DEFAULT_PROFILES_CONFIG);
  }
}

export function saveProfiles(data: ProfilesConfig, customHome?: string): void {
  const filePath = getProfilesFilePath(customHome);
  const dir = dirname(filePath);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Ignore on systems where chmod is not supported
    }
  } catch {
    // Ignore
  }

  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });

  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Ignore on systems where chmod is not supported
  }
}

export function addProfile(
  name: string,
  entry: ProfileEntry,
  customHome?: string
): void {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Profile name cannot be empty");
  }
  if (!PROFILE_NAME_REGEX.test(trimmedName)) {
    throw new Error(
      `Invalid profile name '${trimmedName}'. Profile names may only contain letters, numbers, hyphens, underscores, and dots.`
    );
  }

  const profilesConfig = loadProfiles(customHome);
  const normalizedServer = normalizeServerUrl(entry.serverUrl);

  profilesConfig.profiles[trimmedName] = {
    serverUrl: normalizedServer,
    token: entry.token?.trim() || undefined,
    tokenEnv: entry.tokenEnv?.trim() || undefined,
    description: entry.description?.trim() || undefined,
  };

  saveProfiles(profilesConfig, customHome);
}

export function removeProfile(name: string, customHome?: string): boolean {
  const trimmedName = name.trim();
  const profilesConfig = loadProfiles(customHome);

  if (!profilesConfig.profiles[trimmedName]) {
    return false;
  }

  delete profilesConfig.profiles[trimmedName];
  if (profilesConfig.currentProfile === trimmedName) {
    profilesConfig.currentProfile = "local";
  }

  saveProfiles(profilesConfig, customHome);
  return true;
}

export function useProfile(name: string, customHome?: string): void {
  const trimmedName = name.trim();
  const profilesConfig = loadProfiles(customHome);

  if (trimmedName !== "local" && !profilesConfig.profiles[trimmedName]) {
    throw new Error(
      `Profile '${trimmedName}' not found. Use 'ac profile list' to see available profiles or 'ac profile add' to register one.`
    );
  }

  profilesConfig.currentProfile = trimmedName;
  saveProfiles(profilesConfig, customHome);
}

export function getProfile(
  name: string,
  customHome?: string
): ProfileEntry | undefined {
  const profilesConfig = loadProfiles(customHome);
  return profilesConfig.profiles[name.trim()];
}

export function listProfiles(
  customHome?: string
): Array<{ name: string; isCurrent: boolean; entry: ProfileEntry }> {
  const profilesConfig = loadProfiles(customHome);
  const current = profilesConfig.currentProfile || "local";

  const entries: Array<{
    name: string;
    isCurrent: boolean;
    entry: ProfileEntry;
  }> = [];

  // Ensure 'local' is listed
  if (!profilesConfig.profiles["local"]) {
    entries.push({
      name: "local",
      isCurrent: current === "local",
      entry: {
        serverUrl: "local",
        description: "Local execution environment",
      },
    });
  }

  for (const [name, entry] of Object.entries(profilesConfig.profiles)) {
    entries.push({
      name,
      isCurrent: name === current,
      entry,
    });
  }

  return entries;
}

/**
 * Resolves token following multi-tier precedence:
 * 1. CLI explicit --token
 * 2. profile.tokenEnv specified environment variable
 * 3. Derived profile environment variable: ACTIONDOCK_<PROFILE>_TOKEN or <PROFILE>_TOKEN
 * 4. Stored token in profiles.json (deprecated)
 * 5. Global ACTIONDOCK_TOKEN
 */
export function resolveProfileToken(
  profileName?: string,
  entry?: ProfileEntry,
  explicitToken?: string
): { token?: string; source: TokenResolutionSource } {
  // 1. Explicit CLI --token
  if (explicitToken && explicitToken.trim()) {
    return { token: explicitToken.trim(), source: "cli" };
  }

  // 2. Explicit tokenEnv in profile
  if (entry?.tokenEnv && entry.tokenEnv.trim()) {
    const envKey = entry.tokenEnv.trim();
    const envVal = process.env[envKey];
    if (envVal !== undefined && envVal.trim()) {
      return { token: envVal.trim(), source: "tokenEnv" };
    }
  }

  // 3. Derived profile environment variable: ACTIONDOCK_<PROFILE>_TOKEN / <PROFILE>_TOKEN
  if (profileName && profileName !== "local") {
    const snakeName = toSnakeUpperCase(profileName);
    const candidate1 = `ACTIONDOCK_${snakeName}_TOKEN`;
    const candidate2 = `${snakeName}_TOKEN`;
    if (process.env[candidate1] && process.env[candidate1]!.trim()) {
      return { token: process.env[candidate1]!.trim(), source: "profileEnv" };
    }
    if (process.env[candidate2] && process.env[candidate2]!.trim()) {
      return { token: process.env[candidate2]!.trim(), source: "profileEnv" };
    }
  }

  // 4. Stored token in profiles.json (deprecated fallback)
  if (entry?.token && entry.token.trim()) {
    return { token: entry.token.trim(), source: "profile" };
  }

  // 5. Global ACTIONDOCK_TOKEN
  if (process.env.ACTIONDOCK_TOKEN && process.env.ACTIONDOCK_TOKEN.trim()) {
    return { token: process.env.ACTIONDOCK_TOKEN.trim(), source: "globalEnv" };
  }

  return { token: undefined, source: "none" };
}

export function resolveTarget(
  options?: { profile?: string; server?: string; token?: string },
  customHome?: string
): ResolvedTarget {
  // 1. Explicit CLI --server flag
  if (options?.server && options.server.trim()) {
    const resolvedToken = resolveProfileToken(undefined, undefined, options.token);
    return {
      type: "remote",
      serverUrl: normalizeServerUrl(options.server),
      token: resolvedToken.token,
      tokenSource: resolvedToken.source,
    };
  }

  const profilesConfig = loadProfiles(customHome);

  // 2. Explicit CLI --profile flag
  if (options?.profile && options.profile.trim()) {
    const pName = options.profile.trim();
    if (pName === "local") {
      return { type: "local", profileName: "local" };
    }
    const found = profilesConfig.profiles[pName];
    if (!found) {
      throw new Error(
        `Profile '${pName}' not found. Configure it with 'ac profile add ${pName} --server <url>'`
      );
    }
    const resolvedToken = resolveProfileToken(pName, found, options.token);
    return {
      type: "remote",
      profileName: pName,
      serverUrl: found.serverUrl,
      token: resolvedToken.token,
      tokenSource: resolvedToken.source,
    };
  }

  // 3. Environment variable ACTIONDOCK_SERVER_URL
  if (process.env.ACTIONDOCK_SERVER_URL && process.env.ACTIONDOCK_SERVER_URL.trim()) {
    const resolvedToken = resolveProfileToken(undefined, undefined, options?.token);
    return {
      type: "remote",
      serverUrl: normalizeServerUrl(process.env.ACTIONDOCK_SERVER_URL),
      token: resolvedToken.token,
      tokenSource: resolvedToken.source,
    };
  }

  // 4. Environment variable ACTIONDOCK_PROFILE
  if (process.env.ACTIONDOCK_PROFILE && process.env.ACTIONDOCK_PROFILE.trim()) {
    const pName = process.env.ACTIONDOCK_PROFILE.trim();
    if (pName === "local") {
      return { type: "local", profileName: "local" };
    }
    const found = profilesConfig.profiles[pName];
    if (!found) {
      throw new Error(
        `Profile '${pName}' (from ACTIONDOCK_PROFILE) not found. Configure it with 'ac profile add ${pName} --server <url>'`
      );
    }
    const resolvedToken = resolveProfileToken(pName, found, options?.token);
    return {
      type: "remote",
      profileName: pName,
      serverUrl: found.serverUrl,
      token: resolvedToken.token,
      tokenSource: resolvedToken.source,
    };
  }

  // 5. Current Profile in config
  const current = profilesConfig.currentProfile;
  if (current && current !== "local") {
    const found = profilesConfig.profiles[current];
    if (found && found.serverUrl && found.serverUrl !== "local") {
      const resolvedToken = resolveProfileToken(current, found, options?.token);
      return {
        type: "remote",
        profileName: current,
        serverUrl: found.serverUrl,
        token: resolvedToken.token,
        tokenSource: resolvedToken.source,
      };
    }
  }

  // 6. Default to local
  return { type: "local", profileName: "local" };
}
