import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineAction, type ActionContext } from "@actiondock/sdk";
import { createActionDockHost as createHost, type ActionDockHost } from "../src/host";
import { createActionDock as createService } from "../src/service/factory";
import { addProfile } from "../src/profile/manager";
import { startActionDockServer, type ActionDockServerInstance } from "../src/server";
import {
  ActionDockError,
  ACTION_CALL_CYCLE,
  ACTION_CANCELLED,
  ACTION_TIMEOUT,
  DEPENDENCY_INSTALL_FAILED,
  EXECUTION_FAILED,
  IDEMPOTENCY_CONFLICT,
  PACKAGE_NOT_FOUND,
  SERVICE_CLOSED,
  UNDECLARED_ACTION_DEPENDENCY,
} from "../src/errors";
import type { LocalPackagePreparationContext, LocalPackagePreparationTarget } from "../src/invocation/types";

describe("Host 本地包运行前准备生命周期测试 (host-package-preparation)", () => {
  let tempDir: string;
  let activeHost: ActionDockHost | undefined;

  function createActionDockHost(options: Parameters<typeof createHost>[0] = {}) {
    return createHost({ ...options, inMemory: true, customHome: join(tempDir, "home") });
  }

  function createActionDock(options: Parameters<typeof createService>[0] = {}) {
    return createService({ ...options, inMemory: true, customHome: join(tempDir, "home") });
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-host-prep-test-"));
  });

  afterEach(async () => {
    if (activeHost) {
      try {
        await activeHost.close();
      } catch {}
      activeHost = undefined;
    }
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createDummyPackageDir(name: string): string {
    const dir = join(tempDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name, version: "1.0.0" })
    );
    return dir;
  }

  it("A -> B -> C 独立本地包调用链路，准备在各自 handler 执行前统一触发且主子同一 hook", async () => {
    const dirA = createDummyPackageDir("pkg-a");
    const dirB = createDummyPackageDir("pkg-b");
    const dirC = createDummyPackageDir("pkg-c");

    const events: string[] = [];
    const preparedPackages: string[] = [];

    const prepareHook = async (
      target: LocalPackagePreparationTarget,
      _context: LocalPackagePreparationContext
    ) => {
      events.push(`prepare:${target.identity.id}`);
      preparedPackages.push(target.identity.id);
    };

    activeHost = await createActionDockHost({
      prepareLocalPackage: prepareHook,
      packages: [
        {
          packageRoot: dirA,
          projectConfig: {
            id: "pkg.a",
            name: "Package A",
            version: "1.0.0",
            actions: {
              runA: { entry: "runA.js", uses: ["pkg.b/runB"] },
            },
          },
          actions: {
            runA: defineAction({
              run: async (_input: unknown, ctx: ActionContext) => {
                events.push("exec:pkg.a/runA");
                const resB = await ctx.actions.invoke("pkg.b/runB", {});
                return { fromA: true, resB };
              },
            }),
          },
        },
        {
          packageRoot: dirB,
          projectConfig: {
            id: "pkg.b",
            name: "Package B",
            version: "1.0.0",
            actions: {
              runB: { entry: "runB.js", uses: ["pkg.c/runC"] },
            },
          },
          actions: {
            runB: defineAction({
              run: async (_input: unknown, ctx: ActionContext) => {
                events.push("exec:pkg.b/runB");
                const resC = await ctx.actions.invoke("pkg.c/runC", {});
                return { fromB: true, resC };
              },
            }),
          },
        },
        {
          packageRoot: dirC,
          projectConfig: {
            id: "pkg.c",
            name: "Package C",
            version: "1.0.0",
            actions: {
              runC: { entry: "runC.js" },
            },
          },
          actions: {
            runC: defineAction({
              run: async () => {
                events.push("exec:pkg.c/runC");
                return { fromC: true };
              },
            }),
          },
        },
      ],
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
    });

    const result = await activeHost.runAction("pkg.a/runA", {});
    assert.strictEqual(result.ok, true);

    // 验证时序：准备必须严格发生在对应 handler 执行前
    assert.deepStrictEqual(events, [
      "prepare:pkg.a",
      "exec:pkg.a/runA",
      "prepare:pkg.b",
      "exec:pkg.b/runB",
      "prepare:pkg.c",
      "exec:pkg.c/runC",
    ]);
  });

  it("未注入 prepareLocalPackage 时默认行为完全不变 (SDK/serve 默认模式)", async () => {
    const dirA = createDummyPackageDir("pkg-default");

    activeHost = await createActionDockHost({
      packages: [
        {
          packageRoot: dirA,
          projectConfig: { id: "pkg.default", name: "Default", version: "1.0.0" },
          actions: [
            {
              id: "ping",
              action: defineAction({
                run: async () => ({ pong: true }),
              }),
            },
          ],
        },
      ],
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
    });

    const result = await activeHost.runAction("pkg.default/ping", {});
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.deepStrictEqual(result.data, { pong: true });
    }
  });

  it("无 packageRoot 的内存或编程式 runtime 不触发文件准备", async () => {
    let prepareCalled = false;
    activeHost = await createActionDockHost({
      prepareLocalPackage: async () => {
        prepareCalled = true;
      },
      packages: [
        {
          // 无 packageRoot 字段
          projectConfig: { id: "pkg.memory", name: "Memory", version: "1.0.0" },
          actions: [
            {
              id: "act",
              action: defineAction({
                run: async () => ({ memory: true }),
              }),
            },
          ],
        },
      ],
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
    });

    const result = await activeHost.runAction("pkg.memory/act", {});
    assert.strictEqual(result.ok, true);
    assert.strictEqual(prepareCalled, false, "内存 runtime 不应触发文件准备");
  });

  it("未授权依赖、未知目标、环路调用或已取消不触发准备", async () => {
    const dirA = createDummyPackageDir("pkg-guard-a");
    const dirB = createDummyPackageDir("pkg-guard-b");

    const preparedSet = new Set<string>();
    const prepareHook = async (target: LocalPackagePreparationTarget) => {
      preparedSet.add(target.identity.id);
    };

    activeHost = await createActionDockHost({
      prepareLocalPackage: prepareHook,
      maxCallDepth: 16,
      packages: [
        {
          packageRoot: dirA,
          projectConfig: {
            id: "pkg.a",
            name: "A",
            version: "1.0.0",
            actions: {
              undeclared: { entry: "undeclared.js", uses: [] },
              callUnknown: { entry: "callUnknown.js" },
              cycleA: { entry: "cycleA.js", uses: ["pkg.b/cycleB"] },
            },
          },
          actions: {
            undeclared: defineAction({
              run: async (_input: unknown, ctx: ActionContext) => {
                return ctx.actions.invoke("pkg.b/actB", {});
              },
            }),
            callUnknown: defineAction({
              run: async (_input: unknown, ctx: ActionContext) => {
                return ctx.actions.invoke("pkg.unknown/act", {});
              },
            }),
            cycleA: defineAction({
              run: async (_input: unknown, ctx: ActionContext) => {
                return ctx.actions.invoke("pkg.b/cycleB", {});
              },
            }),
          },
        },
        {
          packageRoot: dirB,
          projectConfig: {
            id: "pkg.b",
            name: "B",
            version: "1.0.0",
            actions: {
              actB: { entry: "actB.js" },
              cycleB: { entry: "cycleB.js", uses: ["pkg.a/cycleA"] },
            },
          },
          actions: {
            actB: defineAction({
              run: async () => ({ b: true }),
            }),
            cycleB: defineAction({
              run: async (_input: unknown, ctx: ActionContext) => {
                return ctx.actions.invoke("pkg.a/cycleA", {});
              },
            }),
          },
        },
      ],
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
    });

    // 1. 未声明依赖：B 不得被准备
    preparedSet.clear();
    const res1 = await activeHost.runAction("pkg.a/undeclared", {});
    assert.strictEqual(res1.ok, false);
    if (!res1.ok) {
      assert.strictEqual(res1.error.code, UNDECLARED_ACTION_DEPENDENCY);
    }
    assert.strictEqual(preparedSet.has("pkg.b"), false, "未声明 uses 时 B 不得被准备");

    // 2. 未知目标：不触发未知包的准备
    preparedSet.clear();
    const res2 = await activeHost.runAction("pkg.unknown/any", {});
    assert.strictEqual(res2.ok, false);
    if (!res2.ok) {
      assert.strictEqual(res2.error.code, PACKAGE_NOT_FOUND);
    }
    assert.strictEqual(preparedSet.has("pkg.unknown"), false);

    // 3. 环路调用：超出深度被阻断，环路后续不应执行
    preparedSet.clear();
    const res3 = await activeHost.runAction("pkg.a/cycleA", {});
    assert.strictEqual(res3.ok, false);
    if (!res3.ok) {
      assert.strictEqual(res3.error.code, ACTION_CALL_CYCLE);
    }

    // 4. 提前取消信号：不触发准备
    preparedSet.clear();
    const controller = new AbortController();
    controller.abort("pre-cancelled");
    const res4 = await activeHost.runAction("pkg.a/undeclared", {}, { signal: controller.signal });
    assert.strictEqual(res4.ok, false);
    if (!res4.ok) {
      assert.strictEqual(res4.error.code, ACTION_CANCELLED);
    }
    assert.strictEqual(preparedSet.size, 0, "已取消的请求不触发任何准备");
  });

  it("子包 B 准备失败时 A 只执行一次、B 业务未开始，错误透明保留 code、hint 与 phase 上下文", async () => {
    const dirA = createDummyPackageDir("pkg-fail-a");
    const dirB = createDummyPackageDir("pkg-fail-b");

    let aExecCount = 0;
    let bExecCount = 0;

    const prepareHook = async (target: LocalPackagePreparationTarget) => {
      if (target.identity.id === "pkg.b") {
        throw new ActionDockError(
          DEPENDENCY_INSTALL_FAILED,
          "Failed to build dependencies in pkg.b",
          { hint: "Run 'npm install' in pkg.b manually" }
        );
      }
    };

    activeHost = await createActionDockHost({
      prepareLocalPackage: prepareHook,
      packages: [
        {
          packageRoot: dirA,
          projectConfig: {
            id: "pkg.a",
            name: "A",
            version: "1.0.0",
            actions: {
              callB: { entry: "callB.js", uses: ["pkg.b/actionB"] },
            },
          },
          actions: {
            callB: defineAction({
              run: async (_input: unknown, ctx: ActionContext) => {
                aExecCount++;
                return ctx.actions.invoke("pkg.b/actionB", {});
              },
            }),
          },
        },
        {
          packageRoot: dirB,
          projectConfig: {
            id: "pkg.b",
            name: "B",
            version: "1.0.0",
            actions: {
              actionB: { entry: "actionB.js" },
            },
          },
          actions: {
            actionB: defineAction({
              run: async () => {
                bExecCount++;
                return { b: true };
              },
            }),
          },
        },
      ],
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
    });

    const result = await activeHost.runAction("pkg.a/callB", {});
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, DEPENDENCY_INSTALL_FAILED);
      const details = result.error.details as Record<string, unknown>;
      assert.strictEqual(details.package, "pkg.b");
      assert.strictEqual(details.action, "actionB");
      assert.strictEqual(details.phase, "preparation");
      assert.strictEqual(details.hint, "Run 'npm install' in pkg.b manually");
    }

    assert.strictEqual(aExecCount, 1, "A 应当只执行一次且不触发自动重试");
    assert.strictEqual(bExecCount, 0, "B 准备失败时业务代码绝不得开始执行");

    // 验证 B 没有任何业务运行记录被写入
    const runsB = await activeHost.listRuns({ packageId: "pkg.b" });
    assert.strictEqual(runsB.length, 0, "B 不得产生伪业务运行记录");
  });

  it("准备 hook 同步抛出错误时亦能捕获并补充 phase 与目标上下文", async () => {
    const dirSync = createDummyPackageDir("pkg-sync-throw");

    const syncThrowHook = (_target: LocalPackagePreparationTarget): Promise<void> => {
      throw new Error("Synchronous preparation assertion failed");
    };

    activeHost = await createActionDockHost({
      prepareLocalPackage: syncThrowHook,
      packages: [
        {
          packageRoot: dirSync,
          projectConfig: { id: "pkg.sync", name: "Sync Throw", version: "1.0.0" },
          actions: [
            {
              id: "act",
              action: defineAction({
                run: async () => ({ ok: true }),
              }),
            },
          ],
        },
      ],
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
    });

    const result = await activeHost.runAction("pkg.sync/act", {});
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, EXECUTION_FAILED);
      const details = result.error.details as Record<string, unknown>;
      assert.strictEqual(details.phase, "preparation");
      assert.strictEqual(details.package, "pkg.sync");
      assert.strictEqual(details.action, "act");
    }
  });

  it("Host.close 时在途准备被取消并等待清理，并发 close 复用同一 Promise", async () => {
    const dirClose = createDummyPackageDir("pkg-close-prep");

    let prepStartedResolve!: () => void;
    const prepStarted = new Promise<void>((r) => {
      prepStartedResolve = r;
    });

    let finishCleanup!: () => void;
    const cleanupWait = new Promise<void>((r) => {
      finishCleanup = r;
    });

    let cleanedUp = false;

    const slowHook = async (
      _target: LocalPackagePreparationTarget,
      context: LocalPackagePreparationContext
    ) => {
      prepStartedResolve();
      await new Promise<void>((resolve, reject) => {
        context.signal.addEventListener("abort", async () => {
          // 模拟底层清理耗时
          await cleanupWait;
          cleanedUp = true;
          reject(new ActionDockError(ACTION_CANCELLED, "Preparation cancelled by host close"));
        });
      });
    };

    activeHost = await createActionDockHost({
      prepareLocalPackage: slowHook,
      packages: [
        {
          packageRoot: dirClose,
          projectConfig: { id: "pkg.close", name: "Close Test", version: "1.0.0" },
          actions: [
            {
              id: "act",
              action: defineAction({
                run: async () => ({ ok: true }),
              }),
            },
          ],
        },
      ],
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
    });

    // 启动任务触发准备
    const runPromise = activeHost.runAction("pkg.close/act", {});
    await prepStarted;

    // 并发触发两次 close
    const close1 = activeHost.close();
    const close2 = activeHost.close();

    // 此时清理尚未完成，close 不应提前返回
    assert.strictEqual(cleanedUp, false);

    // 放行底层清理
    finishCleanup();

    await Promise.all([close1, close2]);
    assert.strictEqual(cleanedUp, true, "Host.close 必须等待在途准备底层清理完毕");

    const runRes = await runPromise;
    assert.strictEqual(runRes.ok, false);
    if (!runRes.ok) {
      assert.strictEqual(runRes.error.code, ACTION_CANCELLED);
    }

    // 关闭后新任务直接拒绝
    await assert.rejects(activeHost.runAction("pkg.close/act", {}), (err: any) => {
      assert.strictEqual(err.code, SERVICE_CLOSED);
      return true;
    });
  });

  it("createActionDock 工厂函数正确透传 prepareLocalPackage 且尊重 hostOptions 覆盖", async () => {
    let hook1Called = false;
    let hook2Called = false;

    const hook1 = async () => {
      hook1Called = true;
    };
    const hook2 = async () => {
      hook2Called = true;
    };

    const dirFactory = createDummyPackageDir("pkg-factory");

    // hostOptions.prepareLocalPackage 覆盖 top-level options.prepareLocalPackage
    const service = await createActionDock({
      prepareLocalPackage: hook1,
      hostOptions: {
        prepareLocalPackage: hook2,
      },
      packages: [
        {
          packageRoot: dirFactory,
          projectConfig: { id: "pkg.factory", name: "Factory", version: "1.0.0" },
          actions: [
            {
              id: "ping",
              action: defineAction({
                run: async () => ({ factory: true }),
              }),
            },
          ],
        },
      ],
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
    });

    try {
      const res = await service.execution.run("pkg.factory/ping", {});
      assert.strictEqual(res.ok, true);
      assert.strictEqual(hook1Called, false, "hook1 应当被 hostOptions 覆盖");
      assert.strictEqual(hook2Called, true, "hook2 应当生效执行");
    } finally {
      await service.close();
    }
  });

  it("远端子动作不准备本机同名包，也不执行本地备用实现", async () => {
    const remote = await createActionDock({
      runtimeOptions: {
        projectConfig: { id: "pkg.remote", name: "Remote", version: "1.0.0" },
        actions: { task: defineAction({ run: async () => ({ source: "remote" }) }) },
      },
    });
    let server: ActionDockServerInstance | undefined;
    let localExecutions = 0;
    const prepared: string[] = [];
    try {
      server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: "preparation-test-token",
        service: remote,
        enableManagement: false,
        packageAllowlist: ["pkg.remote"],
      });
      addProfile("preparation-remote", { serverUrl: server.url, token: "preparation-test-token" }, join(tempDir, "home"));
      activeHost = await createActionDockHost({
        autoLoadCurrentProject: false,
        scanLinkedPackages: false,
        prepareLocalPackage: async (target) => { prepared.push(target.identity.id); },
        actionBindings: {
          "pkg.a": { "pkg.remote/task": { default: { type: "remote", profile: "preparation-remote" } } },
        },
        packages: [
          {
            packageRoot: createDummyPackageDir("remote-caller"),
            projectConfig: { id: "pkg.a", actions: { call: { entry: "call.js", uses: ["pkg.remote/task"] } } },
            actions: { call: defineAction({ run: async (_input: unknown, ctx: ActionContext) => ctx.actions.invoke("pkg.remote/task", {}) }) },
          },
          {
            packageRoot: createDummyPackageDir("local-remote-candidate"),
            projectConfig: { id: "pkg.remote" },
            actions: { task: defineAction({ run: async () => { localExecutions++; return { source: "local" }; } }) },
          },
        ],
      });
      const result = await activeHost.runAction("pkg.a/call", {});
      assert.strictEqual(result.ok, true);
      if (result.ok) assert.deepStrictEqual(result.data, { source: "remote" });
      assert.deepStrictEqual(prepared, ["pkg.a"]);
      assert.strictEqual(localExecutions, 0);
    } finally {
      await activeHost?.close();
      await server?.stop();
      await remote.close();
    }
  });

  it("关闭宿主会取消正在等待子包准备的父动作，并等待子包清理完成", async () => {
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    let finishCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => { finishCleanup = resolve; });
    let parentExecutions = 0;
    let childExecutions = 0;
    activeHost = await createActionDockHost({
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
      prepareLocalPackage: async (target, context) => {
        if (target.identity.id !== "pkg.child") return;
        await new Promise<void>((_resolve, reject) => {
          const abort = () => {
            void cleanup.then(() => reject(new ActionDockError(ACTION_CANCELLED, "Child preparation stopped")));
          };
          context.signal.addEventListener("abort", abort, { once: true });
          if (context.signal.aborted) abort();
          notifyStarted();
        });
      },
      packages: [
        {
          packageRoot: createDummyPackageDir("closing-parent"),
          projectConfig: { id: "pkg.parent", actions: { call: { entry: "call.js", uses: ["pkg.child/task"] } } },
          actions: { call: defineAction({ run: async (_input: unknown, ctx: ActionContext) => {
            parentExecutions++;
            return ctx.actions.invoke("pkg.child/task", {});
          } }) },
        },
        {
          packageRoot: createDummyPackageDir("closing-child"),
          projectConfig: { id: "pkg.child" },
          actions: { task: defineAction({ run: async () => { childExecutions++; return {}; } }) },
        },
      ],
    });
    const running = activeHost.runAction("pkg.parent/call", {});
    await started;
    let closed = false;
    const closing = activeHost.close().then(() => { closed = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.strictEqual(closed, false);
      assert.strictEqual(parentExecutions, 1);
      assert.strictEqual(childExecutions, 0);
    } finally {
      finishCleanup();
    }
    await closing;
    const result = await running;
    assert.strictEqual(result.ok, false);
    if (!result.ok) assert.strictEqual(result.error.code, ACTION_CANCELLED);
    assert.strictEqual(parentExecutions, 1);
    assert.strictEqual(childExecutions, 0);
  });

  it("createActionDock runtimeOptions 分支亦正确透传 prepareLocalPackage", async () => {
    let runtimeHookCalled = false;
    const dirRt = createDummyPackageDir("pkg-runtime-branch");

    const service = await createActionDock({
      prepareLocalPackage: async () => {
        runtimeHookCalled = true;
      },
      runtimeOptions: {
        packageRoot: dirRt,
        projectConfig: { id: "pkg.runtime", name: "Runtime Branch", version: "1.0.0" },
        actions: [
          {
            id: "call",
            action: defineAction({
              run: async () => ({ rt: true }),
            }),
          },
        ],
      },
    });

    try {
      const res = await service.execution.run("pkg.runtime/call", {});
      assert.strictEqual(res.ok, true);
      assert.strictEqual(runtimeHookCalled, true, "runtimeOptions 分支应正确调用准备回调");
    } finally {
      await service.close();
    }
  });

  it("根调用注入 prepareLocalPackage 且设置 timeoutMs 时，准备超时未执行 handler 且清理完成", async () => {
    const dirTimeout = createDummyPackageDir("pkg-timeout-prep");
    let handlerExecuted = false;
    let cleanupCompleted = false;

    let finishCleanup!: () => void;
    const cleanupWait = new Promise<void>((r) => {
      finishCleanup = r;
    });

    const slowHook = async (
      _target: LocalPackagePreparationTarget,
      context: LocalPackagePreparationContext
    ) => {
      await new Promise<void>((resolve, reject) => {
        context.signal.addEventListener("abort", async () => {
          await cleanupWait;
          cleanupCompleted = true;
          reject(context.signal.reason);
        });
      });
    };

    activeHost = await createActionDockHost({
      prepareLocalPackage: slowHook,
      packages: [
        {
          packageRoot: dirTimeout,
          projectConfig: { id: "pkg.timeout", name: "Timeout Test", version: "1.0.0" },
          actions: [
            {
              id: "act",
              action: defineAction({
                run: async () => {
                  handlerExecuted = true;
                  return { ok: true };
                },
              }),
            },
          ],
        },
      ],
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
    });

    const runPromise = activeHost.runAction("pkg.timeout/act", {}, { timeoutMs: 30 });

    setTimeout(() => {
      finishCleanup();
    }, 60);

    const result = await runPromise;
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ACTION_TIMEOUT);
      assert.match(result.error.message, /30ms/);
    }
    assert.strictEqual(handlerExecuted, false, "准备超时后 handler 绝对不得执行");
    assert.strictEqual(cleanupCompleted, true, "必须已等待底层清理完成");
  });

  it("准备耗时大于总预算时，直接返回 ACTION_TIMEOUT 且 handler 绝不执行", async () => {
    const dirBudgetExhausted = createDummyPackageDir("pkg-budget-exhausted");
    let handlerExecuted = false;

    const delayHook = async () => {
      // 耗时 60ms 超过总预算 30ms
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
    };

    activeHost = await createActionDockHost({
      prepareLocalPackage: delayHook,
      packages: [
        {
          packageRoot: dirBudgetExhausted,
          projectConfig: { id: "pkg.budget", name: "Budget Exhausted", version: "1.0.0" },
          actions: [
            {
              id: "act",
              action: defineAction({
                run: async () => {
                  handlerExecuted = true;
                  return { ok: true };
                },
              }),
            },
          ],
        },
      ],
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
    });

    const result = await activeHost.runAction("pkg.budget/act", {}, { timeoutMs: 30 });
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ACTION_TIMEOUT);
      assert.match(result.error.message, /30ms/);
    }
    assert.strictEqual(handlerExecuted, false, "准备阶段耗尽预算后 handler 绝对不得执行");
  });

  it("准备消耗部分预算后 handler 仍受总期限约束，超时触发 ACTION_TIMEOUT 且体现原始预算", async () => {
    const dirPartial = createDummyPackageDir("pkg-budget-partial");
    let handlerStarted = false;
    let handlerCompleted = false;

    const partialDelayHook = async () => {
      // 消耗 30ms
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
    };

    activeHost = await createActionDockHost({
      prepareLocalPackage: partialDelayHook,
      packages: [
        {
          packageRoot: dirPartial,
          projectConfig: { id: "pkg.partial", name: "Partial Budget", version: "1.0.0" },
          actions: [
            {
              id: "act",
              action: defineAction({
                run: async (_input: unknown, ctx: ActionContext) => {
                  handlerStarted = true;
                  await new Promise<void>((resolve, reject) => {
                    const timer = setTimeout(resolve, 100);
                    ctx.signal.addEventListener("abort", () => {
                      clearTimeout(timer);
                      reject(ctx.signal.reason);
                    });
                  });
                  handlerCompleted = true;
                  return { ok: true };
                },
              }),
            },
          ],
        },
      ],
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
    });

    const result = await activeHost.runAction("pkg.partial/act", {}, { timeoutMs: 60 });
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ACTION_TIMEOUT);
      assert.match(result.error.message, /60ms/);
    }
    assert.strictEqual(handlerStarted, true, "handler 应当在剩余预算内启动");
    assert.strictEqual(handlerCompleted, false, "handler 受到总期限约束应超时中止");
  });

  it("相同 requestId 在多次调用中即使本地准备耗时不同（剩余预算不同），仍成功幂等重放相同结果且 handler 仅执行一次", async () => {
    const dirIdemp = createDummyPackageDir("pkg-idemp-prep");
    let preparations = 0;
    let executions = 0;

    const dynamicDelayHook = async () => {
      preparations++;
      // 第一次准备耗时 20ms，第二次准备耗时 60ms，制造客观抖动
      await new Promise<void>((resolve) => setTimeout(resolve, preparations === 1 ? 20 : 60));
    };

    activeHost = await createActionDockHost({
      prepareLocalPackage: dynamicDelayHook,
      packages: [
        {
          packageRoot: dirIdemp,
          projectConfig: { id: "pkg.idemp", name: "Idempotency Test", version: "1.0.0" },
          actions: [
            {
              id: "act",
              action: defineAction({
                run: async () => {
                  executions++;
                  return { count: executions };
                },
              }),
            },
          ],
        },
      ],
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
    });

    const options = { requestId: "req-diff-prep-jitter", timeoutMs: 2000 };
    const first = await activeHost.runAction("pkg.idemp/act", { val: "x" }, options);
    assert.strictEqual(first.ok, true);
    assert.strictEqual((first as any).data?.count, 1);
    const originalRunId = first.runId;

    const second = await activeHost.runAction("pkg.idemp/act", { val: "x" }, options);
    assert.strictEqual(second.ok, true);
    assert.strictEqual(second.runId, originalRunId, "第二次幂等重放必须返回相同 runId");
    assert.strictEqual((second as any).data?.count, 1, "重放结果应与首次执行一致");
    assert.strictEqual(preparations, 2, "两轮调用均触发了准备 hook");
    assert.strictEqual(executions, 1, "handler 绝不重复执行");
  });

  it("相同 requestId 但显式改变调用 timeoutMs 时，正确产生 IDEMPOTENCY_CONFLICT 冲突拒绝", async () => {
    const dirConflict = createDummyPackageDir("pkg-idemp-conflict");
    let executions = 0;

    activeHost = await createActionDockHost({
      prepareLocalPackage: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      },
      packages: [
        {
          packageRoot: dirConflict,
          projectConfig: { id: "pkg.conflict", name: "Conflict Test", version: "1.0.0" },
          actions: [
            {
              id: "act",
              action: defineAction({
                run: async () => {
                  executions++;
                  return { count: executions };
                },
              }),
            },
          ],
        },
      ],
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
    });

    const first = await activeHost.runAction(
      "pkg.conflict/act",
      { val: "x" },
      { requestId: "req-conflict-check", timeoutMs: 2000 }
    );
    assert.strictEqual(first.ok, true);
    assert.strictEqual(executions, 1);

    // 显式改变 timeoutMs 从 2000 变为 3000
    const secondPromise = activeHost.runAction(
      "pkg.conflict/act",
      { val: "x" },
      { requestId: "req-conflict-check", timeoutMs: 3000 }
    );

    await assert.rejects(
      secondPromise,
      (err: any) => {
        assert.strictEqual(err?.code, IDEMPOTENCY_CONFLICT);
        assert.match(err?.message, /input parameters digest mismatch/);
        return true;
      },
      "真实改变 timeoutMs 必须产生 IDEMPOTENCY_CONFLICT"
    );

    assert.strictEqual(executions, 1, "冲突时 handler 绝不得执行");
  });
});
