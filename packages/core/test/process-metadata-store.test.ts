import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  MemoryProcessMetadataStore,
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
        assert.strictEqual(notFound, undefined);

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
        assert.notStrictEqual(retrieved, undefined);
        assert.strictEqual(retrieved?.processId, "proc-1");
        assert.strictEqual(retrieved?.tenantId, "tenant-a");
        assert.strictEqual(retrieved?.principalId, "user-1");
        assert.strictEqual(retrieved?.packageInstanceId, "pkg-inst-1");
        assert.strictEqual(retrieved?.generationId, "gen-1");
        assert.strictEqual(retrieved?.hostEpoch, "epoch-100");
        assert.strictEqual(retrieved?.state, "starting");
        assert.strictEqual(retrieved?.controlState, "open");
        assert.strictEqual(retrieved?.control, "open");
        assert.deepStrictEqual(retrieved?.ioConfig, { pty: false, stdin: "pipe", stdout: "pipe" });
        assert.deepStrictEqual(retrieved?.capabilities, { signals: ["SIGTERM", "SIGKILL"] });
        assert.strictEqual(retrieved?.createdAt, "2026-09-13T00:00:00.000Z");
        assert.strictEqual(retrieved?.outputClosed, false);
        assert.deepStrictEqual(retrieved?.effectiveLimits, { memoryBytes: 104857600 });
        assert.strictEqual(retrieved?.startRequestId, "req-start-001");

        // 覆盖保存更新
        await store.saveProcess({
          ...process,
          state: "running",
          outputClosed: true,
        });

        const updated = await store.getProcess("proc-1");
        assert.strictEqual(updated?.state, "running");
        assert.strictEqual(updated?.outputClosed, true);
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
        assert.strictEqual(updated?.state, "stopped");
        assert.strictEqual(updated?.controlState, "closed");
        assert.strictEqual(updated?.control, "closed");
        assert.strictEqual(updated?.exitCode, 0);
        assert.strictEqual(updated?.endReason, "exit");
        assert.strictEqual(updated?.outputClosed, true);
        assert.strictEqual(updated?.outputEndReason, "exit");

        // 更新不存在的进程抛出异常
        let errorThrown = false;
        try {
          await store.updateProcessState("not-found-id", { state: "lost" });
          assert.fail("不应到达此分支");
        } catch (err: any) {
          errorThrown = true;
          assert.ok((err.message).includes("not found"));
        }
        assert.strictEqual(errorThrown, true);
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
        assert.strictEqual(initial?.inputClosed, false);
        assert.strictEqual(initial?.outputClosed, false);

        // 仅关闭输入通道
        await store.updateProcessState("proc-input-closed-1", {
          inputClosed: true,
        });

        const onlyInput = await store.getProcess("proc-input-closed-1");
        assert.strictEqual(onlyInput?.inputClosed, true);
        assert.strictEqual(onlyInput?.outputClosed, false);

        // 覆盖保存时携带 inputClosed
        await store.saveProcess({
          ...process,
          inputClosed: true,
          outputClosed: true,
        });

        const bothClosed = await store.getProcess("proc-input-closed-1");
        assert.strictEqual(bothClosed?.inputClosed, true);
        assert.strictEqual(bothClosed?.outputClosed, true);
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
        assert.strictEqual(page1.processes.length, 2);
        assert.strictEqual(page1.processes[0].processId, "proc-a-5");
        assert.strictEqual(page1.processes[1].processId, "proc-a-4");
        assert.notStrictEqual(page1.nextPageToken, undefined);

        // 第二页（limit = 2）
        const page2 = await store.listProcesses(ownerA, page1.nextPageToken, 2);
        assert.strictEqual(page2.processes.length, 2);
        assert.strictEqual(page2.processes[0].processId, "proc-a-3");
        assert.strictEqual(page2.processes[1].processId, "proc-a-2");
        assert.notStrictEqual(page2.nextPageToken, undefined);

        // 第三页（limit = 2，最后一页仅有 1 条）
        const page3 = await store.listProcesses(ownerA, page2.nextPageToken, 2);
        assert.strictEqual(page3.processes.length, 1);
        assert.strictEqual(page3.processes[0].processId, "proc-a-1");
        assert.strictEqual(page3.nextPageToken, undefined);
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
        assert.strictEqual(notFound, undefined);

        await store.recordRequest(key, receipt, "hash-abcdef");

        const recorded = await store.getRequest(key);
        assert.notStrictEqual(recorded, undefined);
        assert.deepStrictEqual(recorded?.receipt, receipt);
        assert.strictEqual(recorded?.payloadHash, "hash-abcdef");

        // 覆盖更新凭证
        const updatedReceipt = { ...receipt, status: "completed" };
        await store.recordRequest(key, updatedReceipt, "hash-updated");

        const reloaded = await store.getRequest(key);
        assert.strictEqual(reloaded?.receipt.status, "completed");
        assert.strictEqual(reloaded?.payloadHash, "hash-updated");

        // 支持可选 processId（通用作用域请求）
        const globalKey = {
          hostEpoch: "epoch-1",
          scope: "host.maintenance",
          requestId: "req-global-1",
        };
        await store.recordRequest(globalKey, { status: "success" });
        const globalRes = await store.getRequest(globalKey);
        assert.strictEqual(globalRes?.receipt.status, "success");
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
        assert.strictEqual(recoveredCount, 3);

        // 验证旧非终态进程收敛为 lost
        for (const pid of ["p-starting", "p-running", "p-stopping"]) {
          const proc = await store.getProcess(pid);
          assert.strictEqual(proc?.state, "lost");
          assert.strictEqual(proc?.controlState, "closed");
          assert.strictEqual(proc?.control, "closed");
          assert.strictEqual(proc?.endReason, "host-lost");
          assert.strictEqual(proc?.outputClosed, true);
          assert.strictEqual(proc?.outputEndReason, "host-lost");
        }

        // 验证旧终态进程不受影响
        const stoppedProc = await store.getProcess("p-stopped");
        assert.strictEqual(stoppedProc?.state, "stopped");
        assert.strictEqual(stoppedProc?.exitCode, 0);
        assert.strictEqual(stoppedProc?.endReason, "exit");

        // 验证当前宿主进程不受影响
        const currentProc = await store.getProcess("p-current");
        assert.strictEqual(currentProc?.state, "running");
        assert.strictEqual(currentProc?.controlState, "open");
      });
    });
  };

  runStoreTestSuite("MemoryProcessMetadataStore", () => new MemoryProcessMetadataStore());
});
