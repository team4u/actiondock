export interface ProfileEntry {
  serverUrl: string;
  /**
   * @deprecated Storing plain text tokens directly in profiles.json is discouraged.
   * Prefer tokenEnv or standard environment variables (e.g. ACTIONDOCK_<PROFILE>_TOKEN).
   */
  token?: string;
  tokenEnv?: string;
  description?: string;
}

export interface ProfilesConfig {
  currentProfile?: string;
  profiles: Record<string, ProfileEntry>;
}

export type TokenResolutionSource =
  | "cli"
  | "tokenEnv"
  | "profileEnv"
  | "profile"
  | "globalEnv"
  | "none";

export interface ResolvedTarget {
  type: "local" | "remote";
  profileName?: string;
  serverUrl?: string;
  token?: string;
  tokenSource?: TokenResolutionSource;
}

export interface RemoteHealthResult {
  ok: boolean;
  status?: string;
  version?: string;
  uptime?: number;
  latencyMs: number;
  error?: string;
}
