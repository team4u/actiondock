import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import type { ProcessAPI } from "@actiondock/sdk";
import { DefaultPackageRuntime } from "../src/package/runtime";
import { createActionDockHost } from "../src/host/host";
import { createNodePlatform } from "../src/platform/node";
import type { RuntimePlatform } from "../src/platform/types";
import type { RuntimeStorage } from "../src/storage/types";
import type { ProcessDriver } from "../src/process/driver";
import type { ModuleLoader } from "../src/platform/module-loader";
import { defineAction } from "@actiondock/sdk";

/**
 * 按需装配资源边界测试：旁观发现零资源创建、状态查询只开目标包存储、
 * 执行才创建执行服务、平台访问器不提前求值。
 */

interface ResourceCounters {
  packageStorages: number;
  globalStorages: number;
  processApis: number;
  moduleLoaders: number;
}

function createCountingPlatform(counters: ResourceCounters): RuntimePlatform {
  const base = createNodePlatform();
  let processApi: ProcessAPI | undefined;
  let moduleLoader: ModuleLoader | undefined;
  return {
    name: "node",
    clock: base.clock,
    get process(): ProcessAPI {
      counters.processApis++;
      if (!processApi) {
        processApi = {
          run: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
          start: () => {
            throw new Error("not implemented in probe platform");
          },
        } as unknown as ProcessAPI;
      }
      return processApi;
    },
    get modules(): ModuleLoader {
      counters.moduleLoaders++;
      if (!moduleLoader) {
        moduleLoader = {
          load: async () => {
            throw new Error("not implemented in probe platform");
          },
        } as ModuleLoader;
      }
      return moduleLoader;
    },
    storage: {
      createStorage: (): RuntimeStorage => {
        counters.packageStorages++;
        throw new Error("STORAGE_FACTORY_TOUCHED: discovery must not create package storage");
      },
      createGlobalStorage: (): RuntimeStorage => {
        counters.globalStorages++;
        throw new Error("GLOBAL_STORAGE_TOUCHED: discovery must not create global storage");
      },
    },
    eventSink: undefined,
  };
}

