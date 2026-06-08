import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActionDockCliError } from "../src/lib/error.js";
import type { ConfigFile } from "../src/lib/types.js";
import {
  buildConfigListView,
  buildConfigView,
  clearConfigValue,
  configPath,
  normalizeServerUrl,
  readConfig,
  removeProfile,
  resolveProfile,
  resolveProfileName,
  resolveServerUrl,
  resolveToken,
  setConfigValue,
  upsertProfile,
  useProfile,
  validateProfileName,
  writeConfig,
} from "../src/lib/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let origXdg: string | undefined;
let origPlatform: string | undefined;
let origEnvBaseUrl: string | undefined;
let origEnvToken: string | undefined;
let origEnvProfile: string | undefined;

function configFilePath(): string {
  return path.join(tmpDir, "actiondock", "config.json");
}

/**
 * Apply mocks so that configPath() resolves to our temp directory.
 * We mock configDir indirectly by patching XDG_CONFIG_HOME on linux.
 */
function applyFsMocks() {
  // We'll directly mock the fs calls and configPath via vi.mock is complex
  // because configDir uses process.platform. Instead, we'll override XDG_CONFIG_HOME.
  process.env.XDG_CONFIG_HOME = tmpDir;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-cfg-test-"));
  origXdg = process.env.XDG_CONFIG_HOME;
  origPlatform = process.platform;
  origEnvBaseUrl = process.env.ACTIONDOCK_BASE_URL;
  origEnvToken = process.env.ACTIONDOCK_TOKEN;
  origEnvProfile = process.env.ACTIONDOCK_PROFILE;
  delete process.env.ACTIONDOCK_BASE_URL;
  delete process.env.ACTIONDOCK_TOKEN;
  delete process.env.ACTIONDOCK_PROFILE;
  applyFsMocks();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (origXdg !== undefined) {
    process.env.XDG_CONFIG_HOME = origXdg;
  } else {
    delete process.env.XDG_CONFIG_HOME;
  }
  if (origEnvBaseUrl !== undefined) process.env.ACTIONDOCK_BASE_URL = origEnvBaseUrl;
  else delete process.env.ACTIONDOCK_BASE_URL;
  if (origEnvToken !== undefined) process.env.ACTIONDOCK_TOKEN = origEnvToken;
  else delete process.env.ACTIONDOCK_TOKEN;
  if (origEnvProfile !== undefined) process.env.ACTIONDOCK_PROFILE = origEnvProfile;
  else delete process.env.ACTIONDOCK_PROFILE;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// normalizeServerUrl
// ---------------------------------------------------------------------------
describe("normalizeServerUrl", () => {
  it("trims trailing slashes", () => {
    expect(normalizeServerUrl("http://example.com///")).toBe("http://example.com");
  });

  it("trims whitespace and trailing slashes", () => {
    expect(normalizeServerUrl("  http://example.com/  ")).toBe("http://example.com");
  });

  it("returns undefined for empty string", () => {
    expect(normalizeServerUrl("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(normalizeServerUrl("   ")).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(normalizeServerUrl(undefined)).toBeUndefined();
  });

  it("preserves URL without trailing slash", () => {
    expect(normalizeServerUrl("http://localhost:5177")).toBe("http://localhost:5177");
  });
});

// ---------------------------------------------------------------------------
// validateProfileName
// ---------------------------------------------------------------------------
describe("validateProfileName", () => {
  it("accepts valid names with letters, numbers, underscore, dash, dot", () => {
    expect(validateProfileName("my-profile_1.0")).toBe("my-profile_1.0");
  });

  it("trims whitespace from the name", () => {
    expect(validateProfileName("  local  ")).toBe("local");
  });

  it("rejects empty name after trim", () => {
    expect(() => validateProfileName("   ")).toThrow(ActionDockCliError);
  });

  it("rejects empty string", () => {
    expect(() => validateProfileName("")).toThrow(ActionDockCliError);
  });

  it("rejects names with special characters", () => {
    expect(() => validateProfileName("bad name!")).toThrow(ActionDockCliError);
    expect(() => validateProfileName("a/b")).toThrow(ActionDockCliError);
    expect(() => validateProfileName("a@b")).toThrow(ActionDockCliError);
  });
});

// ---------------------------------------------------------------------------
// readConfig / writeConfig
// ---------------------------------------------------------------------------
describe("readConfig", () => {
  it("returns empty object when config file does not exist", () => {
    expect(readConfig()).toEqual({});
  });

  it("returns empty object for empty file", () => {
    const file = configFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "   \n  ");
    expect(readConfig()).toEqual({});
  });

  it("reads a valid config file", () => {
    const file = configFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      currentProfile: "local",
      profiles: { local: { serverUrl: "http://localhost:5177", token: "abc" } }
    }));
    const cfg = readConfig();
    expect(cfg.currentProfile).toBe("local");
    expect(cfg.profiles?.local?.serverUrl).toBe("http://localhost:5177");
    expect(cfg.profiles?.local?.token).toBe("abc");
  });

  it("throws on non-object JSON", () => {
    const file = configFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "42");
    expect(() => readConfig()).toThrow(ActionDockCliError);
  });

  it("throws on JSON array", () => {
    const file = configFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "[1,2,3]");
    expect(() => readConfig()).toThrow(ActionDockCliError);
  });

  it("handles profiles with non-record values by skipping them", () => {
    const file = configFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      profiles: {
        valid: { serverUrl: "http://localhost" },
        invalid: "not-a-record",
        also_invalid: 123
      }
    }));
    const cfg = readConfig();
    expect(Object.keys(cfg.profiles!)).toEqual(["valid"]);
  });

  it("handles profile with non-string serverUrl by defaulting to undefined", () => {
    const file = configFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      profiles: {
        bad: { serverUrl: 123, token: true }
      }
    }));
    const cfg = readConfig();
    expect(cfg.profiles!.bad.serverUrl).toBeUndefined();
    expect(cfg.profiles!.bad.token).toBeUndefined();
  });

  it("handles missing currentProfile gracefully", () => {
    const file = configFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ profiles: {} }));
    expect(readConfig().currentProfile).toBeUndefined();
  });
});

