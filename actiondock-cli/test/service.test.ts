import { describe, expect, it } from "vitest";

import { ActionDockCliError } from "../src/lib/error.js";
import { runServiceAction } from "../src/lib/service.js";

describe("service management", () => {
  it("does not forward service actions to the Java runtime on unsupported platforms", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", {
      value: "win32",
    });

    try {
      await expect(runServiceAction("status", []))
        .rejects.toThrow(ActionDockCliError);
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform);
      }
    }
  });
});
