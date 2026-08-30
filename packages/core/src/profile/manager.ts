import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ProfileEntry, ProfilesConfig, ResolvedTarget } from "./types";

const PROFILE_NAME_REGEX = /^[a-zA-Z0-9_\-\.]+$/;

export function normalizeServerUrl(url: string): string {
  let cleaned = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(cleaned) && cleaned !== "local") {
    cleaned = `http://${cleaned}`;
  }
  return cleaned;
}

export function getProfilesFilePath(customHome?: string): string {
  const baseDir = customHome || process.env.ACTIONDOCK_HOME || homedir();
  return join(baseDir, ".actiondock", "profiles.json");
}

export function loadProfiles(customHome?: string): ProfilesConfig {
  const filePath = getProfilesFilePath(customHome);
  if (!existsSync(filePath)) {
    return {
      currentProfile: "local",
      profiles: {
        local: {
          serverUrl: "local",
          description: "Local execution environment",
        },
      },
    };
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.profiles) {
      return {
        currentProfile: "local",
        profiles: {
          local: {
            serverUrl: "local",
            description: "Local execution environment",
          },
        },
      };
    }
    return parsed as ProfilesConfig;
  } catch {
    return {
      currentProfile: "local",
      profiles: {
        local: {
          serverUrl: "local",
          description: "Local execution environment",
        },
      },
    };
  }
}

export function saveProfiles(data: ProfilesConfig, customHome?: string): void {
  const filePath = getProfilesFilePath(customHome);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
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

export function resolveTarget(
  options?: { profile?: string; server?: string; token?: string },
  customHome?: string
): ResolvedTarget {
  // 1. Explicit CLI --server flag
  if (options?.server && options.server.trim()) {
    return {
      type: "remote",
      serverUrl: normalizeServerUrl(options.server),
      token: options.token?.trim() || process.env.ACTIONDOCK_TOKEN,
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
    return {
      type: "remote",
      profileName: pName,
      serverUrl: found.serverUrl,
      token: options.token?.trim() || found.token || process.env.ACTIONDOCK_TOKEN,
    };
  }

  // 3. Environment variable ACTIONDOCK_SERVER_URL
  if (process.env.ACTIONDOCK_SERVER_URL && process.env.ACTIONDOCK_SERVER_URL.trim()) {
    return {
      type: "remote",
      serverUrl: normalizeServerUrl(process.env.ACTIONDOCK_SERVER_URL),
      token: options?.token?.trim() || process.env.ACTIONDOCK_TOKEN,
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
    return {
      type: "remote",
      profileName: pName,
      serverUrl: found.serverUrl,
      token: options?.token?.trim() || found.token || process.env.ACTIONDOCK_TOKEN,
    };
  }

  // 5. Current Profile in config
  const current = profilesConfig.currentProfile;
  if (current && current !== "local") {
    const found = profilesConfig.profiles[current];
    if (found && found.serverUrl && found.serverUrl !== "local") {
      return {
        type: "remote",
        profileName: current,
        serverUrl: found.serverUrl,
        token: options?.token?.trim() || found.token || process.env.ACTIONDOCK_TOKEN,
      };
    }
  }

  // 6. Default to local
  return { type: "local", profileName: "local" };
}