describe("writeConfig", () => {
  it("creates parent directories and writes formatted JSON", () => {
    const cfg: ConfigFile = {
      currentProfile: "test",
      profiles: { test: { serverUrl: "http://localhost:9999" } }
    };
    writeConfig(cfg);

    const file = configFilePath();
    expect(fs.existsSync(file)).toBe(true);
    const written = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(written.currentProfile).toBe("test");
    expect(written.profiles.test.serverUrl).toBe("http://localhost:9999");
  });
});

// ---------------------------------------------------------------------------
// upsertProfile
// ---------------------------------------------------------------------------
describe("upsertProfile", () => {
  it("creates a new profile and sets it as current", () => {
    const cfg = upsertProfile("local", { serverUrl: "http://localhost:5177" });
    expect(cfg.currentProfile).toBe("local");
    expect(cfg.profiles?.local?.serverUrl).toBe("http://localhost:5177");
  });

  it("merges into existing profile preserving existing fields", () => {
    upsertProfile("local", { serverUrl: "http://localhost:5177" });
    const cfg = upsertProfile("local", { token: "my-token" });
    expect(cfg.profiles?.local?.serverUrl).toBe("http://localhost:5177");
    expect(cfg.profiles?.local?.token).toBe("my-token");
  });

  it("normalizes server URL (trailing slash)", () => {
    const cfg = upsertProfile("local", { serverUrl: "http://localhost:5177/" });
    expect(cfg.profiles?.local?.serverUrl).toBe("http://localhost:5177");
  });

  it("throws when server URL is empty", () => {
    expect(() => upsertProfile("local", { serverUrl: "" })).toThrow(ActionDockCliError);
    expect(() => upsertProfile("local", {})).toThrow(ActionDockCliError);
  });

  it("throws for invalid profile name", () => {
    expect(() => upsertProfile("bad name!", { serverUrl: "http://x" })).toThrow(ActionDockCliError);
  });

  it("does not overwrite currentProfile if one already exists", () => {
    upsertProfile("first", { serverUrl: "http://first" });
    const cfg = upsertProfile("second", { serverUrl: "http://second" });
    expect(cfg.currentProfile).toBe("first");
  });
});

// ---------------------------------------------------------------------------
// useProfile
// ---------------------------------------------------------------------------
describe("useProfile", () => {
  it("switches current profile to the specified one", () => {
    upsertProfile("a", { serverUrl: "http://a" });
    upsertProfile("b", { serverUrl: "http://b" });
    const cfg = useProfile("b");
    expect(cfg.currentProfile).toBe("b");
  });

  it("throws when profile does not exist", () => {
    expect(() => useProfile("nonexistent")).toThrow(ActionDockCliError);
  });
});

