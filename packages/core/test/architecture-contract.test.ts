import { describe, expect, it } from "bun:test";
import { defineAction, type ActionContext } from "@actiondock/sdk";
import { createActionDockHost } from "../src/host/host";
import { createPackageRuntime } from "../src/package/runtime";
import { ActionRunner } from "../src/runtime/runner";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import { createPackageIdentity } from "../src/runtime/identity";
import { INVOCATION_UNSUPPORTED, UNDECLARED_ACTION_DEPENDENCY } from "../src/errors";
import { LocalActionDockService } from "../src/service/local";
import type { RunOptions } from "../src/service/types";

describe("架构核心契约测试：信任边界与局部执行规范", () => {
  it("契约 1：Public RunOptions 类型收窄且边界显式挑选受信任字段", async () => {
    // 静态校验：RunOptions 仅暴露普通调用控制字段
    const validOptions: RunOptions = {
      signal: new AbortController().signal,
      timeoutMs: 5000,
      config: { env: "prod" },
      requestId: "req-123",
    };
    expect(validOptions.timeoutMs).toBe(5000);

    const action = defineAction({
      run: async () => {
        return { ok: true };
      },
    });

    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: {
            id: "pkg.public-api",
            actions: { test: { entry: "" } },
          },
          actions: { test: action },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
    });

    const service = new LocalActionDockService(host);

    // 外部传入包含内部血缘字段的非法 options 对象（模拟 JS 动态调用）
    const maliciousOptions = {
      signal: undefined,
      timeoutMs: 3000,
      runId: "injected-run-id",
      parentRunId: "injected-parent-id",
      rootRunId: "injected-root-id",
      callStack: ["pkg.fake/root"],
      owner: { tenantId: "evil-tenant" },
    };

    const res = await service.execution.run("pkg.public-api/test", {}, maliciousOptions as any);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // 内部生成的 runId 绝非外部注入的伪造 ID
      expect(res.runId).not.toBe("injected-run-id");
      const record = await service.runs.get(res.runId);
      expect(record).toBeDefined();
      expect(record?.rootRunId).not.toBe("injected-root-id");
      expect(record?.parentRunId).toBeUndefined();
    }

    await host.close();
  });

  it("契约 2：外部传入未知字段绝无法绕过 Root Visibility", async () => {
    // 构造具备根可见性隔离的场景
    const privateAction = defineAction({
      run: () => ({ secret: "classified" }),
    });

    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: {
            id: "pkg.private-lib",
            name: "私有内部库",
            version: "1.0.0",
            actions: {
              secretAction: { entry: "" },
            },
          },
          actions: { secretAction: privateAction },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
    });

    // 显式将 pkg.private-lib 标记为非公开包（非根可见）并重建图
    (host as any).hostPublicPackageIds.delete("pkg.private-lib");
    (host as any).rebuildGraphAndCatalog();

    // 外部尝试伪造 parentRunId 伪装成嵌套子调用发起根调用
    const bypassAttempt = await host.runAction("pkg.private-lib/secretAction", {}, {
      parentRunId: "legit-parent-run-id",
    } as any);

    // 必须被 Root Visibility 鉴权直接拒绝，绝无法被伪造血缘绕过
    expect(bypassAttempt.ok).toBe(false);
    if (!bypassAttempt.ok) {
      expect(bypassAttempt.error.code).toBe(UNDECLARED_ACTION_DEPENDENCY);
      expect(bypassAttempt.error.message).toContain("not allowed: package 'pkg.private-lib' is not declared as a direct dependency");
    }

    await host.close();
  });

  it("契约 3：Transitive 依赖包的 Action 在根调用中始终被拒绝", async () => {
    const transitiveAction = defineAction({
      run: () => ({ data: "transitive" }),
    });

    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: {
            id: "pkg.root",
            name: "根业务包",
            actions: { main: { entry: "" } },
          },
          actions: { main: defineAction({ run: () => "ok" }) },
          inMemory: true,
        },
        {
          projectConfig: {
            id: "pkg.transitive",
            name: "间接传递依赖包",
            actions: { util: { entry: "" } },
          },
          actions: { util: transitiveAction },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
    });

    // 设置仅 pkg.root 为根公开包，pkg.transitive 作为间接依赖对根不可见并重建图
    (host as any).hostPublicPackageIds = new Set(["pkg.root"]);
    (host as any).rebuildGraphAndCatalog();

    const res = await host.runAction("pkg.transitive/util", {});
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe(UNDECLARED_ACTION_DEPENDENCY);
      expect(res.error.message).toContain("not declared as a direct dependency");
    }

    await host.close();
  });

  it("契约 4：ActionRunner 封闭跨包逃逸口，绝不跨包解析与执行 Action", async () => {
    const storage = new SqliteRuntimeStorage({ packageId: "pkg.isolated", dbPath: ":memory:" });
    const localAction = defineAction({
      run: () => ({ local: true }),
    });

    const runner = new ActionRunner({
      identity: createPackageIdentity({ id: "pkg.isolated" }),
      storage,
      actions: new Map([["local-task", localAction]]),
      actionResolver: async (actionId: string) => {
        if (actionId === "dynamic-local") {
          return defineAction({ run: () => ({ dynamic: true }) });
        }
        return undefined;
      },
    });

    // 1. 本地动作执行正常
    const localRes = await runner.execute("local-task", {});
    expect(localRes.ok).toBe(true);

    // 2. 本地动态动作执行正常
    const dynamicRes = await runner.execute("dynamic-local", {});
    expect(dynamicRes.ok).toBe(true);

    // 3. 跨包字符串引用直接拒绝
    const crossStrRes = await runner.execute("pkg.other/some-action", {});
    expect(crossStrRes.ok).toBe(false);
    if (!crossStrRes.ok) {
      expect(crossStrRes.error.code).toBe("ACTION_NOT_FOUND");
      expect((crossStrRes.error.details as any)?.reason).toContain("cannot be resolved by ActionRunner");
    }

    // 4. 跨包 ActionRef 对象直接拒绝
    const crossObjRes = await runner.execute({ packageId: "pkg.other", actionId: "some-action" }, {});
    expect(crossObjRes.ok).toBe(false);
    if (!crossObjRes.ok) {
      expect(crossObjRes.error.code).toBe("ACTION_NOT_FOUND");
      expect((crossObjRes.error.details as any)?.reason).toContain("cannot be resolved by ActionRunner");
    }
  });

  it("契约 5：缺失 actionInvoker 时嵌套调用抛出 INVOCATION_UNSUPPORTED", async () => {
    const storage = new SqliteRuntimeStorage({ packageId: "pkg.no-invoker", dbPath: ":memory:" });

    const parentAction = defineAction({
      run: async (_input, ctx: ActionContext) => {
        // 未注入 Host actionInvoker 时尝试发起嵌套调用
        return await ctx.actions.invoke("child-action", {});
      },
    });

    const childAction = defineAction({
      run: () => ({ childOk: true }),
    });

    const runner = new ActionRunner({
      identity: createPackageIdentity({ id: "pkg.no-invoker" }),
      storage,
      actions: new Map([
        ["parent-action", parentAction],
        ["child-action", childAction],
      ]),
    });

    const res = await runner.execute("parent-action", {});
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe(INVOCATION_UNSUPPORTED);
      expect(res.error.message).toContain("Nested action invocation requires a Host ActionInvoker");
    }
  });

  it("契约 6：同包嵌套调用（A/foo -> A/bar）统一经由 Host 的 ActionInvoker 执行", async () => {
    let invokerIntercepted = false;

    const barAction = defineAction({
      run: (input: { val: number }) => ({ result: input.val * 2 }),
    });

    const fooAction = defineAction({
      run: async (input: { num: number }, ctx: ActionContext) => {
        // 同包嵌套调用（通过短名或完整名）
        const childRes = await ctx.actions.invoke<any, { result: number }>("bar", { val: input.num });
        return { fromFoo: childRes.result };
      },
    });

    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: {
            id: "pkg.same-package",
            name: "同包互调包",
            version: "1.0.0",
            actions: {
              foo: { entry: "" },
              bar: { entry: "" },
            },
          },
          actions: {
            foo: fooAction,
            bar: barAction,
          },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
    });

    const runtime = host.getRuntime("pkg.same-package")!;
    const origInvoker = (runtime.executionService as any).actionInvoker;
    (runtime.executionService as any).setActionInvoker(async (childAction: any, childInput: any, context: any) => {
      invokerIntercepted = true;
      return origInvoker(childAction, childInput, context);
    });

    const res = await host.runAction("pkg.same-package/foo", { num: 21 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual({ fromFoo: 42 });
    }
    // 严格断言同包调用切实经过了 Host ActionInvoker
    expect(invokerIntercepted).toBe(true);

    await host.close();
  });

  it("契约 7：目标包 ExecutionService 实例在 Host 生命周期内保持唯一单例", async () => {
    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: {
            id: "pkg.singleton-exec",
            actions: { test: { entry: "" } },
          },
          actions: { test: defineAction({ run: () => "ok" }) },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
    });

    const runtime = host.getRuntime("pkg.singleton-exec")!;
    const execServiceFirst = runtime.executionService;

    // 执行一次动作
    await host.runAction("pkg.singleton-exec/test", {});

    const execServiceSecond = runtime.executionService;
    // 实例必须绝对同一
    expect(execServiceFirst).toBe(execServiceSecond);

    // 再次执行动作
    await host.runAction("pkg.singleton-exec/test", {});
    const execServiceThird = runtime.executionService;
    expect(execServiceFirst).toBe(execServiceThird);

    await host.close();
  });

  it("契约 8：PackageIdentity 在 Runtime、ExecutionService、Runner 之间保持同一实例引用", async () => {
    const customIdentity = createPackageIdentity({
      id: "pkg.identity-check",
      instanceId: "inst-xyz-99",
      generation: "gen-2026-v1",
    });

    const runtime = await createPackageRuntime({
      identity: customIdentity,
      projectConfig: {
        id: "pkg.identity-check",
        actions: { ping: { entry: "" } },
      },
      actions: [{ id: "ping", action: defineAction({ run: () => "pong" }) }],
      inMemory: true,
    });

    // 校验 Runtime 与 ExecutionService 共享同一 PackageIdentity 引用
    expect(runtime.identity).toBe(customIdentity);
    expect(runtime.executionService.identity).toBe(customIdentity);

    // 校验 Runner 内部持有的 identity 与传入的实例绝对同一
    const runner = (runtime.executionService as any).runner;
    expect(runner.identity).toBe(customIdentity);
    expect(runner.packageId).toBe("pkg.identity-check");
    expect(runner.packageInstanceId).toBe("inst-xyz-99");
    expect(runner.generationId).toBe("gen-2026-v1");

    await runtime.close();
  });
});
