import { describe, expect, it } from "bun:test";
import { createTestRuntime, defineAction } from "../src";

describe("@actiondock/sdk", () => {
  it("defines an action with validation", () => {
    const action = defineAction({
      id: "test.greet",
      description: "Greet a user",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      run: (input: { name: string }) => `Hello, ${input.name}!`,
    });

    expect(action.id).toBe("test.greet");
    expect(action.description).toBe("Greet a user");
  });

  it("throws error for invalid action definition", () => {
    expect(() => defineAction({} as any)).toThrow();
    expect(() => defineAction({ id: "test" } as any)).toThrow();
  });

  it("executes an action in test runtime with config and state", async () => {
    const counterAction = defineAction({
      id: "test.counter",
      async run(_input: unknown, ctx) {
        const prefix = ctx.config.get("PREFIX", "Count:");
        const current = (await ctx.state.get<number>("count")) || 0;
        const next = current + 1;
        await ctx.state.set("count", next);
        ctx.log.info(`Updated count to ${next}`);
        return `${prefix} ${next}`;
      },
    });

    const runtime = createTestRuntime({
      config: { PREFIX: "Total:" },
      state: { count: 5 },
    });

    const res1 = await runtime.run(counterAction, {});
    expect(res1).toBe("Total: 6");
    expect(await runtime.state.get<number>("count")).toBe(6);

    const res2 = await runtime.run(counterAction, {});
    expect(res2).toBe("Total: 7");
    expect(await runtime.state.get<number>("count")).toBe(7);

    expect(runtime.logger.logs.length).toBe(2);
    expect(runtime.logger.logs[0].message).toContain("Updated count to 6");
  });

  it("supports action-to-action invocation", async () => {
    const childAction = defineAction({
      id: "test.child",
      run: (input: { val: number }) => input.val * 2,
    });

    const parentAction = defineAction({
      id: "test.parent",
      async run(input: { val: number }, ctx) {
        const doubled = await ctx.actions.invoke(childAction, { val: input.val });
        return { result: doubled + 1 };
      },
    });

    const runtime = createTestRuntime();
    const res = await runtime.run(parentAction, { val: 10 });
    expect(res).toEqual({ result: 21 });
  });

  it("detects recursion/cycle in action invocation", async () => {
    const cycleAction: any = defineAction({
      id: "test.cycle",
      async run(_input: unknown, ctx) {
        return ctx.actions.invoke(cycleAction, {});
      },
    });

    const runtime = createTestRuntime();
    expect(runtime.run(cycleAction, {})).rejects.toThrow("Cycle detected");
  });
});
