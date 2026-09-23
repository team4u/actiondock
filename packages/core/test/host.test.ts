import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ActionContext, defineAction } from "@actiondock/sdk";
import { createPackageRuntime } from "../src/package";
import { createPackageIdentity } from "../src/runtime/identity";
import { createActionDockHost, DefaultActionDockHost } from "../src/host";
import { createNodePlatform } from "../src/platform";
import { MemoryProcessDriver } from "../src/process/driver";
import { PROJECT_RECOVERY_REQUIRED } from "../src/errors";

describe("ActionDockHost 多包宿主容器", () => {
  it("初始化并支持 PackageRuntime 实例与 PackageRuntimeOptions 配置混合注册", async () => {
    const mathAddAction = defineAction({
      run: (input: { a: number; b: number }) => ({ sum: input.a + input.b }),
    });

    const appA = await createPackageRuntime({
      projectConfig: {
        id: "pkg.math",
        name: "数学计算包",
        version: "1.0.0",
      },
      actions: { add: mathAddAction },
      inMemory: true,
    });

    const host = await createActionDockHost({
      packages: [
        appA,
        {
          projectConfig: {
            id: "pkg.string",
            name: "字符串工具包",
            version: "1.0.0",
          },
          actions: {
            concat: defineAction({
              run: (input: { a: string; b: string }) => ({ result: `${input.a}${input.b}` }),
            }),
          },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
    });

    expect(host).toBeInstanceOf(DefaultActionDockHost);
    const apps = host.listRuntimes();
    expect(apps.length).toBe(2);

    const mathApp = host.getRuntime("pkg.math");
    expect(mathApp).toBeDefined();
    expect(mathApp?.packageId).toBe("pkg.math");

    const strApp = host.getRuntime("pkg.string");
    expect(strApp).toBeDefined();
    expect(strApp?.packageId).toBe("pkg.string");

    const unknownApp = host.getRuntime("pkg.unknown");
    expect(unknownApp).toBeUndefined();

    const infoList = await host.info();
    expect(infoList.length).toBe(2);
    const ids = infoList.map((i) => i.id).sort();
    expect(ids).toEqual(["pkg.math", "pkg.string"]);

    await host.close();
  });

  it("支持通过 projectRoot 自动加载当前工程及重复包注册冲突校验", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "actiondock-host-proj-"));

    try {
      writeFileSync(
        join(tempDir, "actiondock.json"),
        JSON.stringify(
          {
            id: "pkg.auto",
            name: "自动加载工程",
            version: "1.2.0",
          },
          null,
          2
        )
      );

      const host = await createActionDockHost({
        projectRoot: tempDir,
        autoLoadCurrentProject: true,
        inMemory: true,
      });

      const autoApp = host.getRuntime("pkg.auto");
      expect(autoApp).toBeDefined();
      expect(autoApp?.packageId).toBe("pkg.auto");

      // 注册同名冲突包抛出异常
      const duplicateApp = await createPackageRuntime({
        projectConfig: {
          id: "pkg.auto",
          name: "同名冲突包",
          version: "1.2.0",
        },
        inMemory: true,
      });

      expect(() => host.registerRuntime(duplicateApp)).toThrow(
        "Package ID conflict: package 'pkg.auto' is already registered in host"
      );

      // 重复注册同一实例为幂等无害操作
      host.registerRuntime(autoApp!);

      await duplicateApp.close();
      await host.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("静态列出全量 Actions 与条件过滤，支持短名与完全限定引用查询", async () => {
    const actionA = defineAction({
      run: () => ({ found: true }),
    });

    const actionB = defineAction({
      run: () => ({ created: true }),
    });

    const actionC = defineAction({
      run: () => ({ users: [] }),
    });

    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: {
            id: "pkg.items",
            name: "资源包",
            version: "1.0.0",
            actions: {
              search: { entry: "", description: "搜索资源", tags: ["query", "index"] },
              create: { entry: "", description: "创建资源", tags: ["mutation"] },
            },
          },
          actions: { search: actionA, create: actionB },
          inMemory: true,
        },
        {
          projectConfig: {
            id: "pkg.users",
            name: "用户包",
            version: "1.0.0",
            actions: {
              search: { entry: "", description: "用户搜索", tags: ["user", "query"] },
            },
          },
          actions: { search: actionC },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
    });

    // 1. 全量列出 Actions 带有完全限定标识
    const allActions = await host.listActions();
    expect(allActions.length).toBe(3);
    const allIds = allActions.map((a) => a.id).sort();
    expect(allIds).toEqual(["pkg.items/create", "pkg.items/search", "pkg.users/search"]);

    // 2. 标签过滤
    const queryActions = await host.listActions({ tags: ["query"] });
    expect(queryActions.length).toBe(2);

    // 3. 关键词过滤
    const userActions = await host.listActions({ query: "用户" });
    expect(userActions.length).toBe(1);
    expect(userActions[0].id).toBe("pkg.users/search");

    // 4. 前缀过滤
    const prefixActions = await host.listActions({ prefix: "pkg.items/" });
    expect(prefixActions.length).toBe(2);

    // 5. 完全限定 describeAction
    const specExact = await host.describeAction("pkg.items/search");
    expect(specExact.id).toBe("search");
    expect(specExact.description).toBe("搜索资源");

    // 6. 唯一短标识符 describeAction
    const specUnique = await host.describeAction("create");
    expect(specUnique.id).toBe("create");

    // 7. 冲突短标识符 describeAction 抛出歧义异常
    await expect(host.describeAction("search")).rejects.toThrow("AMBIGUOUS_ACTION_REF");

    // 8. 不存在的 Action 抛出异常
    await expect(host.describeAction("missing")).rejects.toThrow("ACTION_NOT_FOUND");
    await expect(host.describeAction("pkg.none/action")).rejects.toThrow("Package 'pkg.none' not found in host");

    await host.close();
  });

  it("支持跨包规程 Playbooks 检索与详细查询", async () => {
    const tempDirA = mkdtempSync(join(tmpdir(), "actiondock-host-pba-"));
    const tempDirB = mkdtempSync(join(tmpdir(), "actiondock-host-pbb-"));

    try {
      const pbDirA = join(tempDirA, "playbooks");
      mkdirSync(pbDirA, { recursive: true });
      writeFileSync(
        join(pbDirA, "deploy.md"),
        `---
id: deploy
description: 部署生产环境
actions:
  - build
---

# 部署规程指南
`
      );

      const pbDirB = join(tempDirB, "playbooks");
      mkdirSync(pbDirB, { recursive: true });
      writeFileSync(
        join(pbDirB, "backup.md"),
        `---
id: backup
description: 备份数据库
actions:
  - dump
---

# 备份操作指南
`
      );

      writeFileSync(
        join(tempDirA, "actiondock.json"),
        JSON.stringify({
          schemaVersion: 2,
          id: "ops.deploy",
          name: "部署包",
          version: "1.0.0",
          playbooks: {
            deploy: {
              entry: "playbooks/deploy.md",
              description: "部署生产环境",
              actions: ["build"],
            },
          },
        })
      );

      writeFileSync(
        join(tempDirB, "actiondock.json"),
        JSON.stringify({
          schemaVersion: 2,
          id: "ops.backup",
          name: "备份包",
          version: "1.0.0",
          playbooks: {
            backup: {
              entry: "playbooks/backup.md",
              description: "备份数据库",
              actions: ["dump"],
            },
          },
        })
      );

      const host = await createActionDockHost({
        packages: [
          {
            packageRoot: tempDirA,
            projectConfig: { id: "ops.deploy", name: "部署包", version: "1.0.0", playbooksDir: "playbooks" },
            inMemory: true,
          },
          {
            packageRoot: tempDirB,
            projectConfig: { id: "ops.backup", name: "备份包", version: "1.0.0", playbooksDir: "playbooks" },
            inMemory: true,
          },
        ],
        autoLoadCurrentProject: false,
      });

      const playbooks = await host.listPlaybooks();
      expect(playbooks.length).toBe(2);
      const pbIds = playbooks.map((p) => p.id).sort();
      expect(pbIds).toEqual(["ops.backup/backup", "ops.deploy/deploy"]);

      const deploySpec = await host.describePlaybook("ops.deploy/deploy");
      expect(deploySpec.id).toBe("deploy");
      expect(deploySpec.content).toContain("# 部署规程指南");

      const backupSpec = await host.describePlaybook("backup");
      expect(backupSpec.id).toBe("backup");
      expect(backupSpec.content).toContain("# 备份操作指南");

      expect(host.describePlaybook("nonexistent")).rejects.toThrow("not found in any registered package");

      await host.close();
    } finally {
      rmSync(tempDirA, { recursive: true, force: true });
      rmSync(tempDirB, { recursive: true, force: true });
    }
  });

  it("支持跨包完全限定引用路由执行与异步票据启动", async () => {
    const calcAction = defineAction({
      run: (input: { x: number; y: number }) => ({ val: input.x * input.y }),
    });

    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: { id: "service.math", name: "计算服务", version: "1.0.0" },
          actions: { multiply: calcAction },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
    });

    // 1. 同步执行 runAction
    const syncRes = await host.runAction("service.math/multiply", { x: 6, y: 7 });
    expect(syncRes.ok).toBe(true);
    if (syncRes.ok) {
      expect(syncRes.data).toEqual({ val: 42 });
    }

    // 2. 异步执行 startAction
    const ticket = await host.startAction("service.math/multiply", { x: 8, y: 9 });
    expect(ticket.runId).toBeDefined();
    expect(ticket.status).toBe("running");

    const asyncRes = await ticket.result!;
    expect(asyncRes.ok).toBe(true);
    if (asyncRes.ok) {
      expect(asyncRes.data).toEqual({ val: 72 });
    }

    // 3. 通过 getRun 检索运行详情
    const run = await host.getRun(ticket.runId);
    expect(run).toBeDefined();
    expect(run?.id).toBe(ticket.runId);
    expect(run?.status).toBe("success");
    expect(run?.output).toEqual({ val: 72 });

    // 4. 调用不存在的包返回结构化错误
    const badPkgRes = await host.runAction("unknown.pkg/action", {});
    expect(badPkgRes.ok).toBe(false);
    if (!badPkgRes.ok) {
      expect(badPkgRes.error?.code).toBe("PACKAGE_NOT_FOUND");
    }

    // 5. 调用不存在的动作返回结构化错误
    const badActRes = await host.runAction("service.math/not-exist", {});
    expect(badActRes.ok).toBe(false);
    if (!badActRes.ok) {
      expect(badActRes.error?.code).toBe("ACTION_NOT_FOUND");
    }

    await host.close();
  });

  it("声明 uses 时跨包调用成功执行，未声明 uses 时返回 UNDECLARED_ACTION_DEPENDENCY", async () => {
    // 目标工作服务
    const workerAction = defineAction({
      run: (input: { num: number }) => ({ result: input.num * 10 }),
    });

    // 声明了 uses 的调用者动作
    const declaredCallerAction = defineAction({
      run: async (input: { val: number }, ctx: ActionContext) => {
        const res = await ctx.actions.invoke("service.worker/worker-task", { num: input.val });
        return { callerOutput: res };
      },
    });

    // 未声明 uses 的调用者动作
    const undeclaredCallerAction = defineAction({
      run: async (input: { val: number }, ctx: ActionContext) => {
        const res = await ctx.actions.invoke("service.worker/worker-task", { num: input.val });
        return { callerOutput: res };
      },
    });

    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: { id: "service.worker", name: "工作服务", version: "1.0.0" },
          actions: { "worker-task": workerAction },
          inMemory: true,
        },
        {
          projectConfig: {
            id: "service.caller",
            name: "调用者服务",
            version: "1.0.0",
            actions: {
              "declared-caller": {
                entry: "",
                uses: ["service.worker/worker-task"],
              },
              "undeclared-caller": {
                entry: "",
                uses: [],
              },
            },
          },
          actions: {
            "declared-caller": declaredCallerAction,
            "undeclared-caller": undeclaredCallerAction,
          },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
    });

    // 1. 已声明依赖的动作成功执行
    const successRes = await host.runAction("service.caller/declared-caller", { val: 5 });
    expect(successRes.ok).toBe(true);
    if (successRes.ok) {
      expect(successRes.data).toEqual({ callerOutput: { result: 50 } });
    }

    // 2. 未声明依赖的动作执行失败并返回 UNDECLARED_ACTION_DEPENDENCY
    const failedRes = await host.runAction("service.caller/undeclared-caller", { val: 5 });
    expect(failedRes.ok).toBe(false);
    if (!failedRes.ok) {
      expect(failedRes.error.code).toBe("UNDECLARED_ACTION_DEPENDENCY");
      expect(failedRes.error.message).toContain("Undeclared cross-package dependency");
    }

    await host.close();
  });

  it("跨包调用继承调用方租户与用户，并使用目标包的真实 packageInstanceId 与 generationId", async () => {
    const workerAction = defineAction({
      run: async (_input: unknown, ctx: ActionContext) => {
        return {
          workerOwner: (ctx.process as any).owner,
        };
      },
    });

    const callerAction = defineAction({
      run: async (_input: unknown, ctx: ActionContext) => {
        const workerRes = await ctx.actions.invoke("target.worker/do-work", {});
        return {
          callerOwner: (ctx.process as any).owner,
          workerRes,
        };
      },
    });

    const host = await createActionDockHost({
      platform: createNodePlatform({ name: "test", processDriver: new MemoryProcessDriver() }),
      packages: [
        {
          projectConfig: { id: "target.worker", name: "Worker", version: "1.0.0" },
          identity: createPackageIdentity({
            id: "target.worker",
            instanceId: "target-worker-inst-9",
            generation: "target-worker-gen-3",
          }),
          actions: { "do-work": workerAction },
          inMemory: true,
        },
        {
          projectConfig: {
            id: "source.caller",
            name: "Caller",
            version: "1.0.0",
            actions: {
              "call-worker": {
                entry: "",
                uses: ["target.worker/do-work"],
              },
            },
          },
          identity: createPackageIdentity({
            id: "source.caller",
            instanceId: "source-caller-inst-1",
            generation: "source-caller-gen-1",
          }),
          actions: { "call-worker": callerAction },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
    });

    const callerApp = host.getRuntime("source.caller")!;
    const testRunId = "run-caller-test";
    const res = await callerApp.executionService.execute("call-worker", {}, {
      runId: testRunId,
      rootRunId: testRunId,
      callStack: [],
      package: callerApp.identity,
      signal: new AbortController().signal,
      owner: {
        tenantId: "tenant-corp-1",
        principalId: "user-alice",
        packageInstanceId: "custom-caller-inst",
        generationId: "custom-caller-gen",
      },
    });
    expect(res.ok).toBe(true);
    const data = (res as any).data;
    expect(data.callerOwner).toEqual({
      tenantId: "tenant-corp-1",
      principalId: "user-alice",
      packageInstanceId: "custom-caller-inst",
      generationId: "custom-caller-gen",
    });
    expect(data.workerRes.workerOwner).toEqual({
      tenantId: "tenant-corp-1",
      principalId: "user-alice",
      packageInstanceId: "target-worker-inst-9",
      generationId: "target-worker-gen-3",
    });

    await host.close();
  });

  it("统一限制调用深度与根运行子任务数配额", async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => {
      releaseGate = r;
    });

    const stepA = defineAction({
      run: async (_input, ctx) => ctx.actions.invoke("pkg.depth/stepB", {}),
    });
    const stepB = defineAction({
      run: async (_input, ctx) => ctx.actions.invoke("pkg.depth/stepC", {}),
    });
    const stepC = defineAction({
      run: async (_input, ctx) => ctx.actions.invoke("pkg.depth/stepD", {}),
    });
    const stepD = defineAction({
      run: async () => ({ done: true }),
    });

    const slowAction = defineAction({
      run: async () => {
        await gate;
        return { finished: true };
      },
    });

    const rootParallelAction = defineAction({
      run: async (_input, ctx) => {
        const p1 = ctx.actions.invoke("pkg.depth/slow", {});
        const p2 = ctx.actions.invoke("pkg.depth/slow", {});
        try {
          await ctx.actions.invoke("pkg.depth/slow", {});
          return { error: null };
        } catch (err: any) {
          return { error: { code: err.code, message: err.message } };
        } finally {
          releaseGate();
          await Promise.allSettled([p1, p2]);
        }
      },
    });

    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: {
            id: "pkg.depth",
            name: "深度测试包",
            version: "1.0.0",
            actions: {
              stepA: { entry: "" },
              stepB: { entry: "" },
              stepC: { entry: "" },
              stepD: { entry: "" },
              slow: { entry: "" },
              rootParallel: { entry: "" },
            },
          },
          actions: {
            stepA,
            stepB,
            stepC,
            stepD,
            slow: slowAction,
            rootParallel: rootParallelAction,
          },
          inMemory: true,
        },
      ],
      maxCallDepth: 3,
      maxSubRuns: 2,
      autoLoadCurrentProject: false,
    });

    // 1. 调用深度测试：A -> B -> C -> D 超过 maxCallDepth (3)
    const depthRes = await host.runAction("pkg.depth/stepA", {});
    expect(depthRes.ok).toBe(false);
    if (!depthRes.ok) {
      expect(["ACTION_CALL_CYCLE", "ACTION_MAX_DEPTH_EXCEEDED"]).toContain(depthRes.error.code);
    }

    // 2. 子任务限额测试：maxSubRuns: 2，第 3 个并发子任务被拒
    const quotaRes = await host.runAction("pkg.depth/rootParallel", {});
    expect(quotaRes.ok).toBe(true);
    if (quotaRes.ok) {
      const data = quotaRes.data as any;
      expect(["ACTION_SUBRUN_LIMIT", "MAX_SUBRUNS_REACHED"]).toContain(data.error?.code);
    }

    await host.close();
  });

  it("支持 cancelRun 任务取消、events 事件流订阅与 close 优雅收尾", async () => {
    let cancelled = false;
    const longAction = defineAction({
      run: async (_input: unknown, ctx: ActionContext) => {
        ctx.log.info("long task running");
        ctx.signal.addEventListener("abort", () => {
          cancelled = true;
        });
        for (let i = 0; i < 20; i++) {
          if (ctx.signal.aborted) {
            cancelled = true;
            throw new Error("aborted");
          }
          await new Promise((r) => setTimeout(r, 20));
        }
        return { success: true };
      },
    });

    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: { id: "pkg.lifecycle", name: "生命周期包", version: "1.0.0" },
          actions: { "long-task": longAction },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
    });

    const ticket = await host.startAction("pkg.lifecycle/long-task", {});
    expect(ticket.runId).toBeDefined();

    const receivedEvents: any[] = [];
    const eventPromise = (async () => {
      for await (const evt of host.events(ticket.runId)) {
        receivedEvents.push(evt);
        if (evt.type === "finish") break;
      }
    })();

    await new Promise((r) => setTimeout(r, 30));
    const cancelRes = await host.cancelRun(ticket.runId, "用户终止");
    expect(cancelRes.outcome).toBe("requested");

    const res = await ticket.result!;
    expect(res.ok).toBe(false);
    expect(cancelled).toBe(true);

    await eventPromise;
    expect(receivedEvents.some((e) => e.type === "status")).toBe(true);
    expect(receivedEvents.some((e) => e.type === "finish")).toBe(true);

    // 取消不存在的任务
    const missingCancel = await host.cancelRun("unknown-run-id");
    expect(missingCancel.outcome).toBe("not_found");

    // 优雅关闭
    await host.close();
    expect(host.runAction("pkg.lifecycle/long-task", {})).rejects.toThrow(
      "ActionDockHost is closed: new tasks rejected"
    );
  });

  it("支持通过软链接的 ~/.actiondock 目录正常装载链接包并执行 (OpenClaw 软链场景)", async () => {
    const { symlinkSync } = await import("node:fs");
    const tempBase = mkdtempSync(join(tmpdir(), "ad-host-symlink-test-"));
    try {
      // 真实目标目录
      const realTarget = join(tempBase, "openclaw", ".actiondock");
      mkdirSync(realTarget, { recursive: true });

      // 宿主伪造家目录，内建软链: fakeHome/.actiondock -> realTarget
      const fakeHome = join(tempBase, "fakehome");
      mkdirSync(fakeHome, { recursive: true });
      const symlinkHome = join(fakeHome, ".actiondock");
      symlinkSync(realTarget, symlinkHome);

      // 创建一个外部包工程
      const pkgDir = join(tempBase, "my-external-pkg");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "actiondock.json"),
        JSON.stringify({
          id: "openclaw.test-tool",
          name: "OpenClaw 测试工具",
          version: "1.0.0",
          actions: {
            greet: {
              description: "问候 Action",
            },
          },
        })
      );

      // 在注册表中登记该链接包
      const registryPath = join(symlinkHome, "registry.json");
      writeFileSync(
        registryPath,
        JSON.stringify({
          version: "2.0.0",
          packages: {
            "openclaw.test-tool": {
              id: "openclaw.test-tool",
              name: "OpenClaw 测试工具",
              version: "1.0.0",
              path: pkgDir,
              linkedAt: new Date().toISOString(),
            },
          },
        })
      );

      // 启动 Host，开启扫描链接包
      const host = await createActionDockHost({
        scanLinkedPackages: true,
        customHome: fakeHome,
        autoLoadCurrentProject: false,
      });

      // 验证 Host 成功装载该链接包（未被静默丢弃）
      const app = host.getRuntime("openclaw.test-tool");
      expect(app).toBeDefined();
      expect(app?.packageId).toBe("openclaw.test-tool");

      // 验证 describeAction 能够正常调阅
      const spec = await host.describeAction("openclaw.test-tool/greet");
      expect(spec.description).toBe("问候 Action");

      await host.close();
    } finally {
      rmSync(tempBase, { recursive: true, force: true });
    }
  });

  it("当链接包损坏或路径不存在时，输出告警日志并在调阅时透传精准失败原因", async () => {
    const tempBase = mkdtempSync(join(tmpdir(), "ad-host-failed-link-test-"));
    try {
      const fakeHome = join(tempBase, "fakehome");
      const adHome = join(fakeHome, ".actiondock");
      mkdirSync(adHome, { recursive: true });

      // 注册表中登记一个物理不存在的路径
      const nonExistentPath = join(tempBase, "does-not-exist");
      writeFileSync(
        join(adHome, "registry.json"),
        JSON.stringify({
          version: "2.0.0",
          packages: {
            "broken.pkg": {
              id: "broken.pkg",
              name: "损坏包",
              version: "1.0.0",
              path: nonExistentPath,
              linkedAt: new Date().toISOString(),
            },
          },
        })
      );

      const warnings: string[] = [];
      const mockLogger = {
        debug: () => {},
        info: () => {},
        warn: (msg: string) => warnings.push(msg),
        error: () => {},
      };

      const host = await createActionDockHost({
        scanLinkedPackages: true,
        customHome: fakeHome,
        autoLoadCurrentProject: false,
        logger: mockLogger,
      });

      // 应该记录了警告日志
      expect(warnings.some((w) => w.includes("broken.pkg"))).toBe(true);

      // 调用 describeAction 时，错误信息必须携带具体的失败原因与路径
      await expect(host.describeAction("broken.pkg/any-action")).rejects.toThrow(
        /broken\.pkg.*failed to load.*does-not-exist/
      );

      // 调用 runAction 时，错误信息亦必须透传
      const res = await host.runAction("broken.pkg/any-action", {});
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.message).toMatch(/broken\.pkg.*failed to load.*does-not-exist/);
      }

      await host.close();
    } finally {
      rmSync(tempBase, { recursive: true, force: true });
    }
  });

  it("当工程存在待恢复事务且恢复失败时，createActionDockHost 抛出异常阻止 Host 启动", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ad-host-recovery-fail-"));

    try {
      writeFileSync(
        join(tempDir, "actiondock.json"),
        JSON.stringify({
          id: "pkg.recovery-fail",
          name: "事务恢复失败工程",
          version: "1.0.0",
        })
      );

      // 构造待恢复事务
      const txDir = join(tempDir, ".actiondock", "transactions", "tx-crash-fail");
      const snapDir = join(txDir, "snapshot");
      mkdirSync(snapDir, { recursive: true });

      // 快照中包含 package.json
      writeFileSync(
        join(snapDir, "package.json"),
        JSON.stringify({
          name: "pkg.recovery-fail",
          dependencies: { "unmatched-dep-xyz": "1.0.0" },
        })
      );

      writeFileSync(
        join(txDir, "transaction.json"),
        JSON.stringify({
          id: "tx-crash-fail",
          status: "pending",
          createdAt: Date.now(),
          files: [{ name: "package.json", existed: true }],
        })
      );

      // 准备冲突的 package.json 与 package-lock.json，确保冻结安装直接报错
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "pkg.recovery-fail",
          dependencies: { "unmatched-dep-xyz": "1.0.0" },
        })
      );
      writeFileSync(
        join(tempDir, "package-lock.json"),
        JSON.stringify({ name: "pkg.recovery-fail", lockfileVersion: 3 })
      );

      // 验证 createActionDockHost 抛出异常并阻止 Host 启动
      let caughtError: any;
      try {
        await createActionDockHost({
          projectRoot: tempDir,
          autoLoadCurrentProject: true,
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError?.code).toBe("PROJECT_RECOVERY_REQUIRED");
      expect(caughtError?.message).toContain("PROJECT_RECOVERY_REQUIRED");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("当 project.lock 被活跃 PID 持有时，createActionDockHost 与 new DefaultActionDockHost 均抛出 PROJECT_BUSY 异常", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ad-host-lock-busy-"));
    const dummyChild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });

    try {
      writeFileSync(
        join(tempDir, "actiondock.json"),
        JSON.stringify({
          id: "pkg.busy-test",
          name: "并发锁测试工程",
          version: "1.0.0",
        })
      );

      const lockDir = join(tempDir, ".actiondock", "project.lock");
      mkdirSync(lockDir, { recursive: true });
      const lockInfo = {
        pid: dummyChild.pid,
        sessionToken: "active-holder-token",
        createdAt: Date.now(),
      };
      writeFileSync(join(lockDir, "metadata.json"), JSON.stringify(lockInfo, null, 2), "utf-8");

      // 1. 验证 createActionDockHost 抛出 PROJECT_BUSY 异常
      let createErr: any;
      try {
        await createActionDockHost({
          projectRoot: tempDir,
          autoLoadCurrentProject: true,
        });
      } catch (err) {
        createErr = err;
      }

      expect(createErr).toBeDefined();
      expect(createErr?.code).toBe("PROJECT_BUSY");
      expect(createErr?.message).toContain(
        "PROJECT_BUSY: Project directory is locked by another active process holding project.lock"
      );

      // 2. 验证 new DefaultActionDockHost 抛出 PROJECT_BUSY 异常
      let constructErr: any;
      try {
        new DefaultActionDockHost({
          projectRoot: tempDir,
          autoLoadCurrentProject: true,
        });
      } catch (err) {
        constructErr = err;
      }

      expect(constructErr).toBeDefined();
      expect(constructErr?.code).toBe("PROJECT_BUSY");
      expect(constructErr?.message).toContain(
        "PROJECT_BUSY: Project directory is locked by another active process holding project.lock"
      );
    } finally {
      try {
        dummyChild.kill("SIGKILL");
      } catch {}
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("当 DefaultActionDockHost 构造函数因 PROJECT_BUSY 抛出异常时，妥善释放 dataDirLock 且后续实例可立刻获取该数据目录", async () => {
    const tempProjDir = mkdtempSync(join(tmpdir(), "ad-host-lock-release-proj-"));
    const tempDataDir = mkdtempSync(join(tmpdir(), "ad-host-lock-release-data-"));
    const dummyChild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });

    try {
      writeFileSync(
        join(tempProjDir, "actiondock.json"),
        JSON.stringify({
          id: "pkg.release-busy-test",
          name: "释放锁测试工程",
          version: "1.0.0",
        })
      );

      const lockDir = join(tempProjDir, ".actiondock", "project.lock");
      mkdirSync(lockDir, { recursive: true });
      const lockInfo = {
        pid: dummyChild.pid,
        sessionToken: "active-holder-token",
        createdAt: Date.now(),
      };
      writeFileSync(join(lockDir, "metadata.json"), JSON.stringify(lockInfo, null, 2), "utf-8");

      // 构造 Host 失败（因 project.lock 被占用）
      let constructErr: any;
      try {
        new DefaultActionDockHost({
          projectRoot: tempProjDir,
          dataDir: tempDataDir,
          autoLoadCurrentProject: true,
        });
      } catch (err) {
        constructErr = err;
      }

      expect(constructErr).toBeDefined();
      expect(constructErr?.code).toBe("PROJECT_BUSY");

      // 验证 tempDataDir 上的 dataDirLock 已被妥善释放，未在磁盘遗留锁目录
      const dataLockPath = join(tempDataDir, ".actiondock.data.lock");
      expect(existsSync(dataLockPath)).toBe(false);

      // 验证后续实例可以立刻获取该数据目录，绝无 DATA_DIR_IN_USE
      const subsequentHost = new DefaultActionDockHost({
        dataDir: tempDataDir,
        autoLoadCurrentProject: false,
      });
      expect(subsequentHost).toBeDefined();
      await subsequentHost.close();
      expect(existsSync(dataLockPath)).toBe(false);
    } finally {
      try {
        dummyChild.kill("SIGKILL");
      } catch {}
      rmSync(tempProjDir, { recursive: true, force: true });
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  it("当 DefaultActionDockHost 构造函数因包加载失败抛出异常时，妥善释放 dataDirLock 并安全关闭已注册子 app", async () => {
    const tempDataDir = mkdtempSync(join(tmpdir(), "ad-host-fail-load-data-"));

    try {
      let constructErr: any;
      try {
        new DefaultActionDockHost({
          dataDir: tempDataDir,
          packages: [
            {
              projectConfig: {
                id: "pkg.good",
                name: "正常包",
                version: "1.0.0",
              },
              inMemory: true,
            },
            {
              projectConfig: {
                id: "pkg.good",
                name: "冲突包",
                version: "1.0.0",
              },
              inMemory: true,
            },
          ],
          autoLoadCurrentProject: false,
        });
      } catch (err) {
        constructErr = err;
      }

      expect(constructErr).toBeDefined();
      expect(constructErr?.message).toContain("Package ID conflict");

      // 验证 dataDirLock 已被妥善释放
      const dataLockPath = join(tempDataDir, ".actiondock.data.lock");
      expect(existsSync(dataLockPath)).toBe(false);

      // 后续实例可立刻获取该数据目录
      const hostOk = new DefaultActionDockHost({
        dataDir: tempDataDir,
        autoLoadCurrentProject: false,
      });
      expect(hostOk).toBeDefined();
      await hostOk.close();
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  it("公开的 DefaultActionDockHost constructor 检查崩溃悬挂事务，拦截并抛出 PROJECT_RECOVERY_REQUIRED 错误，且释放 dataDirLock", async () => {
    const tempProjDir = mkdtempSync(join(tmpdir(), "ad-host-pending-tx-proj-"));
    const tempDataDir = mkdtempSync(join(tmpdir(), "ad-host-pending-tx-data-"));

    try {
      writeFileSync(
        join(tempProjDir, "actiondock.json"),
        JSON.stringify({
          id: "pkg.pending-tx",
          name: "崩溃事务测试工程",
          version: "1.0.0",
        })
      );
      writeFileSync(
        join(tempProjDir, "package.json"),
        JSON.stringify({
          name: "pkg.pending-tx",
          version: "1.0.0",
        })
      );

      // 写入悬挂事务
      const txDir = join(tempProjDir, ".actiondock", "transactions", "tx-crash-pending");
      mkdirSync(txDir, { recursive: true });
      writeFileSync(
        join(txDir, "transaction.json"),
        JSON.stringify({
          id: "tx-crash-pending",
          status: "pending",
          createdAt: Date.now(),
          files: [{ name: "package.json", existed: true }],
        })
      );

      // 1. 直接同步 new DefaultActionDockHost 必须抛出 PROJECT_RECOVERY_REQUIRED 拦截
      let syncErr: any;
      try {
        new DefaultActionDockHost({
          projectRoot: tempProjDir,
          dataDir: tempDataDir,
          autoLoadCurrentProject: true,
        });
      } catch (err) {
        syncErr = err;
      }

      expect(syncErr).toBeDefined();
      expect(syncErr?.code).toBe(PROJECT_RECOVERY_REQUIRED);
      expect(syncErr?.message).toContain("PROJECT_RECOVERY_REQUIRED");
      expect(syncErr?.message).toContain("createActionDockHost()");

      // 验证同步构造失败后 dataDirLock 正常释放，未发生锁泄漏
      const dataLockPath = join(tempDataDir, ".actiondock.data.lock");
      expect(existsSync(dataLockPath)).toBe(false);

      // 2. 验证异步工厂 createActionDockHost() 能够自动完成恢复并正常启动
      const host = await createActionDockHost({
        projectRoot: tempProjDir,
        dataDir: tempDataDir,
        autoLoadCurrentProject: true,
      });

      expect(host).toBeDefined();
      expect(host.getRuntime("pkg.pending-tx")).toBeDefined();
      await host.close();
    } finally {
      rmSync(tempProjDir, { recursive: true, force: true });
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  it("当 Host 初始化失败时，外部传入的 PackageRuntime 实例不被 close() 并可继续使用", async () => {
    let appClosed = false;
    const externalApp = await createPackageRuntime({
      projectConfig: { id: "pkg.external", name: "外部包", version: "1.0.0" },
      actions: [
        {
          id: "ping",
          action: defineAction({
            run: () => ({ pong: true }),
          }),
        },
      ],
      inMemory: true,
    });
    const origClose = externalApp.close.bind(externalApp);
    externalApp.close = async (opts?: any) => {
      appClosed = true;
      return origClose(opts);
    };

    const tempDir = mkdtempSync(join(tmpdir(), "ad-host-external-app-test-"));
    const dummyChild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });

    try {
      writeFileSync(
        join(tempDir, "actiondock.json"),
        JSON.stringify({
          id: "pkg.busy-project",
          name: "繁忙工程",
          version: "1.0.0",
        })
      );

      const lockDir = join(tempDir, ".actiondock", "project.lock");
      mkdirSync(lockDir, { recursive: true });
      writeFileSync(
        join(lockDir, "metadata.json"),
        JSON.stringify({
          pid: dummyChild.pid,
          sessionToken: "active-token",
          createdAt: Date.now(),
        })
      );

      // 1. 测试 createActionDockHost 抛错时 externalApp 未被关闭
      let createErr: any;
      try {
        await createActionDockHost({
          projectRoot: tempDir,
          packages: [externalApp],
          autoLoadCurrentProject: true,
        });
      } catch (err) {
        createErr = err;
      }
      expect(createErr?.code).toBe("PROJECT_BUSY");
      expect(appClosed).toBe(false);

      // 外部 App 依然处于打开状态，可正常执行动作
      const execRes1 = await externalApp.runAction("ping", {});
      expect(execRes1.ok).toBe(true);

      // 2. 测试 new DefaultActionDockHost 抛错时 externalApp 未被关闭
      let constructErr: any;
      try {
        new DefaultActionDockHost({
          projectRoot: tempDir,
          packages: [externalApp],
          autoLoadCurrentProject: true,
        });
      } catch (err) {
        constructErr = err;
      }
      expect(constructErr?.code).toBe("PROJECT_BUSY");
      expect(appClosed).toBe(false);

      const execRes2 = await externalApp.runAction("ping", {});
      expect(execRes2.ok).toBe(true);
    } finally {
      try {
        dummyChild.kill("SIGKILL");
      } catch {}
      rmSync(tempDir, { recursive: true, force: true });
      await externalApp.close();
      expect(appClosed).toBe(true);
    }
  });

  it("外部创建的 App 实例传入 Host 后，在 host.close() 执行后未被 close 并保持独立存活", async () => {
    let externalClosed = false;
    let internalClosed = false;

    const externalApp = await createPackageRuntime({
      projectConfig: {
        id: "pkg.borrowed-app",
        name: "借用包",
        version: "1.0.0",
        actions: {
          ping: { entry: "", description: "存活探针" },
        },
      },
      actions: {
        ping: defineAction({
          run: () => ({ status: "alive" }),
        }),
      },
      inMemory: true,
    });
    const origExternalClose = externalApp.close.bind(externalApp);
    externalApp.close = async (opts?: any) => {
      externalClosed = true;
      return origExternalClose(opts);
    };

    try {
      const host = await createActionDockHost({
        packages: [
          externalApp,
          {
            projectConfig: {
              id: "pkg.internal-app",
              name: "内部创建包",
              version: "1.0.0",
            },
            inMemory: true,
          },
        ],
        autoLoadCurrentProject: false,
      });

      const internalApp = host.getRuntime("pkg.internal-app");
      expect(internalApp).toBeDefined();
      if (internalApp) {
        const origInternalClose = internalApp.close.bind(internalApp);
        internalApp.close = async (opts?: any) => {
          internalClosed = true;
          return origInternalClose(opts);
        };
      }

      // 执行 Host 关闭
      await host.close();

      // 验证内部创建的 App 被正常关闭，而外部借用的 App 绝不被关闭
      expect(internalClosed).toBe(true);
      expect(externalClosed).toBe(false);

      // 验证外部借用的 App 依然处于存活可用状态
      const runRes = await externalApp.runAction("ping", {});
      expect(runRes.ok).toBe(true);
      if (runRes.ok) {
        expect(runRes.data).toEqual({ status: "alive" });
      }
    } finally {
      await externalApp.close();
      expect(externalClosed).toBe(true);
    }
  });

  it("子任务启动抛出异常时配额计数正确回滚不泄漏", async () => {
    let callCount = 0;
    const workerAction = defineAction({
      run: () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Simulated worker failure");
        }
        return { fine: true };
      },
    });

    const callerAction = defineAction({
      run: async (_input, ctx) => {
        let firstFailed = false;
        try {
          await ctx.actions.invoke("pkg.quota-rollback/worker", {});
        } catch {
          firstFailed = true;
        }

        const secondRes = await ctx.actions.invoke("pkg.quota-rollback/worker", {});
        return { firstFailed, secondRes };
      },
    });

    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: {
            id: "pkg.quota-rollback",
            name: "配额回退包",
            version: "1.0.0",
            actions: {
              worker: { entry: "" },
              caller: { entry: "" },
            },
          },
          actions: {
            worker: workerAction,
            caller: callerAction,
          },
          inMemory: true,
        },
      ],
      maxSubRuns: 1,
      autoLoadCurrentProject: false,
    });

    try {
      const res = await host.runAction("pkg.quota-rollback/caller", {});
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect((res.data as any).firstFailed).toBe(true);
        expect((res.data as any).secondRes).toEqual({ fine: true });
      }
    } finally {
      await host.close();
    }
  });

  it("包内 describeAction 抛出内部错误时向调用方透传而非伪装 ACTION_NOT_FOUND", async () => {
    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: { id: "pkg.error-app", name: "内部错误包", version: "1.0.0" },
          actions: {
            fine: defineAction({ run: () => ({ ok: true }) }),
          },
          inMemory: true,
        },
        {
          projectConfig: { id: "pkg.good-app", name: "健康包", version: "1.0.0" },
          actions: {
            okAction: defineAction({ run: () => ({ ok: true }) }),
          },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
    });

    // 篡改其中一个 app 的 describeAction 抛出存储损坏类内部错误（非 not-found 语义）
    const errorApp = host.getRuntime("pkg.error-app")!;
    const origDescribe = errorApp.describeAction.bind(errorApp);
    errorApp.describeAction = async (id: string) => {
      if (id === "fine") {
        const err = new Error("STORAGE_BUSY: database is locked");
        (err as any).code = "STORAGE_BUSY";
        throw err;
      }
      return origDescribe(id);
    };

    try {
      // 短标识符遍历遇内部错误时必须透传原始错误，而非 ACTION_NOT_FOUND
      await expect(host.describeAction("fine")).rejects.toThrow("STORAGE_BUSY");

      // 完全限定引用下同样透传
      await expect(host.describeAction("pkg.error-app/fine")).rejects.toThrow("STORAGE_BUSY");

      // 真正不存在的 Action 仍返回 ACTION_NOT_FOUND 语义
      await expect(host.describeAction("missing")).rejects.toThrow("ACTION_NOT_FOUND");
    } finally {
      await host.close();
    }
  });

  it("runAction 遇包内内部错误时向调用方透传而非伪装 ACTION_NOT_FOUND", async () => {
    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: { id: "pkg.err-run", name: "运行错误包", version: "1.0.0" },
          actions: {
            task: defineAction({ run: () => ({ ok: true }) }),
          },
          inMemory: true,
        },
        {
          projectConfig: { id: "pkg.ok-run", name: "运行健康包", version: "1.0.0" },
          actions: {
            other: defineAction({ run: () => ({ ok: true }) }),
          },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
    });

    const errorApp = host.getRuntime("pkg.err-run")!;
    errorApp.executionService.start = async () => {
      const err = new Error("SQLITE_CORRUPT: database disk image is malformed");
      (err as any).code = "SQLITE_CORRUPT";
      throw err;
    };

    try {
      await expect(host.runAction("task", {})).rejects.toThrow("SQLITE_CORRUPT");
    } finally {
      await host.close();
    }
  });
});

