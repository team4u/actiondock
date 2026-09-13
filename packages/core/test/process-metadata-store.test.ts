import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MemoryProcessMetadataStore,
  SqliteProcessMetadataStore,
  type ProcessMetadataStore,
  type StoredProcessRecord,
} from "../src/process/metadata-store";

describe("ProcessMetadataStore", () => {
  const runStoreTestSuite = (name: string, createStore: () => ProcessMetadataStore | Promise<ProcessMetadataStore>) => {
    describe(name, () => {
      let store: ProcessMetadataStore;

      beforeEach(async () => {
        store = await createStore();
      });

      afterEach(async () => {
        if (store.close) {
          await store.close();
        }
      });

      it("保存并查询受管进程元数据", async () => {
        const notFound = await store.getProcess("non-existent");
        expect(notFound).toBeUndefined();

        const process: StoredProcessRecord = {
          processId: "proc-1",
          tenantId: "tenant-a",
          principalId: "user-1",
          packageInstanceId: "pkg-inst-1",
          generationId: "gen-1",
          hostEpoch: "epoch-100",
          state: "starting",
          controlState: "open",
          control: "open",
          ioConfig: { pty: false, stdin: "pipe", stdout: "pipe" },
          capabilities: { signals: ["SIGTERM", "SIGKILL"] },
          createdAt: "2026-09-13T00:00:00.000Z",
          exitCode: null,
          exitSignal: null,
          endReason: null,
          outputClosed: false,
          outputEndReason: null,
          effectiveLimits: { memoryBytes: 104857600 },
          startRequestId: "req-start-001",
        };

        await store.saveProcess(process);

        const retrieved = await store.getProcess("proc-1");
        expect(retrieved).toBeDefined();
        expect(retrieved?.processId).toBe("proc-1");
        expect(retrieved?.tenantId).toBe("tenant-a");
        expect(retrieved?.principalId).toBe("user-1");
        expect(retrieved?.packageInstanceId).toBe("pkg-inst-1");
        expect(retrieved?.generationId).toBe("gen-1");
        expect(retrieved?.hostEpoch).toBe("epoch-100");
        expect(retrieved?.state).toBe("starting");
        expect(retrieved?.controlState).toBe("open");
        expect(retrieved?.control).toBe("open");
        expect(retrieved?.ioConfig).toEqual({ pty: false, stdin: "pipe", stdout: "pipe" });
        expect(retrieved?.capabilities).toEqual({ signals: ["SIGTERM", "SIGKILL"] });
        expect(retrieved?.createdAt).toBe("2026-09-13T00:00:00.000Z");
        expect(retrieved?.outputClosed).toBe(false);
        expect(retrieved?.effectiveLimits).toEqual({ memoryBytes: 104857600 });
        expect(retrieved?.startRequestId).toBe("req-start-001");

        // 覆盖保存更新
        await store.saveProcess({
          ...process,
          state: "running",
          outputClosed: true,
        });

        const updated = await store.getProcess("proc-1");
        expect(updated?.state).toBe("running");
        expect(updated?.outputClosed).toBe(true);
      });

      it("局部更新受管进程状态字段", async () => {
        const process: StoredProcessRecord = {
          processId: "proc-update-1",
          tenantId: "tenant-a",
          principalId: "user-1",
          packageInstanceId: "pkg-inst-1",
          generationId: "gen-1",
          hostEpoch: "epoch-100",
          state: "starting",
          controlState: "open",
        };

        await store.saveProcess(process);

        await store.updateProcessState("proc-update-1", {
          state: "stopped",
          controlState: "closed",
          exitCode: 0,
          endReason: "exit",
          outputClosed: true,
          outputEndReason: "exit",
        });

        const updated = await store.getProcess("proc-update-1");
        expect(updated?.state).toBe("stopped");
        expect(updated?.controlState).toBe("closed");
        expect(updated?.control).toBe("closed");
        expect(updated?.exitCode).toBe(0);
        expect(updated?.endReason).toBe("exit");
        expect(updated?.outputClosed).toBe(true);
        expect(updated?.outputEndReason).toBe("exit");

        // 更新不存在的进程抛出异常
        let errorThrown = false;
        try {
          await store.updateProcessState("not-found-id", { state: "lost" });
        } catch (err: any) {
          errorThrown = true;
          expect(err.message).toContain("not found");
        }
        expect(errorThrown).toBe(true);
      });

      it("独立持久化 inputClosed 字段且不与 outputClosed 混淆", async () => {
        const process: StoredProcessRecord = {
          processId: "proc-input-closed-1",
          tenantId: "tenant-a",
          principalId: "user-1",
          packageInstanceId: "pkg-inst-1",
          generationId: "gen-1",
          hostEpoch: "epoch-100",
          state: "running",
          controlState: "open",
        };

        await store.saveProcess(process);

        // 初始两者均为 false
        const initial = await store.getProcess("proc-input-closed-1");
        expect(initial?.inputClosed).toBe(false);
        expect(initial?.outputClosed).toBe(false);

        // 仅关闭输入通道
        await store.updateProcessState("proc-input-closed-1", {
          inputClosed: true,
        });

        const onlyInput = await store.getProcess("proc-input-closed-1");
        expect(onlyInput?.inputClosed).toBe(true);
        expect(onlyInput?.outputClosed).toBe(false);

        // 覆盖保存时携带 inputClosed
        await store.saveProcess({
          ...process,
          inputClosed: true,
          outputClosed: true,
        });

        const bothClosed = await store.getProcess("proc-input-closed-1");
        expect(bothClosed?.inputClosed).toBe(true);
        expect(bothClosed?.outputClosed).toBe(true);
      });

      it("根据所有者过滤并分页查询进程列表", async () => {
        const ownerA = {
          tenantId: "tenant-filter",
          principalId: "user-filter",
          packageInstanceId: "pkg-filter",
          generationId: "gen-filter",
        };

        const otherOwner = {
          tenantId: "other-tenant",
          principalId: "other-user",
          packageInstanceId: "pkg-filter",
          generationId: "gen-filter",
        };

        // 插入属于 ownerA 的 5 条记录，以及属于 otherOwner 的 1 条记录
        for (let i = 1; i <= 5; i++) {
          await store.saveProcess({
            processId: `proc-a-${i}`,
            tenantId: ownerA.tenantId,
            principalId: ownerA.principalId,
            packageInstanceId: ownerA.packageInstanceId,
            generationId: ownerA.generationId,
            hostEpoch: "epoch-1",
            state: "running",
            createdAt: `2026-09-13T00:0${i}:00.000Z`,
          });
        }

        await store.saveProcess({
          processId: "proc-other-1",
          tenantId: otherOwner.tenantId,
          principalId: otherOwner.principalId,
          packageInstanceId: otherOwner.packageInstanceId,
          generationId: otherOwner.generationId,
          hostEpoch: "epoch-1",
          state: "running",
          createdAt: "2026-09-13T00:09:00.000Z",
        });

        // 第一页（limit = 2）
        const page1 = await store.listProcesses(ownerA, undefined, 2);
        expect(page1.processes.length).toBe(2);
        expect(page1.processes[0].processId).toBe("proc-a-5");
        expect(page1.processes[1].processId).toBe("proc-a-4");
        expect(page1.nextPageToken).toBeDefined();

        // 第二页（limit = 2）
        const page2 = await store.listProcesses(ownerA, page1.nextPageToken, 2);
        expect(page2.processes.length).toBe(2);
        expect(page2.processes[0].processId).toBe("proc-a-3");
        expect(page2.processes[1].processId).toBe("proc-a-2");
        expect(page2.nextPageToken).toBeDefined();

        // 第三页（limit = 2，最后一页仅有 1 条）
        const page3 = await store.listProcesses(ownerA, page2.nextPageToken, 2);
        expect(page3.processes.length).toBe(1);
        expect(page3.processes[0].processId).toBe("proc-a-1");
        expect(page3.nextPageToken).toBeUndefined();
      });

      it("记录与获取幂等操作请求凭证", async () => {
        const key = {
          hostEpoch: "epoch-1",
          scope: "process.start",
          processId: "proc-req-1",
          requestId: "req-123456",
        };

        const receipt = {
          status: "accepted",
          processId: "proc-req-1",
          timestamp: "2026-09-13T00:00:00.000Z",
        };

        const notFound = await store.getRequest(key);
        expect(notFound).toBeUndefined();

        await store.recordRequest(key, receipt, "hash-abcdef");

        const recorded = await store.getRequest(key);
        expect(recorded).toBeDefined();
        expect(recorded?.receipt).toEqual(receipt);
        expect(recorded?.payloadHash).toBe("hash-abcdef");

        // 覆盖更新凭证
        const updatedReceipt = { ...receipt, status: "completed" };
        await store.recordRequest(key, updatedReceipt, "hash-updated");

        const reloaded = await store.getRequest(key);
        expect(reloaded?.receipt.status).toBe("completed");
        expect(reloaded?.payloadHash).toBe("hash-updated");

        // 支持可选 processId（通用作用域请求）
        const globalKey = {
          hostEpoch: "epoch-1",
          scope: "host.maintenance",
          requestId: "req-global-1",
        };
        await store.recordRequest(globalKey, { status: "success" });
        const globalRes = await store.getRequest(globalKey);
        expect(globalRes?.receipt.status).toBe("success");
      });

      it("宿主生命周期初始化原子性收敛旧宿主遗留的非终态进程为 lost", async () => {
        const oldEpoch = "host-epoch-1";
        const currentEpoch = "host-epoch-2";

        // 旧宿主遗留的三个非终态进程（starting / running / stopping）
        await store.saveProcess({
          processId: "p-starting",
          tenantId: "t1",
          principalId: "u1",
          packageInstanceId: "pkg1",
          generationId: "g1",
          hostEpoch: oldEpoch,
          state: "starting",
          controlState: "open",
        });

        await store.saveProcess({
          processId: "p-running",
          tenantId: "t1",
          principalId: "u1",
          packageInstanceId: "pkg1",
          generationId: "g1",
          hostEpoch: oldEpoch,
          state: "running",
          controlState: "open",
        });

        await store.saveProcess({
          processId: "p-stopping",
          tenantId: "t1",
          principalId: "u1",
          packageInstanceId: "pkg1",
          generationId: "g1",
          hostEpoch: oldEpoch,
          state: "stopping",
          controlState: "closing",
        });

        // 旧宿主已正常退出的终态进程（stopped）
        await store.saveProcess({
          processId: "p-stopped",
          tenantId: "t1",
          principalId: "u1",
          packageInstanceId: "pkg1",
          generationId: "g1",
          hostEpoch: oldEpoch,
          state: "stopped",
          controlState: "closed",
          exitCode: 0,
          endReason: "exit",
          outputClosed: true,
          outputEndReason: "exit",
        });

        // 新宿主启动的正常进程（running）
        await store.saveProcess({
          processId: "p-current",
          tenantId: "t1",
          principalId: "u1",
          packageInstanceId: "pkg1",
          generationId: "g1",
          hostEpoch: currentEpoch,
          state: "running",
          controlState: "open",
        });

        // 执行新宿主初始化
        const recoveredCount = await store.initializeHost(currentEpoch);
        expect(recoveredCount).toBe(3);

        // 验证旧非终态进程收敛为 lost
        for (const pid of ["p-starting", "p-running", "p-stopping"]) {
          const proc = await store.getProcess(pid);
          expect(proc?.state).toBe("lost");
          expect(proc?.controlState).toBe("closed");
          expect(proc?.control).toBe("closed");
          expect(proc?.endReason).toBe("host-lost");
          expect(proc?.outputClosed).toBe(true);
          expect(proc?.outputEndReason).toBe("host-lost");
        }

        // 验证旧终态进程不受影响
        const stoppedProc = await store.getProcess("p-stopped");
        expect(stoppedProc?.state).toBe("stopped");
        expect(stoppedProc?.exitCode).toBe(0);
        expect(stoppedProc?.endReason).toBe("exit");

        // 验证当前宿主进程不受影响
        const currentProc = await store.getProcess("p-current");
        expect(currentProc?.state).toBe("running");
        expect(currentProc?.controlState).toBe("open");
      });
    });
  };

  runStoreTestSuite("MemoryProcessMetadataStore", () => new MemoryProcessMetadataStore());

  runStoreTestSuite("SqliteProcessMetadataStore (内存模式)", () => new SqliteProcessMetadataStore({ dbPath: ":memory:" }));

  describe("SqliteProcessMetadataStore 文件持久化与重启恢复验证", () => {
    const testDbPath = join(tmpdir(), `ad-process-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

    afterEach(() => {
      if (existsSync(testDbPath)) {
        try {
          rmSync(testDbPath, { force: true });
        } catch {
          // 忽略临时文件清理异常
        }
      }
    });

    it("旧库结构自动迁移补充 input_closed 列", async () => {
      const store1 = new SqliteProcessMetadataStore({ dbPath: testDbPath });
      store1.close();

      // 手工回退到旧结构：删除 input_closed 列不可行，改为直接重建旧表
      const storeOld = new SqliteProcessMetadataStore({ dbPath: testDbPath });
      (storeOld as any).driver.exec("DROP TABLE IF EXISTS managed_processes;");
      (storeOld as any).driver.exec(`
        CREATE TABLE managed_processes (
          process_id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          principal_id TEXT NOT NULL,
          package_instance_id TEXT NOT NULL,
          generation_id TEXT NOT NULL,
          host_epoch TEXT NOT NULL,
          state TEXT NOT NULL,
          control_state TEXT,
          io_config_json TEXT,
          capabilities_json TEXT,
          created_at TEXT NOT NULL,
          exit_code INTEGER,
          exit_signal TEXT,
          end_reason TEXT,
          output_closed INTEGER NOT NULL DEFAULT 0,
          output_end_reason TEXT,
          effective_limits_json TEXT,
          start_request_id TEXT
        );
      `);
      storeOld.close();

      // 新实例启动时自动执行列迁移
      const store2 = new SqliteProcessMetadataStore({ dbPath: testDbPath });
      await store2.saveProcess({
        processId: "proc-migrated",
        tenantId: "tenant-m",
        principalId: "user-m",
        packageInstanceId: "pkg-m",
        generationId: "gen-m",
        hostEpoch: "epoch-m",
        state: "running",
        controlState: "open",
      });
      await store2.updateProcessState("proc-migrated", { inputClosed: true });

      const loaded = await store2.getProcess("proc-migrated");
      expect(loaded?.inputClosed).toBe(true);
      expect(loaded?.outputClosed).toBe(false);

      store2.close();
    });

    it("持久化到磁盘并在重新创建存储实例后恢复元数据", async () => {
      const store1 = new SqliteProcessMetadataStore({ dbPath: testDbPath });

      await store1.saveProcess({
        processId: "proc-persisted",
        tenantId: "tenant-p",
        principalId: "user-p",
        packageInstanceId: "pkg-p",
        generationId: "gen-p",
        hostEpoch: "epoch-old",
        state: "running",
        controlState: "open",
        ioConfig: { terminal: true },
      });

      store1.close();

      // 新建实例读取相同数据库文件
      const store2 = new SqliteProcessMetadataStore({ dbPath: testDbPath });

      const loaded = await store2.getProcess("proc-persisted");
      expect(loaded).toBeDefined();
      expect(loaded?.processId).toBe("proc-persisted");
      expect(loaded?.state).toBe("running");
      expect(loaded?.ioConfig).toEqual({ terminal: true });

      // 新宿主接管并收敛旧宿主崩溃遗留进程
      const recovered = await store2.initializeHost("epoch-new");
      expect(recovered).toBe(1);

      const recoveredProc = await store2.getProcess("proc-persisted");
      expect(recoveredProc?.state).toBe("lost");
      expect(recoveredProc?.endReason).toBe("host-lost");

      store2.close();
    });

    it("关闭存储后阻止继续执行写入或查询", async () => {
      const store = new SqliteProcessMetadataStore({ dbPath: ":memory:" });
      store.close();

      let errThrown = false;
      try {
        await store.getProcess("proc-1");
      } catch (err: any) {
        errThrown = true;
        expect(err.message).toContain("closed");
      }
      expect(errThrown).toBe(true);
    });
  });
});
