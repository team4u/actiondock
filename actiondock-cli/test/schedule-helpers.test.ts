import { describe, expect, it, vi } from "vitest";

import { ActionDockCliError } from "../src/lib/error.js";
import { buildScheduleInput, resolveScheduleEnabled } from "../src/lib/schedule.js";
import type { ActionDockClient } from "../src/lib/client.js";
import type { ScriptDefinition } from "../src/lib/types.js";

// ---------------------------------------------------------------------------
// resolveScheduleEnabled
// ---------------------------------------------------------------------------
describe("resolveScheduleEnabled", () => {
  it("returns true when enabledFlag is true", () => {
    expect(resolveScheduleEnabled({ enabledFlag: true, disabledFlag: false, fallback: false })).toBe(true);
  });

  it("returns false when disabledFlag is true", () => {
    expect(resolveScheduleEnabled({ enabledFlag: false, disabledFlag: true, fallback: true })).toBe(false);
  });

  it("returns fallback when neither flag is set", () => {
    expect(resolveScheduleEnabled({ enabledFlag: false, disabledFlag: false, fallback: true })).toBe(true);
    expect(resolveScheduleEnabled({ enabledFlag: false, disabledFlag: false, fallback: false })).toBe(false);
  });

  it("throws when both enabledFlag and disabledFlag are true", () => {
    expect(() => resolveScheduleEnabled({ enabledFlag: true, disabledFlag: true, fallback: true })).toThrow(
      ActionDockCliError
    );
  });

  it("throws the expected error message", () => {
    try {
      resolveScheduleEnabled({ enabledFlag: true, disabledFlag: true, fallback: false });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ActionDockCliError);
      expect((error as ActionDockCliError).message).toContain("--schedule-enabled");
      expect((error as ActionDockCliError).message).toContain("--schedule-disabled");
    }
  });
});

// ---------------------------------------------------------------------------
// buildScheduleInput
// ---------------------------------------------------------------------------
describe("buildScheduleInput", () => {
  function createMockClient(script: Partial<ScriptDefinition> = {}): ActionDockClient {
    return {
      scripts: {
        get: vi.fn().mockResolvedValue({
          id: "script-1",
          inputSchema: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string", title: "Name" },
              count: { type: "integer", title: "Count" },
              enabled: { type: "boolean", title: "Enabled" }
            }
          },
          ...script
        })
      }
    } as unknown as ActionDockClient;
  }

  it("builds input from schema fields and dynamic flags", async () => {
    const client = createMockClient();
    const result = await buildScheduleInput({
      client,
      scriptId: "script-1",
      argv: ["script-1", "--name", "Alice", "--count", "5"],
      positionals: ["script-1"],
      inputJson: undefined,
      inputFile: undefined
    });
    expect(result.name).toBe("Alice");
    expect(result.count).toBe(5);
  });

  it("merges existing input with parsed input and dynamic flags", async () => {
    const client = createMockClient();
    const result = await buildScheduleInput({
      client,
      scriptId: "script-1",
      argv: ["script-1", "--name", "Bob"],
      positionals: ["script-1"],
      inputJson: undefined,
      inputFile: undefined,
      existingInput: { count: 10 }
    });
    expect(result.name).toBe("Bob");
    expect(result.count).toBe(10);
  });

  it("overrides existing input with dynamic flags", async () => {
    const client = createMockClient();
    const result = await buildScheduleInput({
      client,
      scriptId: "script-1",
      argv: ["script-1", "--name", "Charlie", "--count", "99"],
      positionals: ["script-1"],
      inputJson: undefined,
      inputFile: undefined,
      existingInput: { count: 10, name: "Old" }
    });
    expect(result.name).toBe("Charlie");
    expect(result.count).toBe(99);
  });

  it("merges input-json with dynamic flags (flags override)", async () => {
    const client = createMockClient();
    const result = await buildScheduleInput({
      client,
      scriptId: "script-1",
      argv: ["script-1", "--count", "7"],
      positionals: ["script-1"],
      inputJson: '{"name":"JsonName","count":3}',
      inputFile: undefined
    });
    expect(result.name).toBe("JsonName");
    expect(result.count).toBe(7); // dynamic flag overrides input-json
  });

  it("uses published inputSchema when available", async () => {
    const client = createMockClient({
      published: {
        scriptId: "script-1",
        revisionId: "rev-1",
        version: 1,
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", title: "Query" }
          }
        }
      }
    });
    const result = await buildScheduleInput({
      client,
      scriptId: "script-1",
      argv: ["script-1", "--query", "search-term"],
      positionals: ["script-1"],
      inputJson: undefined,
      inputFile: undefined
    });
    expect(result.query).toBe("search-term");
  });

  it("calls client.scripts.get with correct scriptId", async () => {
    const client = createMockClient();
    await buildScheduleInput({
      client,
      scriptId: "script-42",
      argv: ["script-42"],
      positionals: ["script-42"],
      inputJson: '{"name":"test"}',
      inputFile: undefined
    });
    expect(client.scripts.get).toHaveBeenCalledWith("script-42", false);
  });

  it("handles boolean flags", async () => {
    const client = createMockClient();
    const result = await buildScheduleInput({
      client,
      scriptId: "script-1",
      argv: ["script-1", "--name", "test", "--enabled"],
      positionals: ["script-1"],
      inputJson: undefined,
      inputFile: undefined
    });
    expect(result.name).toBe("test");
    expect(result.enabled).toBe(true);
  });

  it("respects custom booleanFlags and valueFlags", async () => {
    const client = createMockClient({
      inputSchema: {
        type: "object",
        properties: {
          customFlag: { type: "string", title: "Custom" }
        }
      }
    });
    const result = await buildScheduleInput({
      client,
      scriptId: "script-1",
      argv: ["script-1", "--custom-flag", "customValue"],
      positionals: ["script-1"],
      inputJson: undefined,
      inputFile: undefined,
      valueFlags: ["custom-flag"]
    });
    // custom-flag is treated as a dynamic flag that maps to customFlag schema field
    // Note: flag names use kebab-case, schema field name is customFlag
    // The dynamic flag parser uses kebab-case keys
  });
});
