import { mkdtempSync, rmSync } from "node:fs";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { defineAction, type ActionContext } from "@actiondock/sdk";
import { createActionDockHost } from "../src/host/host";
import { createPackageRuntime, DefaultPackageRuntime } from "../src/package/runtime";
import { DefaultExecutionService as ActionRunner } from "../src/execution/service";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import { createPackageIdentity } from "../src/runtime/identity";
import { IDEMPOTENCY_CONFLICT, INVOCATION_UNSUPPORTED, UNDECLARED_ACTION_DEPENDENCY } from "../src/errors";
import { createActionDock } from "../src/service/factory";
import type { RunOptions } from "../src/service/types";
import { createNodePlatform } from "../src/platform";
import { createGlobalStorage } from "../src/storage";
import { DataDirLock } from "../src/storage/data-dir-lock";

describe("架构核心契约测试：信任边界与局部执行规范", () => {
  it("契约 1：Public RunOptions 类型收窄且边界显式挑选受信任字段", async () => {
    // 静态校验：RunOptions 仅暴露普通调用控制字段
    const validOptions: RunOptions = {
      signal: new AbortController().signal,
      timeoutMs: 5000,
      config: { env: "prod" },
      requestId: "req-123",
    };
    assert.strictEqual(validOptions.timeoutMs, 5000);

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

    const service = host;

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
    assert.strictEqual(res.ok, true);
    if (res.ok) {
      // 内部生成的 runId 绝非外部注入的伪造 ID
      assert.notStrictEqual(res.runId, "injected-run-id");
      const record = await service.runs.get(res.runId);
      assert.notStrictEqual(record, undefined);
      assert.notStrictEqual(record?.rootRunId, "injected-root-id");
      assert.strictEqual(record?.parentRunId, undefined);
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
    assert.strictEqual(bypassAttempt.ok, false);
    if (!bypassAttempt.ok) {
      assert.strictEqual(bypassAttempt.error.code, UNDECLARED_ACTION_DEPENDENCY);
      assert.ok((bypassAttempt.error.message).includes("not allowed: package 'pkg.private-lib' is not declared as a direct dependency"));
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
    assert.strictEqual(res.ok, false);
    if (!res.ok) {
      assert.strictEqual(res.error.code, UNDECLARED_ACTION_DEPENDENCY);
      assert.ok((res.error.message).includes("not declared as a direct dependency"));
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
    assert.strictEqual(localRes.ok, true);

    // 2. 本地动态动作执行正常
    const dynamicRes = await runner.execute("dynamic-local", {});
    assert.strictEqual(dynamicRes.ok, true);

    // 3. 跨包字符串引用直接拒绝
    const crossStrRes = await runner.execute("pkg.other/some-action", {});
    assert.strictEqual(crossStrRes.ok, false);
    if (!crossStrRes.ok) {
      assert.strictEqual(crossStrRes.error.code, "ACTION_NOT_FOUND");
      assert.ok(((crossStrRes.error.details as any)?.reason).includes("cannot be resolved by ActionRunner"));
    }

    // 4. 跨包 ActionRef 对象直接拒绝
    const crossObjRes = await runner.execute({ packageId: "pkg.other", actionId: "some-action" }, {});
    assert.strictEqual(crossObjRes.ok, false);
    if (!crossObjRes.ok) {
      assert.strictEqual(crossObjRes.error.code, "ACTION_NOT_FOUND");
      assert.ok(((crossObjRes.error.details as any)?.reason).includes("cannot be resolved by ActionRunner"));
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
    assert.strictEqual(res.ok, false);
    if (!res.ok) {
      assert.strictEqual(res.error.code, INVOCATION_UNSUPPORTED);
      assert.ok((res.error.message).includes("Nested action invocation requires a Host ActionInvoker"));
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
    // 延迟装配下执行服务按需创建：先触发一次执行确保服务存在，再取内部委托验证同包调用路由
    const warmup = await host.runAction("pkg.same-package/bar", { val: 1 });
    assert.strictEqual(warmup.ok, true);
    const execService = (runtime as any).peekExecutionService?.() ?? (runtime as any).executionService;
    const origInvoker = (execService as any).actionInvoker;
    (execService as any).setActionInvoker(async (childAction: any, childInput: any, context: any) => {
      invokerIntercepted = true;
      return origInvoker(childAction, childInput, context);
    });

    const res = await host.runAction("pkg.same-package/foo", { num: 21 });
    assert.strictEqual(res.ok, true);
    if (res.ok) {
      assert.deepStrictEqual(res.data, { fromFoo: 42 });
    }
    // 严格断言同包调用切实经过了 Host ActionInvoker
    assert.strictEqual(invokerIntercepted, true);

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
    // 延迟装配下执行服务按需创建：执行前不存在属预期，首次执行后必须存在且唯一
    await host.runAction("pkg.singleton-exec/test", {});
    const execServiceFirst = (runtime as any).peekExecutionService?.() ?? (runtime as any).executionService;
    assert.notStrictEqual(execServiceFirst, undefined);

    // 再次执行动作
    await host.runAction("pkg.singleton-exec/test", {});

    const execServiceSecond = (runtime as any).peekExecutionService?.() ?? (runtime as any).executionService;
    // 实例必须绝对同一
    assert.strictEqual(execServiceFirst, execServiceSecond);

    // 再次执行动作
    await host.runAction("pkg.singleton-exec/test", {});
    const execServiceThird = (runtime as any).peekExecutionService?.() ?? (runtime as any).executionService;
    assert.strictEqual(execServiceSecond, execServiceThird);

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
    } as any);

    // 校验 Runtime 与 ExecutionService 共享同一 PackageIdentity 引用
    assert.strictEqual(runtime.identity, customIdentity);
    await runtime.runAction("ping", {});
    const execService = (runtime as any).peekExecutionService?.() ?? (runtime as any).executionService;
    assert.strictEqual(execService.identity, customIdentity);

    // 校验 Runner 内部持有的 identity 与传入的实例绝对同一
    const runner = (execService as any)._runner;
    assert.strictEqual(runner.identity, customIdentity);
    assert.strictEqual(runner.packageId, "pkg.identity-check");
    assert.strictEqual(runner.packageInstanceId, "inst-xyz-99");
    assert.strictEqual(runner.generationId, "gen-2026-v1");

    await runtime.close();
  });

  it("契约 9：createActionDock({ runtimeOptions }) 在 service.close() 时自动关闭内部 Runtime", async () => {
    const service = await createActionDock({
      runtimeOptions: {
        projectConfig: {
          id: "pkg.lifecycle-contract",
          actions: { ping: { entry: "" } },
        },
        actions: [{ id: "ping", action: defineAction({ run: () => "pong" }) }],
        inMemory: true,
      },
    });

    const host = (service as any).host;
    const runtime = host.getRuntime("pkg.lifecycle-contract")!;
    assert.notStrictEqual(runtime, undefined);
    assert.strictEqual((runtime as any).isClosed, false);

    // 服务正常调用
    const res = await service.execution.run("pkg.lifecycle-contract/ping", {});
    assert.strictEqual(res.ok, true);

    // 关闭服务，内部 Runtime 随 Host 级联关闭
    await service.close();
    assert.strictEqual((runtime as any).isClosed, true);

    // 关闭后再次执行被拒绝
    await assert.rejects(service.execution.run("pkg.lifecycle-contract/ping", {}));
  });

  it("契约 10：inMemory: true 模式下 Host 与 Runtime 共享同一个 GlobalStorage（Host 写入全局配置，Runtime 可立即读到）", async () => {
    const service = await createActionDock({
      runtimeOptions: {
        projectConfig: {
          id: "pkg.shared-global",
          actions: {
            readGlobal: { entry: "" },
          },
        },
        actions: [{
          id: "readGlobal",
          action: defineAction({
            run: async (_input: unknown, ctx: ActionContext) => {
              return {
                globalSetting: ctx.config.get("company_name"),
              };
            },
          }),
        }],
        inMemory: true,
      },
    });

    const host = (service as any).host;
    const runtime = host.getRuntime("pkg.shared-global")!;
    assert.notStrictEqual(runtime, undefined);

    // 校验 Host 与 Runtime 共享同一 GlobalStorage 内存实例（延迟装配下首次准备后固定）
    await service.management!.config.set("global", "company_name", "AcmeCorp");
    const hostGlobalStorage = (host as any).globalStorage;
    assert.notStrictEqual(hostGlobalStorage, undefined);
    // 触发 Runtime 侧全局库准备（执行），验证共享同一实例
    const res = await host.runAction("pkg.shared-global/readGlobal", {});
    assert.strictEqual(res.ok, true);
    assert.strictEqual(
      (runtime as any).globalStorageRes?.storage ?? (runtime as any).globalStorage,
      hostGlobalStorage
    );

    // Runtime 可立即通过 globalStorage 读取
    assert.strictEqual(
      ((runtime as any).globalStorageRes?.storage ?? (runtime as any).globalStorage)?.getConfig("company_name"),
      "AcmeCorp"
    );

    // Action 运行期间通过 ctx.config 读取全局配置
    if (res.ok) {
      assert.strictEqual((res.data as any).globalSetting, "AcmeCorp");
    }

    await service.close();
  });

  it("契约 11：Host.close() 时共享的全局存储严格在所有内部 Runtime 关闭之后再关闭", async () => {
    let globalStorageAccessibleDuringRuntimeClose = false;
    let globalConfigValueDuringRuntimeClose: unknown;

    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: {
            id: "pkg.close-order-test",
            actions: { test: { entry: "" } },
          },
          actions: [{ id: "test", action: defineAction({ run: () => "ok" }) }],
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
      inMemory: true,
    });

    await host.setConfig("global", "close_phase_key", "still_alive");

    const runtime = host.getRuntime("pkg.close-order-test")!;
    assert.notStrictEqual(runtime, undefined);
    // 确保包侧全局库引用已准备（持有者预热仅打开包库）
    await host.getConfig("pkg.close-order-test", "noop_key_missing");

    // 劫持 runtime.close，验证在 runtime 关闭期间 globalStorage 依然存活可用
    const originalClose = runtime.close.bind(runtime);
    runtime.close = async (options?: { graceMs?: number }) => {
      try {
        const gs = (runtime as any).globalStorageRes?.storage ?? (runtime as any).globalStorage;
        const val = gs?.getConfig("close_phase_key");
        globalConfigValueDuringRuntimeClose = val;
        globalStorageAccessibleDuringRuntimeClose = val === "still_alive";
      } catch {
        globalStorageAccessibleDuringRuntimeClose = false;
      }
      return originalClose(options);
    };

    await host.close();

    // 验证 Runtime 关闭时全局存储依然处于存活且可访问状态
    assert.strictEqual(globalStorageAccessibleDuringRuntimeClose, true);
    assert.strictEqual(globalConfigValueDuringRuntimeClose, "still_alive");
    // Host 关闭完成之后，全局存储已被清理
    assert.strictEqual((host as any).globalStorage, undefined);
  });

  it("契约 12：精确调用深度控制：maxCallDepth = 3 时三层调用全部成功执行，发起第四层调用时精确拒绝", async () => {
    const entered: string[] = [];

    const actionA = defineAction({
      run: async (_input, ctx) => {
        entered.push("A");
        return ctx.actions.invoke("pkg.depth/stepB", {});
      },
    });

    const actionB = defineAction({
      run: async (_input, ctx) => {
        entered.push("B");
        return ctx.actions.invoke("pkg.depth/stepC", {});
      },
    });

    const actionC = defineAction({
      run: async (_input, ctx) => {
        entered.push("C");
        return ctx.actions.invoke("pkg.depth/stepD", {});
      },
    });

    const actionD = defineAction({
      run: async () => {
        entered.push("D");
        return { done: true };
      },
    });

    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: {
            id: "pkg.depth",
            actions: {
              stepA: { entry: "" },
              stepB: { entry: "" },
              stepC: { entry: "" },
              stepD: { entry: "" },
            },
          },
          actions: {
            stepA: actionA,
            stepB: actionB,
            stepC: actionC,
            stepD: actionD,
          },
          inMemory: true,
        },
      ],
      maxCallDepth: 3,
      autoLoadCurrentProject: false,
    });

    const res = await host.runAction("pkg.depth/stepA", {});
    assert.strictEqual(res.ok, false);
    if (!res.ok) {
      assert.strictEqual(res.error.code, "ACTION_CALL_CYCLE");
      assert.ok((res.error.message).includes("Maximum call depth of 3 exceeded"));
    }

    // 核心契约断言：A -> B -> C 全部成功进入并执行，第四层 D 被精确拦截未进入
    assert.deepStrictEqual(entered, ["A", "B", "C"]);

    await host.close();
  });

  it("契约 13：Host 初始化失败回滚契约：初始化异常时已创建的内部 Runtime、全局存储与数据目录锁必须完整异步回滚释放", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "actiondock-host-rollback-"));
    let mockStorageClosed = false;
    let globalStorageCreated: any;
    let globalStorageClosed = false;

    const mockStorage = new SqliteRuntimeStorage({
      packageId: "pkg.first",
      dbPath: ":memory:",
    });
    const origClose = mockStorage.close.bind(mockStorage);
    mockStorage.close = async () => {
      mockStorageClosed = true;
      await origClose();
    };

    const customPlatform = {
      ...createNodePlatform(),
      storage: {
        ...createNodePlatform().storage,
        createGlobalStorage: (opts: any) => {
          const gs = createGlobalStorage({ ...opts, inMemory: true });
          globalStorageCreated = gs;
          const origGsClose = gs.close.bind(gs);
          gs.close = () => {
            globalStorageClosed = true;
            return origGsClose();
          };
          return gs;
        },
      },
    };

    try {
      // 制造第二个 package ID 冲突，触发 Host 初始化失败
      await assert.rejects(
        createActionDockHost({
          dataDir: tempDir,
          platform: customPlatform,
          packages: [
            {
              projectConfig: {
                id: "pkg.conflict",
                actions: { test: { entry: "" } },
              },
              actions: { test: defineAction({ run: () => "ok" }) },
              storage: mockStorage,
            } as any,
            {
              projectConfig: {
                id: "pkg.conflict",
                actions: { test2: { entry: "" } },
              },
              actions: { test2: defineAction({ run: () => "conflict" }) },
            },
          ],
          autoLoadCurrentProject: false,
        })
      , /Package ID conflict/);

      // 断言 1：已创建的内部 Runtime 存储已被真正 close
      assert.strictEqual(mockStorageClosed, true);

      // 断言 2：全局存储已被真正 close
      // （延迟装配下全局库不在注册阶段打开，初始化失败回滚时若已创建则必须关闭；
      //   本场景冲突发生在注册阶段，全局库从未被求值，关闭次数为零属预期）
      assert.strictEqual(globalStorageClosed, globalStorageCreated ? true : false);

      // 断言 3：数据目录排他锁已被安全释放，后续能够重新成功获取锁
      const subsequentLock = DataDirLock.acquire(tempDir, { hostSessionId: "subsequent-session" });
      assert.notStrictEqual(subsequentLock, undefined);
      subsequentLock.release();
    } finally {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("契约 14：PackageRuntime 信任边界纯化：仅接受 RunOptions，绝不盲目信任传入的伪造内部血缘与调用栈", async () => {
    const action = defineAction({
      run: async (_input, ctx) => {
        return {
          runId: ctx.run.id,
          rootRunId: ctx.run.rootId,
          hasParent: ctx.run.parentId !== undefined,
        };
      },
    });

    const runtime = new DefaultPackageRuntime({
      projectConfig: {
        id: "pkg.boundary-test",
        actions: { ping: { entry: "" } },
      },
      actions: { ping: action },
      inMemory: true,
    });

    // 外部恶意伪造内部 InvocationContext 字段注入公共入口
    const forgedOptions = {
      runId: "forged-run-id",
      rootRunId: "forged-root-id",
      parentRunId: "forged-parent-id",
      callStack: ["evil.pkg/injectedAction"],
      owner: { tenantId: "evil-tenant" },
      package: { id: "evil-package", instanceId: "inst", generation: "gen" },
    };

    const res = await runtime.runAction("ping", {}, forgedOptions as any);
    assert.strictEqual(res.ok, true);
    if (res.ok) {
      const data = res.data as any;
      // 内部 runId/rootRunId 绝非外部伪造的 ID
      assert.notStrictEqual(data.runId, "forged-run-id");
      assert.notStrictEqual(data.rootRunId, "forged-root-id");
      assert.strictEqual(data.hasParent, false);

      // 查询持久化记录验证调用栈与血缘未被篡改
      const record = await runtime.getRun(res.runId);
      assert.notStrictEqual(record, undefined);
      assert.notStrictEqual(record?.rootRunId, "forged-root-id");
      assert.strictEqual(record?.parentRunId, undefined);
    }

    await runtime.close();
  });

  it("契约 15：跨包嵌套调用与直接根调用统一经由目标包唯一 ExecutionService 与 ActionRunner 处理，activeRuns、events、cancel 与 idempotency 契约严格闭环不分裂", async () => {
    let slowActionRunning = false;
    let slowActionCancelled = false;

    const workerAction = defineAction({
      run: async (input: any, ctx: ActionContext) => {
        return {
          received: input,
          runId: ctx.run.id,
          rootId: ctx.run.rootId,
          parentId: ctx.run.parentId ?? null,
        };
      },
    });

    const slowAction = defineAction({
      run: async (_input: any, ctx: ActionContext) => {
        slowActionRunning = true;
        ctx.log.info("slowAction in-flight");
        await new Promise<void>((resolve, reject) => {
          if (ctx.signal.aborted) {
            slowActionCancelled = true;
            return reject(ctx.signal.reason || new Error("Cancelled"));
          }
          const onAbort = () => {
            slowActionCancelled = true;
            reject(ctx.signal.reason || new Error("Cancelled"));
          };
          ctx.signal.addEventListener("abort", onAbort, { once: true });
        });
        return { done: true };
      },
    });

    const idempotentAction = defineAction({
      run: async (input: any) => {
        return { value: input, processed: true };
      },
    });

    const callerAction = defineAction({
      uses: [
        "pkg.target-b/worker",
        "pkg.target-b/slow",
        "pkg.target-b/idempotent",
      ],
      run: async (input: any, ctx: ActionContext) => {
        const target = input.target || "pkg.target-b/worker";
        return await ctx.actions.invoke(target, input.payload ?? input);
      },
    });

    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: {
            id: "pkg.caller-a",
            name: "Caller Package A",
            version: "1.0.0",
            actions: {
              caller: {
                entry: "",
                uses: [
                  "pkg.target-b/worker",
                  "pkg.target-b/slow",
                  "pkg.target-b/idempotent",
                ],
              },
            },
          },
          actions: { caller: callerAction },
          inMemory: true,
        },
        {
          projectConfig: {
            id: "pkg.target-b",
            name: "Target Package B",
            version: "1.0.0",
            actions: {
              worker: { entry: "" },
              slow: { entry: "" },
              idempotent: { entry: "" },
            },
          },
          actions: {
            worker: workerAction,
            slow: slowAction,
            idempotent: idempotentAction,
          },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
    });

    const runtimeA = host.getRuntime("pkg.caller-a")!;
    const runtimeB = host.getRuntime("pkg.target-b")!;
    assert.notStrictEqual(runtimeA, undefined);
    assert.notStrictEqual(runtimeB, undefined);

    // 延迟装配下先触发一次执行确保目标包执行服务存在
    const warmupRun = await host.runAction("pkg.target-b/worker", { msg: "warmup" });
    assert.strictEqual(warmupRun.ok, true);
    const execServiceB = (runtimeB as any).peekExecutionService?.() ?? (runtimeB as any).executionService;
    const runnerB = (execServiceB as any)._runner;
    assert.notStrictEqual(execServiceB, undefined);
    assert.notStrictEqual(runnerB, undefined);

    // 1. 验证直接根调用 B 与 A->B 跨包嵌套调用均由 B 的同一个 ExecutionService 与同一个 ActionRunner 执行
    const directRes = await host.runAction("pkg.target-b/worker", { msg: "from-root" });
    assert.strictEqual(directRes.ok, true);
    const directData = (directRes as any).data;
    assert.deepStrictEqual(directData.received, { msg: "from-root" });
    assert.strictEqual(directData.parentId, null);
    assert.strictEqual(directData.rootId, directData.runId);

    const nestedRes = await host.runAction("pkg.caller-a/caller", {
      target: "pkg.target-b/worker",
      payload: { msg: "from-nested" },
    });
    assert.strictEqual(nestedRes.ok, true);
    const nestedData = (nestedRes as any).data;
    assert.deepStrictEqual(nestedData.received, { msg: "from-nested" });
    assert.notStrictEqual(nestedData.parentId, undefined);
    assert.notStrictEqual(nestedData.parentId, null);
    assert.notStrictEqual(nestedData.rootId, nestedData.runId);

    // 持久化记录验证：两个运行都准确记录在 Package B 的存储中，血缘完整
    const directRecord = await runtimeB.getRun(directData.runId);
    assert.notStrictEqual(directRecord, undefined);
    assert.strictEqual(directRecord?.packageId, "pkg.target-b");
    assert.strictEqual(directRecord?.actionId, "worker");

    const nestedRecord = await runtimeB.getRun(nestedData.runId);
    assert.notStrictEqual(nestedRecord, undefined);
    assert.strictEqual(nestedRecord?.packageId, "pkg.target-b");
    assert.strictEqual(nestedRecord?.actionId, "worker");
    assert.strictEqual(nestedRecord?.parentRunId, nestedData.parentId);

    // 2. 验证 activeRuns 与 cancel 在根调用与跨包嵌套调用中均在 B 的 ExecutionService 统一跟踪
    // (a) 根调用 B 异步任务取消
    slowActionRunning = false;
    slowActionCancelled = false;
    const slowDirectTicket = await host.startAction("pkg.target-b/slow", {});
    assert.notStrictEqual(slowDirectTicket.runId, undefined);
    while (!slowActionRunning) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok((execServiceB.activeRunsCount) >= 1);

    const cancelDirectRes = await host.cancelRun(slowDirectTicket.runId, "direct cancel");
    assert.strictEqual(cancelDirectRes.outcome, "requested");
    const directSlowOutcome = await slowDirectTicket.result!;
    assert.strictEqual(directSlowOutcome.ok, false);
    assert.strictEqual(slowActionCancelled, true);
    while (execServiceB.activeRunsCount > 0) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.strictEqual(execServiceB.activeRunsCount, 0);

    // (b) A->B 跨包嵌套调用任务取消
    slowActionRunning = false;
    slowActionCancelled = false;
    const slowNestedTicket = await host.startAction("pkg.caller-a/caller", {
      target: "pkg.target-b/slow",
      payload: {},
    });
    assert.notStrictEqual(slowNestedTicket.runId, undefined);
    while (!slowActionRunning) {
      await new Promise((r) => setTimeout(r, 10));
    }
    // B 的 executionService 正确跟踪到由嵌套调用派发的活跃运行
    assert.ok((execServiceB.activeRunsCount) >= 1);

    const cancelNestedRes = await host.cancelRun(slowNestedTicket.runId, "nested cancel");
    assert.strictEqual(cancelNestedRes.outcome, "requested");
    const nestedSlowOutcome = await slowNestedTicket.result!;
    assert.strictEqual(nestedSlowOutcome.ok, false);
    assert.strictEqual(slowActionCancelled, true);
    while (execServiceB.activeRunsCount > 0) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.strictEqual(execServiceB.activeRunsCount, 0);

    // 3. 验证 events 在根调用与跨包嵌套调用中均能准确收录
    const eventsReceived: any[] = [];
    const eventRunTicket = await host.startAction("pkg.target-b/worker", { msg: "event-test" });
    for await (const evt of host.events(eventRunTicket.runId)) {
      eventsReceived.push(evt);
      if (evt.type === "finish") break;
    }
    assert.strictEqual(eventsReceived.some((e) => e.type === "status"), true);
    assert.strictEqual(eventsReceived.some((e) => e.type === "finish"), true);

    // 4. 验证 idempotency (requestId) 在根调用与跨包嵌套调用中表现完全一致
    // (a) 根调用幂等生效
    const directIdem1 = await host.runAction("pkg.target-b/idempotent", { key: "idem-a" }, { requestId: "req-direct-1" });
    assert.strictEqual(directIdem1.ok, true);
    const directIdem2 = await host.runAction("pkg.target-b/idempotent", { key: "idem-a" }, { requestId: "req-direct-1" });
    assert.strictEqual(directIdem2.ok, true);
    assert.strictEqual(directIdem1.runId, directIdem2.runId);

    // (b) 根调用幂等参数冲突拦截
    let directConflictError: any;
    try {
      await host.runAction("pkg.target-b/idempotent", { key: "idem-different" }, { requestId: "req-direct-1" });
    } catch (err: any) {
      directConflictError = err;
    }
    assert.notStrictEqual(directConflictError, undefined);
    assert.strictEqual(directConflictError.code, IDEMPOTENCY_CONFLICT);

    // (c) 嵌套调用幂等生效
    const nestedIdem1 = await host.runAction("pkg.caller-a/caller", {
      target: "pkg.target-b/idempotent",
      payload: { key: "idem-b" },
    }, { requestId: "req-nested-1" });
    assert.strictEqual(nestedIdem1.ok, true);

    const nestedIdem2 = await host.runAction("pkg.caller-a/caller", {
      target: "pkg.target-b/idempotent",
      payload: { key: "idem-b" },
    }, { requestId: "req-nested-1" });
    assert.strictEqual(nestedIdem2.ok, true);
    assert.strictEqual(nestedIdem1.runId, nestedIdem2.runId);

    // (d) 嵌套调用幂等参数冲突拦截
    let nestedConflictError: any;
    try {
      await host.runAction("pkg.caller-a/caller", {
        target: "pkg.target-b/idempotent",
        payload: { key: "idem-conflict" },
      }, { requestId: "req-nested-1" });
    } catch (err: any) {
      nestedConflictError = err;
    }
    assert.notStrictEqual(nestedConflictError, undefined);
    assert.strictEqual(nestedConflictError.code, IDEMPOTENCY_CONFLICT);

    await host.close();
  });
});