// ---------------------------------------------------------------------------
// removeProfile
// ---------------------------------------------------------------------------
describe("removeProfile", () => {
  it("removes a profile and clears currentProfile if it was current", () => {
    upsertProfile("local", { serverUrl: "http://localhost" });
    const cfg = removeProfile("local");
    expect(cfg.profiles?.local).toBeUndefined();
    expect(cfg.currentProfile).toBeUndefined();
  });

  it("removes a profile but keeps currentProfile if different", () => {
    upsertProfile("a", { serverUrl: "http://a" });
    upsertProfile("b", { serverUrl: "http://b" });
    const cfg = removeProfile("b");
    expect(cfg.profiles?.b).toBeUndefined();
    expect(cfg.currentProfile).toBe("a");
  });

  it("throws when removing non-existent profile", () => {
    expect(() => removeProfile("ghost")).toThrow(ActionDockCliError);
  });
});

// ---------------------------------------------------------------------------
// setConfigValue / clearConfigValue
// ---------------------------------------------------------------------------
describe("setConfigValue", () => {
  it("sets serverUrl on current profile", () => {
    upsertProfile("local", { serverUrl: "http://old" });
    const cfg = setConfigValue("serverUrl", "http://new", "local");
    expect(cfg.profiles?.local?.serverUrl).toBe("http://new");
  });

  it("sets token on current profile", () => {
    upsertProfile("local", { serverUrl: "http://x" });
    const cfg = setConfigValue("token", "secret", "local");
    expect(cfg.profiles?.local?.token).toBe("secret");
  });

  it("throws for empty serverUrl value", () => {
    upsertProfile("local", { serverUrl: "http://x" });
    expect(() => setConfigValue("serverUrl", "  ", "local")).toThrow(ActionDockCliError);
  });

  it("throws for empty token value", () => {
    upsertProfile("local", { serverUrl: "http://x" });
    expect(() => setConfigValue("token", "  ", "local")).toThrow(ActionDockCliError);
  });

  it("throws when no current profile and profile not specified", () => {
    expect(() => setConfigValue("serverUrl", "http://x")).toThrow(ActionDockCliError);
  });
});

describe("clearConfigValue", () => {
  it("removes a key from the profile", () => {
    upsertProfile("local", { serverUrl: "http://x", token: "abc" });
    const cfg = clearConfigValue("token", "local");
    expect(cfg.profiles?.local?.token).toBeUndefined();
    expect(cfg.profiles?.local?.serverUrl).toBe("http://x");
  });

  it("throws when profile does not exist", () => {
    expect(() => clearConfigValue("token", "ghost")).toThrow(ActionDockCliError);
  });

  it("throws when no current profile", () => {
    expect(() => clearConfigValue("token")).toThrow(ActionDockCliError);
  });
});

// ---------------------------------------------------------------------------
// resolveProfileName
// ---------------------------------------------------------------------------
describe("resolveProfileName", () => {
  it("returns flag value when provided", () => {
    expect(resolveProfileName("explicit", {})).toBe("explicit");
  });

  it("falls back to env var when flag is undefined", () => {
    process.env.ACTIONDOCK_PROFILE = "env-profile";
    expect(resolveProfileName(undefined, {})).toBe("env-profile");
  });

  it("falls back to config currentProfile", () => {
    expect(resolveProfileName(undefined, { currentProfile: "cfg-profile" })).toBe("cfg-profile");
  });

  it("returns undefined when nothing is set", () => {
    expect(resolveProfileName(undefined, {})).toBeUndefined();
  });

  it("returns undefined when flag value is whitespace-only", () => {
    expect(resolveProfileName("   ", {})).toBeUndefined();
  });

  it("validates the resolved name", () => {
    expect(() => resolveProfileName("bad!", {})).toThrow(ActionDockCliError);
  });
});

