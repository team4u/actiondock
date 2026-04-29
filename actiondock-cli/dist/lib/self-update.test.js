import { describe, expect, it } from "vitest";
import { buildSelfUpdatePlan, resolveSelfUpdateTarget } from "./self-update.js";
describe("self-update", () => {
    it("always uses npm as the executable", () => {
        const plan = buildSelfUpdatePlan({
            packageName: "@actiondock/cli",
            target: "latest",
            platform: "win32"
        });
        expect(plan.executable).toBe("npm");
        expect(plan.command).toBe("npm install -g @actiondock/cli@latest");
    });
    it("resolves default target to latest", () => {
        expect(resolveSelfUpdateTarget(undefined)).toBe("latest");
        expect(resolveSelfUpdateTarget("  ")).toBe("latest");
    });
});