describe("按需装配资源边界", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-on-demand-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("旁观包对象静态发现：存储、全局库、进程接口与模块加载器创建均为零", async () => {
    const counters: ResourceCounters = {
      packageStorages: 0,
      globalStorages: 0,
      processApis: 0,
      moduleLoaders: 0,
    };
    const platform = createCountingPlatform(counters);

    const runtime = new DefaultPackageRuntime({
      projectConfig: {
        id: "pkg.on-demand-probe",
        name: "Probe",
        version: "1.0.0",
        actions: {
          ping: { entry: "", description: "ping action" },
        },
      },
      platform,
      recoverOrphans: false,
    });

    // 静态发现三件套全程零资源
    const info = await runtime.info();
    assert.strictEqual(info.id, "pkg.on-demand-probe");

    const actions = await runtime.listActions();
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].id, "ping");

    const spec = await runtime.describeAction("ping");
    assert.strictEqual(spec.description, "ping action");

    const playbooks = await runtime.listPlaybooks();
    assert.strictEqual(playbooks.length, 0);

    assert.strictEqual(counters.packageStorages, 0);
    assert.strictEqual(counters.globalStorages, 0);
    assert.strictEqual(counters.processApis, 0);
    assert.strictEqual(counters.moduleLoaders, 0);

    await runtime.close();
    // 关闭后资源创建计数仍为零
    assert.strictEqual(counters.packageStorages, 0);
    assert.strictEqual(counters.globalStorages, 0);

    // 关闭后任一端口返回 SERVICE_CLOSED
    await assert.rejects(runtime.listRuns(), /is closed/);
  });

  it("旁观 Host 发现：不预热存储，数据目录不被创建", async () => {
    const dataDir = join(tempDir, "should-not-exist");
    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: {
            id: "pkg.discovery-only",
            actions: { probe: { entry: "" } },
          },
          actions: { probe: defineAction({ run: () => "ok" }) },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
      recoverOrphans: false,
      dataDir,
    });

    const summaries = await host.listActions();
    assert.strictEqual(summaries.length, 1);

    // 旁观 Host 不获取执行宿主的数据目录锁，也不创建数据目录
    assert.strictEqual(existsSync(dataDir), false);
    await host.close();
  });

  it("默认持有者 Host：存储在工厂返回前预热，未执行的包不创建执行服务", async () => {
    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: {
            id: "pkg.owner-prewarm",
            actions: { probe: { entry: "" } },
          },
          actions: { probe: defineAction({ run: () => "ok" }) },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
      // 默认 recoverOrphans: true 持有者语义
    });

    const runtime = host.getRuntime("pkg.owner-prewarm")!;
    // 持有者预热的是存储：状态查询已可用（不创建执行服务）
    const keys = await runtime.listStateKeys();
    assert.deepStrictEqual(keys, []);
    // 执行服务尚未创建（未执行过任何 Action）
    assert.strictEqual((runtime as any).peekExecutionService(), undefined);

    // 执行后才创建执行服务
    const res = await host.runAction("pkg.owner-prewarm/probe", {});
    assert.strictEqual(res.ok, true);
    assert.notStrictEqual((runtime as any).peekExecutionService(), undefined);

    await host.close();
  });

  it("状态与历史查询只打开目标包存储，不创建执行服务", async () => {
    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: {
            id: "pkg.state-query",
            actions: { probe: { entry: "" } },
          },
          actions: { probe: defineAction({ run: () => "ok" }) },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
      recoverOrphans: false,
    });

    const runtime = host.getRuntime("pkg.state-query")!;

    await runtime.setState("counter", 42);
    const value = await runtime.getState("counter");
    assert.strictEqual(value, 42);

    await runtime.setConfig("threshold", "high");
    const config = await runtime.getConfig("threshold");
    assert.strictEqual(config.value, "high");

    const runs = await runtime.listRuns();
    assert.strictEqual(runs.length, 0);

    // 全程不创建执行服务
    assert.strictEqual((runtime as any).peekExecutionService(), undefined);
    await host.close();
  });

  it("包未创建执行服务时取消与事件查询不创建执行服务", async () => {
    const host = await createActionDockHost({
      packages: [
        {
          projectConfig: {
            id: "pkg.cancel-probe",
            actions: { probe: { entry: "" } },
          },
          actions: { probe: defineAction({ run: () => "ok" }) },
          inMemory: true,
        },
      ],
      autoLoadCurrentProject: false,
      recoverOrphans: false,
    });

    const runtime = host.getRuntime("pkg.cancel-probe")!;

    // 未执行过任何任务：取消返回 not_found，不创建执行服务
    const cancelRes = await runtime.cancelRun("run-nonexistent");
    assert.strictEqual(cancelRes.outcome, "not_found");
    assert.strictEqual((runtime as any).peekExecutionService(), undefined);

    // 事件订阅句柄不新建执行服务（空流由调用方自行终止，不等待未来事件）
    const iter = runtime.events("run-nonexistent");
    assert.strictEqual(typeof iter[Symbol.asyncIterator], "function");
    assert.strictEqual((runtime as any).peekExecutionService(), undefined);

    await host.close();
  });

  it("createNodePlatform 访问器不提前创建进程接口与模块加载器", () => {
    const platform = createNodePlatform();
    // 仅创建平台对象不触发任何执行组件
    assert.strictEqual(typeof platform.storage.createStorage, "function");
    // clock 立即可用
    assert.strictEqual(typeof platform.clock.now, "function");
    // process 与 modules 为缓存访问器：重复访问返回同一实例
    const p1 = platform.process;
    const p2 = platform.process;
    assert.strictEqual(p1, p2);
    const m1 = platform.modules;
    const m2 = platform.modules;
    assert.strictEqual(m1, m2);
  });

  it("旁观发现遇待恢复事务返回 PROJECT_RECOVERY_REQUIRED 且不修改清单", async () => {
    const projectRoot = join(tempDir, "pending-tx-project");
    mkdirSync(join(projectRoot, ".actiondock", "transactions", "tx-1"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".actiondock", "transactions", "tx-1", "transaction.json"),
      JSON.stringify({ id: "tx-1", status: "pending", createdAt: Date.now(), files: [] }),
      "utf-8"
    );
    writeFileSync(
      join(projectRoot, "actiondock.json"),
      JSON.stringify({ specVersion: 2, id: "pkg.pending-tx", name: "Pending", version: "0.1.0", actions: {} }),
      "utf-8"
    );

    // 旁观 Host：报告恢复需求，不自动恢复
    await assert.rejects(
      createActionDockHost({
        projectRoot,
        autoLoadCurrentProject: true,
        recoverOrphans: false,
      }),
      (err: any) => err?.code === "PROJECT_RECOVERY_REQUIRED"
    );

    // 待恢复事务标记未被清除
    const txMeta = JSON.parse(
      await import("node:fs").then((fs) => fs.readFileSync(join(projectRoot, ".actiondock", "transactions", "tx-1", "transaction.json"), "utf-8"))
    );
    assert.strictEqual(txMeta.status, "pending");
  });
});
