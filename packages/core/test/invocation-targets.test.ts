import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineAction } from "@actiondock/sdk";
import { createActionDockHost } from "../src/host";
import { createPackageRuntime } from "../src/package";
import { createNodePlatform } from "../src/platform";

async function target(id: string, label: string) {
  const runtime = await createPackageRuntime({
    inMemory: true,
    projectConfig: { id },
    actions: { worker: defineAction({ run: () => ({ label }) }) },
  });
  let closes = 0;
  const originalClose = runtime.close.bind(runtime);
  runtime.close = async (options) => { closes++; await originalClose(options); };
  return { runtime, get closes() { return closes; } };
}

const root = (uses: string[] = ["ext/worker"]) => ({
  inMemory: true,
  projectConfig: { id: "app" },
  actions: {
    run: defineAction({
      uses,
      run: async (_input, ctx) => {
        const primary = await ctx.actions.invoke("ext/worker", {}, { binding: "primary" });
        const fallback = await ctx.actions.invoke("ext/worker", {}, { binding: "fallback" });
        return { primary, fallback };
      },
    }),
  },
});

describe("运行平台调用目标接入", () => {
  it("同名目标分别走真实运行时，保留记录且由 Host 只关闭一次", async () => {
    const primary = await target("ext", "primary");
    const fallback = await target("ext", "fallback");
    let resolverCloses = 0;
    const host = await createActionDockHost({
      autoLoadCurrentProject: false, inMemory: true, packages: [root()],
      platform: {
        ...createNodePlatform(),
        invocationTargets: {
          resolve: (_ref, options) => ({
            runtime: options?.binding === "primary" ? primary.runtime : fallback.runtime,
            scope: `binding:${options?.binding}`,
            requiresExplicitUses: true,
          }),
          close: async () => { resolverCloses++; },
        },
      },
    });
    try {
      const result = await host.execution.run("app/run");
      assert.equal(result.ok, true);
      if (result.ok) assert.deepEqual(result.data, {
        primary: { label: "primary" }, fallback: { label: "fallback" },
      });
      for (const entry of [primary, fallback]) {
        const records = await entry.runtime.listRuns();
        assert.equal(records.length, 1);
        assert.equal(records[0].rootRunId, result.runId);
        assert.equal(records[0].parentRunId, result.runId);
        assert.equal(records[0].status, "success");
      }
      assert.equal(host.listRuntimes().length, 1, "目标不能挤占逻辑包注册表");
    } finally { await host.close(); }
    await host.close();
    assert.equal(primary.closes, 1);
    assert.equal(fallback.closes, 1);
    assert.equal(resolverCloses, 1);
  });

  it("拒绝解析到其他逻辑包，不能借目标注入改变授权对象", async () => {
    const wrong = await target("wrong", "wrong");
    const host = await createActionDockHost({
      autoLoadCurrentProject: false, inMemory: true, packages: [root()],
      platform: {
        ...createNodePlatform(),
        invocationTargets: { resolve: () => ({ runtime: wrong.runtime }) },
      },
    });
    try {
      const result = await host.execution.run("app/run");
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, "INVALID_ACTION_REF");
      assert.equal((await wrong.runtime.listRuns()).length, 0);
    } finally {
      await host.close();
      await wrong.runtime.close();
    }
  });

  it("授权拒绝后仍释放已经接管的目标，不执行其处理函数", async () => {
    const extra = await target("ext", "unused");
    const host = await createActionDockHost({
      autoLoadCurrentProject: false, inMemory: true, packages: [root([])],
      platform: {
        ...createNodePlatform(),
        invocationTargets: { resolve: () => ({ runtime: extra.runtime, requiresExplicitUses: true }) },
      },
    });
    try {
      const result = await host.execution.run("app/run");
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, "UNDECLARED_ACTION_DEPENDENCY");
      assert.equal((await extra.runtime.listRuns()).length, 0);
    } finally { await host.close(); }
    assert.equal(extra.closes, 1);
  });

  it("端口清理失败透传，但不阻止目标运行时释放", async () => {
    const extra = await target("ext", "ok");
    const failure = new Error("resolver cleanup failed");
    const host = await createActionDockHost({
      autoLoadCurrentProject: false, inMemory: true, packages: [root()],
      platform: {
        ...createNodePlatform(),
        invocationTargets: {
          resolve: () => ({ runtime: extra.runtime, scope: "fixture" }),
          close: async () => { throw failure; },
        },
      },
    });
    const result = await host.execution.run("app/run");
    assert.equal(result.ok, true);
    await assert.rejects(host.close(), (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.ok(error.errors.includes(failure));
      return true;
    });
    assert.equal(extra.closes, 1);
  });
});
