export interface ProfileEntry {
  serverUrl: string;
  token?: string;
  description?: string;
}

export interface ProfilesConfig {
  currentProfile?: string;
  profiles: Record<string, ProfileEntry>;
}

export interface ResolvedTarget {
  type: "local" | "remote";
  profileName?: string;
  serverUrl?: string;
  token?: string;
}

export interface RemoteHealthResult {
  ok: boolean;
  status?: string;
  version?: string;
  uptime?: number;
  latencyMs: number;
  error?: string;
}
