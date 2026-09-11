import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ActionContext, defineAction } from "@actiondock/sdk";
import { createActionDockApp } from "../src/app";
import { createActionDockHost, DefaultActionDockHost } from "../src/host";

describe("ActionDockHost 多包宿主容器", () => {
  it("初始化并支持 ActionDockApp 实例与 ActionDockAppOptions 配置混合注册", async () => {
    const mathAddAction = defineAction({
      run: (input: { a: number; b: number }) => ({ sum: input.a + input.b }),
    });

    const appA = await createActionDockApp({
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
    const apps = host.listApps();
    expect(apps.length).toBe(2);

    const mathApp = host.getApp("pkg.math");
    expect(mathApp).toBeDefined();
    expect(mathApp?.packageId).toBe("pkg.math");

    const strApp = host.getApp("pkg.string");
    expect(strApp).toBeDefined();
    expect(strApp?.packageId).toBe("pkg.string");

    const unknownApp = host.getApp("pkg.unknown");
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

      const autoApp = host.getApp("pkg.auto");
      expect(autoApp).toBeDefined();
      expect(autoApp?.packageId).toBe("pkg.auto");

      // 注册同名冲突包抛出异常
      const duplicateApp = await createActionDockApp({
        projectConfig: {
          id: "pkg.auto",
          name: "同名冲突包",
          version: "1.2.0",
        },
        inMemory: true,
      });

      expect(() => host.registerApp(duplicateApp)).toThrow(
        "Package ID conflict: package 'pkg.auto' is already registered in host"
      );

      // 重复注册同一实例为幂等无害操作
      host.registerApp(autoApp!);

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
    expect(host.describeAction("search")).rejects.toThrow("AMBIGUOUS_ACTION_REF");

    // 8. 不存在的 Action 抛出异常
    expect(host.describeAction("missing")).rejects.toThrow("ACTION_NOT_FOUND");
    expect(host.describeAction("pkg.none/action")).rejects.toThrow("Package 'pkg.none' not found in host");

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

    // 3. 通过 host.runAction 带 parentRunId 显式模拟跨包调用校验
    // 创建一个模拟 parentRun，指向 service.caller 的 undeclared-caller
    const callerApp = host.getApp("service.caller")!;
    const mockParentRunId = "mock-parent-run-id";
    callerApp.storage.createRun({
      id: mockParentRunId,
      rootRunId: mockParentRunId,
      packageId: "service.caller",
      packageInstanceId: "service.caller",
      actionId: "undeclared-caller",
      generationId: "1",
      ownerId: "test-owner",
      status: "running",
      input: {},
      startedAt: new Date().toISOString(),
    });

    const directCheckRes = await host.runAction("service.worker/worker-task", { num: 3 }, {
      parentRunId: mockParentRunId,
    });
    expect(directCheckRes.ok).toBe(false);
    if (!directCheckRes.ok) {
      expect(directCheckRes.error.code).toBe("UNDECLARED_ACTION_DEPENDENCY");
    }

    await host.close();
  });

  it("统一限制调用深度与根运行子任务数配额", async () => {
    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: { id: "pkg.depth", name: "深度测试包", version: "1.0.0" },
          actions: {
            step: defineAction({
              run: () => ({ done: true }),
            }),
          },
          inMemory: true,
        },
      ],
      maxCallDepth: 3,
      maxSubRuns: 2,
      autoLoadCurrentProject: false,
    });

    const app = host.getApp("pkg.depth")!;

    // 1. 模拟构建深度达到 3 层的调用链
    const run0 = "depth-run-0";
    const run1 = "depth-run-1";
    const run2 = "depth-run-2";
    const now = new Date().toISOString();

    app.storage.createRun({
      id: run0,
      rootRunId: run0,
      packageId: "pkg.depth",
      packageInstanceId: "pkg.depth",
      actionId: "step",
      generationId: "1",
      ownerId: "tester",
      status: "running",
      startedAt: now,
    });

    app.storage.createRun({
      id: run1,
      rootRunId: run0,
      parentRunId: run0,
      packageId: "pkg.depth",
      packageInstanceId: "pkg.depth",
      actionId: "step",
      generationId: "1",
      ownerId: "tester",
      status: "running",
      startedAt: now,
    });

    app.storage.createRun({
      id: run2,
      rootRunId: run0,
      parentRunId: run1,
      packageId: "pkg.depth",
      packageInstanceId: "pkg.depth",
      actionId: "step",
      generationId: "1",
      ownerId: "tester",
      status: "running",
      startedAt: now,
    });

    // 此时从 run2 继续发起子任务将超过 maxCallDepth (3)
    const depthExceeded = await host.runAction("pkg.depth/step", {}, { parentRunId: run2 });
    expect(depthExceeded.ok).toBe(false);
    if (!depthExceeded.ok) {
      expect(["ACTION_CALL_CYCLE", "ACTION_MAX_DEPTH_EXCEEDED"]).toContain(depthExceeded.error.code);
    }

    // 2. 测试子任务数限额 (maxSubRuns: 2)
    // 启动长时间运行的动作
    const slowAction = defineAction({
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { finished: true };
      },
    });
    (app.executionService as any).registerAction("slow", slowAction);

    const rootRunId = "root-limit-test";
    app.storage.createRun({
      id: rootRunId,
      rootRunId,
      packageId: "pkg.depth",
      packageInstanceId: "pkg.depth",
      actionId: "step",
      generationId: "1",
      ownerId: "tester",
      status: "running",
      startedAt: now,
    });

    const sub1 = await host.startAction("pkg.depth/slow", {}, { parentRunId: rootRunId });
    const sub2 = await host.startAction("pkg.depth/slow", {}, { parentRunId: rootRunId });
    // 此时活跃子任务已达到 2 个，发起第 3 个应受限
    const sub3 = await host.startAction("pkg.depth/slow", {}, { parentRunId: rootRunId });
    const sub3Res = await sub3.result!;
    expect(sub3Res.ok).toBe(false);
    if (!sub3Res.ok) {
      expect(["ACTION_SUBRUN_LIMIT", "MAX_SUBRUNS_REACHED"]).toContain(sub3Res.error.code);
    }

    await sub1.result;
    await sub2.result;
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
      const app = host.getApp("openclaw.test-tool");
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
});