// ---------------------------------------------------------------------------
// resolveProfile
// ---------------------------------------------------------------------------
describe("resolveProfile", () => {
  it("returns profile from config", () => {
    const config: ConfigFile = {
      currentProfile: "local",
      profiles: { local: { serverUrl: "http://localhost" } }
    };
    expect(resolveProfile(undefined, config)).toEqual({ serverUrl: "http://localhost" });
  });

  it("throws when profile name is resolved but profile missing", () => {
    expect(() => resolveProfile(undefined, { currentProfile: "missing" })).toThrow(ActionDockCliError);
  });

  it("returns undefined when no profile can be resolved", () => {
    expect(resolveProfile(undefined, {})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveServerUrl
// ---------------------------------------------------------------------------
describe("resolveServerUrl", () => {
  it("returns flag server directly (string shorthand)", () => {
    expect(resolveServerUrl("http://flag:1234")).toBe("http://flag:1234");
  });

  it("returns flag server from ConnectionFlags", () => {
    expect(resolveServerUrl({ server: "http://flag:1234" })).toBe("http://flag:1234");
  });

  it("reads from profile when --profile flag given", () => {
    upsertProfile("myprof", { serverUrl: "http://myprof" });
    expect(resolveServerUrl({ profile: "myprof" })).toBe("http://myprof");
  });

  it("falls back to default when no config and no flags", () => {
    expect(resolveServerUrl()).toBe("http://127.0.0.1:5177");
  });

  it("falls back to default when profile has no serverUrl", () => {
    upsertProfile("empty", { serverUrl: "http://x" });
    // Clear serverUrl via clearConfigValue
    clearConfigValue("serverUrl", "empty");
    useProfile("empty");
    expect(resolveServerUrl({ profile: "empty" })).toBe("http://127.0.0.1:5177");
  });

  it("uses ACTIONDOCK_BASE_URL env var over profile", () => {
    upsertProfile("local", { serverUrl: "http://profile" });
    useProfile("local");
    process.env.ACTIONDOCK_BASE_URL = "http://env-url";
    expect(resolveServerUrl()).toBe("http://env-url");
  });

  it("uses profile serverUrl when ACTIONDOCK_BASE_URL is not set", () => {
    upsertProfile("local", { serverUrl: "http://profile" });
    useProfile("local");
    expect(resolveServerUrl()).toBe("http://profile");
  });

  it("normalizes trailing slashes from flag", () => {
    expect(resolveServerUrl("http://flag:1234///")).toBe("http://flag:1234");
  });
});

// ---------------------------------------------------------------------------
// resolveToken
// ---------------------------------------------------------------------------
describe("resolveToken", () => {
  it("returns flag token directly (string shorthand)", () => {
    expect(resolveToken("my-token")).toBe("my-token");
  });

  it("returns flag token from ConnectionFlags", () => {
    expect(resolveToken({ token: "my-token" })).toBe("my-token");
  });

  it("returns undefined when no token anywhere", () => {
    expect(resolveToken()).toBeUndefined();
  });

  it("reads token from specified profile", () => {
    upsertProfile("local", { serverUrl: "http://x", token: "profile-token" });
    expect(resolveToken({ profile: "local" })).toBe("profile-token");
  });

  it("uses ACTIONDOCK_TOKEN env var over profile token", () => {
    upsertProfile("local", { serverUrl: "http://x", token: "profile-token" });
    useProfile("local");
    process.env.ACTIONDOCK_TOKEN = "env-token";
    expect(resolveToken()).toBe("env-token");
  });

  it("uses profile token when env not set", () => {
    upsertProfile("local", { serverUrl: "http://x", token: "profile-token" });
    useProfile("local");
    expect(resolveToken()).toBe("profile-token");
  });

  it("trims whitespace from token", () => {
    expect(resolveToken("  spaced  ")).toBe("spaced");
  });

  it("returns undefined for whitespace-only flag token", () => {
    expect(resolveToken("   ")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildConfigView
// ---------------------------------------------------------------------------
describe("buildConfigView", () => {
  it("builds view for a named profile", () => {
    const config: ConfigFile = {
      currentProfile: "local",
      profiles: { local: { serverUrl: "http://localhost", token: "abc" } }
    };
    const view = buildConfigView(config, "local");
    expect(view.profile).toBe("local");
    expect(view.serverUrl).toBe("http://localhost");
    expect(view.tokenConfigured).toBe(true);
    expect(view.currentProfile).toBe("local");
  });

  it("returns nulls when no profile resolved", () => {
    const view = buildConfigView({});
    expect(view.profile).toBeNull();
    expect(view.serverUrl).toBeUndefined();
    expect(view.tokenConfigured).toBe(false);
    expect(view.currentProfile).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildConfigListView
// ---------------------------------------------------------------------------
describe("buildConfigListView", () => {
  it("lists profiles with current marker", () => {
    const config: ConfigFile = {
      currentProfile: "a",
      profiles: {
        a: { serverUrl: "http://a" },
        b: { serverUrl: "http://b", token: "secret" }
      }
    };
    const view = buildConfigListView(config);
    expect(view.currentProfile).toBe("a");
    expect(view.profiles).toHaveLength(2);
    const profA = view.profiles.find((p) => p.name === "a");
    const profB = view.profiles.find((p) => p.name === "b");
    expect(profA?.current).toBe(true);
    expect(profB?.current).toBe(false);
    expect(profB?.tokenConfigured).toBe(true);
    expect(profA?.tokenConfigured).toBe(false);
  });

  it("handles empty profiles", () => {
    const view = buildConfigListView({});
    expect(view.profiles).toEqual([]);
    expect(view.currentProfile).toBeNull();
  });
});
