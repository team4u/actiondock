import { describe, expect, it } from "vitest";

import { buildSelfUpdatePlan, resolveSelfUpdateTarget } from "../src/lib/self-update.js";

describe("self update helpers", () => {
  it("defaults target to latest", () => {
    expect(resolveSelfUpdateTarget(undefined)).toBe("latest");
  });

  it("builds npm install command for unix-like platforms", () => {
    const plan = buildSelfUpdatePlan({
      packageName: "@actiondock/cli",
      target: "latest",
      platform: "linux",
    });

    expect(plan).toEqual({
      executable: "npm",
      args: ["install", "-g", "@actiondock/cli@latest"],
      packageName: "@actiondock/cli",
      target: "latest",
      command: "npm install -g @actiondock/cli@latest",
    });
  });

  it("uses npm on windows", () => {
    const plan = buildSelfUpdatePlan({
      packageName: "@actiondock/cli",
      target: "0.1.4",
      platform: "win32",
    });

    expect(plan.executable).toBe("npm");
    expect(plan.command).toBe("npm install -g @actiondock/cli@0.1.4");
  });
});
