import { describe, expect, it } from "vitest";
import {
  buildSystemSettingsSearch,
  isSystemSettingsRoute,
  resolveSystemSettingsTab
} from "./settingsRouting";

describe("settings routing helpers", () => {
  it("defaults to config-values when tab is missing or invalid", () => {
    expect(resolveSystemSettingsTab("")).toBe("config-values");
    expect(resolveSystemSettingsTab("?tab=unknown")).toBe("config-values");
  });

  it("resolves known tabs from search params", () => {
    expect(resolveSystemSettingsTab("?tab=console-token")).toBe("console-token");
    expect(resolveSystemSettingsTab(new URLSearchParams("tab=access-tokens"))).toBe("access-tokens");
    expect(resolveSystemSettingsTab("?tab=config-values")).toBe("config-values");
    expect(resolveSystemSettingsTab("?tab=shared-state")).toBe("shared-state");
  });

  it("builds the canonical settings search string", () => {
    expect(buildSystemSettingsSearch("config-values")).toBe("?tab=config-values");
  });

  it("detects the system settings route", () => {
    expect(isSystemSettingsRoute("/settings")).toBe(true);
    expect(isSystemSettingsRoute("/config-values")).toBe(false);
  });
});
