import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defineAction,
  type ActionInvokeOptions,
  type ActionRef,
} from "@actiondock/sdk";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import { createPackageIdentity } from "../src/runtime/identity";
import { createActionContext } from "../src/runtime/context";
import { DefaultExecutionService } from "../src/execution/service";
import { ActionDockError, INVALID_ARGUMENT } from "../src/errors";

describe("ActionInvokeOptions and Invocation Chain", () => {
  it("supports passing options via callable ctx.actions", async () => {
    let capturedRef: string | ActionRef | undefined;
    let capturedInput: unknown;
    let capturedParentRunId: string | undefined;
    let capturedOptions: ActionInvokeOptions | undefined;

    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const ctx = createActionContext({
      storage,
      onActionInvoke: async (action, input, parentRunId, options) => {
        capturedRef = action;
        capturedInput = input;
        capturedParentRunId = parentRunId;
        capturedOptions = options;
        return { success: true };
      },
    });

    const result = await ctx.actions(
      "target.action",
      { message: "hello" },
      { binding: "custom-worker" }
    );

    assert.deepStrictEqual(result, { success: true });
    assert.strictEqual(capturedRef, "target.action");
    assert.deepStrictEqual(capturedInput, { message: "hello" });
    assert.ok(capturedParentRunId);
    assert.deepStrictEqual(capturedOptions, { binding: "custom-worker" });
  });

  it("supports passing options via ctx.actions.invoke", async () => {
    let capturedRef: string | ActionRef | undefined;
    let capturedInput: unknown;
    let capturedOptions: ActionInvokeOptions | undefined;

    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const ctx = createActionContext({
      storage,
      onActionInvoke: async (action, input, _parentRunId, options) => {
        capturedRef = action;
        capturedInput = input;
        capturedOptions = options;
        return { answer: 42 };
      },
    });

    const result = await ctx.actions.invoke<{ num: number }, { answer: number }>(
      "calc.compute",
      { num: 10 },
      { binding: "gpu-node" }
    );

    assert.deepStrictEqual(result, { answer: 42 });
    assert.strictEqual(capturedRef, "calc.compute");
    assert.deepStrictEqual(capturedInput, { num: 10 });
    assert.deepStrictEqual(capturedOptions, { binding: "gpu-node" });
  });

  it("retains backward compatibility for two-argument and single-argument calls", async () => {
    const invocations: Array<{
      action: string | ActionRef;
      input: unknown;
      options: ActionInvokeOptions | undefined;
    }> = [];

    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const ctx = createActionContext({
      storage,
      onActionInvoke: async (action, input, _parentRunId, options) => {
        invocations.push({ action, input, options });
        return { echoed: input };
      },
    });

    // Callable with 2 args
    await ctx.actions("act1", { a: 1 });
    // Callable with 1 arg
    await ctx.actions("act2");
    // .invoke with 2 args
    await ctx.actions.invoke("act3", { b: 2 });
    // .invoke with 1 arg
    await ctx.actions.invoke("act4");
    // Explicit empty options
    await ctx.actions("act5", { c: 3 }, {});

    assert.strictEqual(invocations.length, 5);
    assert.strictEqual(invocations[0].action, "act1");
    assert.deepStrictEqual(invocations[0].input, { a: 1 });
    assert.strictEqual(invocations[0].options, undefined);

    assert.strictEqual(invocations[1].action, "act2");
    assert.strictEqual(invocations[1].input, undefined);
    assert.strictEqual(invocations[1].options, undefined);

    assert.strictEqual(invocations[2].action, "act3");
    assert.deepStrictEqual(invocations[2].input, { b: 2 });
    assert.strictEqual(invocations[2].options, undefined);

    assert.strictEqual(invocations[3].action, "act4");
    assert.strictEqual(invocations[3].input, undefined);
    assert.strictEqual(invocations[3].options, undefined);

    assert.strictEqual(invocations[4].action, "act5");
    assert.deepStrictEqual(invocations[4].options, {});
  });

  it("throws ActionDockError(INVALID_ARGUMENT) on non-plain-object options", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const ctx = createActionContext({
      storage,
      onActionInvoke: async () => ({}),
    });

    const invalidNonPlainObjects: unknown[] = [
      null,
      123,
      "binding-string",
      true,
      false,
      [],
      ["binding"],
      new Date(),
      new (class CustomOptions {})(),
    ];

    for (const bad of invalidNonPlainObjects) {
      await assert.rejects(
        async () => {
          await ctx.actions("test.action", {}, bad as any);
        },
        (err: unknown) => {
          assert.ok(err instanceof ActionDockError);
          assert.strictEqual(err.code, INVALID_ARGUMENT);
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await ctx.actions.invoke("test.action", {}, bad as any);
        },
        (err: unknown) => {
          assert.ok(err instanceof ActionDockError);
          assert.strictEqual(err.code, INVALID_ARGUMENT);
          return true;
        }
      );
    }
  });

  it("throws ActionDockError(INVALID_ARGUMENT) on unknown fields in options", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const ctx = createActionContext({
      storage,
      onActionInvoke: async () => ({}),
    });

    const unknownFieldCases = [
      { profile: "dev" },
      { server: "remote" },
      { token: "abc-123" },
      { binding: "valid", profile: "dev" },
      { binding: "valid", extraField: true },
      { [Symbol("custom")]: "val" },
    ];

    for (const bad of unknownFieldCases) {
      await assert.rejects(
        async () => {
          await ctx.actions("test.action", {}, bad as any);
        },
        (err: unknown) => {
          assert.ok(err instanceof ActionDockError);
          assert.strictEqual(err.code, INVALID_ARGUMENT);
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await ctx.actions.invoke("test.action", {}, bad as any);
        },
        (err: unknown) => {
          assert.ok(err instanceof ActionDockError);
          assert.strictEqual(err.code, INVALID_ARGUMENT);
          return true;
        }
      );
    }
  });

  it("throws ActionDockError(INVALID_ARGUMENT) on non-string or blank binding", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const ctx = createActionContext({
      storage,
      onActionInvoke: async () => ({}),
    });

    const invalidBindingValues = [
      { binding: 123 },
      { binding: null },
      { binding: true },
      { binding: false },
      { binding: {} },
      { binding: [] },
      { binding: "" },
      { binding: "   " },
      { binding: "\t\n  " },
    ];

    for (const bad of invalidBindingValues) {
      await assert.rejects(
        async () => {
          await ctx.actions("test.action", {}, bad as any);
        },
        (err: unknown) => {
          assert.ok(err instanceof ActionDockError);
          assert.strictEqual(err.code, INVALID_ARGUMENT);
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await ctx.actions.invoke("test.action", {}, bad as any);
        },
        (err: unknown) => {
          assert.ok(err instanceof ActionDockError);
          assert.strictEqual(err.code, INVALID_ARGUMENT);
          return true;
        }
      );
    }
  });

  it("delegates options completely through ExecutionService to internal ActionInvoker", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "demo-pkg",
      dbPath: ":memory:",
    });

    const calls: Array<{
      childAction: string | ActionRef;
      childInput: unknown;
      options?: ActionInvokeOptions;
    }> = [];

    const parentAction = defineAction({
      async run(_input: unknown, ctx) {
        // 1. callable with options
        const res1 = await ctx.actions(
          "child.worker",
          { step: 1 },
          { binding: "pool-a" }
        );
        // 2. .invoke with options
        const res2 = await ctx.actions.invoke(
          "child.worker",
          { step: 2 },
          { binding: "pool-b" }
        );
        // 3. callable without options (compatibility)
        const res3 = await ctx.actions("child.worker", { step: 3 });
        // 4. .invoke without options (compatibility)
        const res4 = await ctx.actions.invoke("child.worker", { step: 4 });

        return { res1, res2, res3, res4 };
      },
    });

    const service = new DefaultExecutionService({
      identity: createPackageIdentity({ id: "demo-pkg" }),
      storage,
      actions: new Map([["parent.action", parentAction]]),
      actionInvoker: async (childAction, childInput, _context, options) => {
        calls.push({ childAction, childInput, options });
        return { ok: true, childInput };
      },
    });

    const result = await service.execute("parent.action", {});

    assert.strictEqual(result.ok, true);
    assert.strictEqual(calls.length, 4);

    assert.strictEqual(calls[0].childAction, "child.worker");
    assert.deepStrictEqual(calls[0].childInput, { step: 1 });
    assert.deepStrictEqual(calls[0].options, { binding: "pool-a" });

    assert.strictEqual(calls[1].childAction, "child.worker");
    assert.deepStrictEqual(calls[1].childInput, { step: 2 });
    assert.deepStrictEqual(calls[1].options, { binding: "pool-b" });

    assert.strictEqual(calls[2].childAction, "child.worker");
    assert.deepStrictEqual(calls[2].childInput, { step: 3 });
    assert.strictEqual(calls[2].options, undefined);

    assert.strictEqual(calls[3].childAction, "child.worker");
    assert.deepStrictEqual(calls[3].childInput, { step: 4 });
    assert.strictEqual(calls[3].options, undefined);
  });

  it("handles invalid options during ExecutionService execution by failing run", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "demo-pkg",
      dbPath: ":memory:",
    });

    const failingAction = defineAction({
      async run(_input: unknown, ctx) {
        // Pass illegal options with unknown field
        return await ctx.actions("child.worker", {}, { profile: "invalid" } as any);
      },
    });

    const service = new DefaultExecutionService({
      identity: createPackageIdentity({ id: "demo-pkg" }),
      storage,
      actions: new Map([["failing.action", failingAction]]),
      actionInvoker: async () => ({ ok: true }),
    });

    const result = await service.execute("failing.action", {});
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, INVALID_ARGUMENT);
      assert.match(result.error.message, /Unknown option 'profile'/);
    }
  });
});
