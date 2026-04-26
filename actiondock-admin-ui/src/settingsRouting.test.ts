import { describe, expect, it } from "vitest";
import {
  buildSystemSettingsSearch,
  isApiKeySettingsRoute,
  resolveSystemSettingsTab
} from "./settingsRouting";

describe("settings routing helpers", () => {
  it("defaults to api-key when tab is missing or invalid", () => {
    expect(resolveSystemSettingsTab("")).toBe("api-key");
    expect(resolveSystemSettingsTab("?tab=unknown")).toBe("api-key");
  });

  it("resolves the api-key tab from search params", () => {
    expect(resolveSystemSettingsTab("?tab=api-key")).toBe("api-key");
    expect(resolveSystemSettingsTab(new URLSearchParams("tab=api-key"))).toBe("api-key");
  });

  it("builds the canonical api-key settings search string", () => {
    expect(buildSystemSettingsSearch("api-key")).toBe("?tab=api-key");
  });

  it("detects both canonical and legacy api-key settings routes", () => {
    expect(isApiKeySettingsRoute("/settings", "?tab=api-key")).toBe(true);
    expect(isApiKeySettingsRoute("/settings/api-key", "")).toBe(true);
    expect(isApiKeySettingsRoute("/settings", "")).toBe(true);
    expect(isApiKeySettingsRoute("/config-values", "")).toBe(false);
  });
});
