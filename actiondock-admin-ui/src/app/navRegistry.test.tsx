import { describe, expect, it } from "vitest";
import { resolveSelectedNavKey, resolveTitle } from "./navRegistry";

describe("app nav registry", () => {
  it("maps routes into the new top-level sections", () => {
    expect(resolveSelectedNavKey("/scripts")).toBe("capabilities");
    expect(resolveSelectedNavKey("/discover")).toBe("resources");
    expect(resolveSelectedNavKey("/webhooks")).toBe("executions");
    expect(resolveSelectedNavKey("/settings")).toBe("settings");
  });

  it("resolves manifest-provided titles", () => {
    expect(resolveTitle("/scripts", "capabilities")).toBe("脚本");
    expect(resolveTitle("/scripts/abc/run", "capabilities")).toBe("脚本运行");
    expect(resolveTitle("/plugins/hello", "resources")).toBe("插件详情");
    expect(resolveTitle("/webhooks", "executions")).toBe("Webhook");
    expect(resolveTitle("/schedules", "executions")).toBe("定时任务");
  });
});
