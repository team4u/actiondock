import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ActionDockError } from "../src/errors";

/**
 * IPC 运行记录读取取消链路测试。
 *
 * 验证：
 * - 传入已取消的 signal 时立即抛错（AbortError），不发送 IPC 查询，亦不返回记录；
 * - 在途发起的 list / get 请求携带 signal，外部触发取消时在途查询被有效中止并抛出 AbortError；
 * - 宿主侧成功反序列化并绑定 AbortController，确保取消信号在两端有效传播。
 */

const HOST_SCRIPT = `
import { createActionDock, ActionDockError } from "@actiondock/core";
import { serveParentIpc } from "@actiondock/core/server";

async function runHost() {
  let listCallCount = 0;
  let getCallCount = 0;

  const baseService = await createActionDock({
    runtimeOptions: {
      projectConfig: {
        id: "test.ipc-runs-cancel-pkg",
        name: "IPC Runs Cancel Test",
        version: "1.0.0",
      },
      inMemory: true,
    },
  });

  const service = {
    ...baseService,
    runs: {
      ...baseService.runs,
      async list(query, options) {
        listCallCount++;
        const signal = options?.signal ?? query?.signal;
        process.send?.({ type: "test-list-called", count: listCallCount, hasSignal: Boolean(signal) });
        if (query?.triggerStorageClosed) {
          throw new ActionDockError(
            "STORAGE_CLOSED",
            "Storage operation aborted: storage is already closed",
            { reason: "closed" }
          );
        }
        if (query?.triggerExplicitAbortError) {
          const err = new Error("Explicit query abort");
          err.name = "AbortError";
          throw err;
        }
        if (query?.triggerExecutionAbortedCode) {
          throw new ActionDockError("EXECUTION_ABORTED", "Query execution was aborted");
        }
        if (query?.triggerOperationAbortedCode) {
          throw new ActionDockError("OPERATION_ABORTED", "Query operation was aborted");
        }
        if (query?.triggerAbortErrCode) {
          const err = new Error("Query abort err code");
          (err as any).code = "ABORT_ERR";
          throw err;
        }
        if (query?.triggerGenericAbortedError) {
          throw new Error("Generic operation aborted by unknown internal condition");
        }
        if (query?.slow) {
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve([{ id: "slow-record" }]), 15000);
            signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              process.send?.({ type: "test-list-aborted" });
              const err = new Error("List query was aborted");
              err.name = "AbortError";
              reject(err);
            });
          });
        }
        return [{ id: "mock-run-1", actionId: "test-action", packageId: "test.ipc-runs-cancel-pkg", status: "completed", startedAt: new Date().toISOString() }];
      },
      async get(runId, options) {
        getCallCount++;
        const signal = options?.signal;
        process.send?.({ type: "test-get-called", count: getCallCount, hasSignal: Boolean(signal) });
        if (runId === "storage-closed-run") {
          throw new ActionDockError(
            "STORAGE_CLOSED",
            "Storage operation aborted: storage is already closed",
            { reason: "closed" }
          );
        }
        if (runId === "slow-run") {
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve({ id: "slow-run" }), 15000);
            signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              process.send?.({ type: "test-get-aborted" });
              const err = new Error("Get query was aborted");
              err.name = "AbortError";
              reject(err);
            });
          });
        }
        return { id: runId, actionId: "test-action", packageId: "test.ipc-runs-cancel-pkg", status: "completed", startedAt: new Date().toISOString() };
      },
    },
  };

  await serveParentIpc(service);
}

runHost().catch((err) => {
  console.error("Host error:", err);
  process.exit(1);
});
`;

describe("IPC runs cancellation chain", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "ipc-runs-cancel-test-"));
  writeFileSync(join(tempDir, "package.json"), JSON.stringify({ type: "module" }));
  const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
  if (existsSync(rootNodeModules) && !existsSync(join(tempDir, "node_modules"))) {
    symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
  }
  let hostChild: ChildProcess | undefined;

  after(() => {
    if (hostChild && hostChild.exitCode === null) {
      hostChild.kill("SIGKILL");
    }
    try {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      // 忽略临时文件清理异常
    }
  });

  it("handles pre-aborted signal immediately without sending IPC queries and handles in-flight cancellation", { timeout: 20000 }, async () => {
    const hostScriptPath = join(tempDir, "ipc-runs-cancel-host.ts");
    writeFileSync(hostScriptPath, HOST_SCRIPT);

    const { IpcActionDockService } = await import("../src/ipc/service");
    const service = new IpcActionDockService({
      scriptPath: hostScriptPath,
      cwd: tempDir,
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    } as ConstructorParameters<typeof IpcActionDockService>[0]);
    hostChild = service.process;

    const receivedMessages: any[] = [];
    hostChild!.on("message", (msg: any) => {
      if (msg && typeof msg === "object" && typeof msg.type === "string" && msg.type.startsWith("test-")) {
        receivedMessages.push(msg);
      }
    });

    const waitForHostMessage = async (type: string, timeoutMs = 5000): Promise<any> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const found = receivedMessages.find((m) => m.type === type);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`Timed out waiting for host message of type '${type}'`);
    };

    await service.waitReady();

    // 1. 验证提前取消的 signal 传入 runs.list 与 runs.get：立即抛错、不发送 IPC 查询也不返回记录
    const preAbortedController = new AbortController();
    preAbortedController.abort();

    // 记录当前子进程发送的 IPC 消息数
    let sentCallMessagesCount = 0;
    const originalSend = hostChild!.send.bind(hostChild!);
    (hostChild as any).send = function (msg: any, ...args: any[]) {
      if (msg && msg.type === "call" && (msg.method === "listRuns" || msg.method === "getRun")) {
        sentCallMessagesCount++;
      }
      return (originalSend as any)(msg, ...args);
    };

    // 1.1 runs.list(query, { signal: preAborted })
    await assert.rejects(
      service.runs.list(undefined, { signal: preAbortedController.signal }),
      (err: any) => {
        assert.strictEqual(err.name, "AbortError");
        return true;
      }
    );

    // 1.2 runs.list({ signal: preAborted })
    await assert.rejects(
      service.runs.list({ signal: preAbortedController.signal }),
      (err: any) => {
        assert.strictEqual(err.name, "AbortError");
        return true;
      }
    );

    // 1.3 runs.get(runId, { signal: preAborted })
    await assert.rejects(
      service.runs.get("run-1", { signal: preAbortedController.signal }),
      (err: any) => {
        assert.strictEqual(err.name, "AbortError");
        return true;
      }
    );

    // 1.4 runs.list 与 runs.get 传入 AbortSignal.timeout(1) 产生的 DOMException 作为 reason
    const timeoutSignal = AbortSignal.timeout(1);
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(timeoutSignal.aborted, true);
    assert.ok(timeoutSignal.reason instanceof Error);
    const domException = timeoutSignal.reason;

    await assert.rejects(
      service.runs.list(undefined, { signal: timeoutSignal }),
      (err: any) => {
        assert.strictEqual(err.name, "AbortError");
        assert.notStrictEqual(err.name, "TypeError");
        assert.strictEqual(err.cause, domException);
        assert.strictEqual((domException as any).name, "TimeoutError");
        return true;
      }
    );

    await assert.rejects(
      service.runs.list({ signal: timeoutSignal }),
      (err: any) => {
        assert.strictEqual(err.name, "AbortError");
        assert.notStrictEqual(err.name, "TypeError");
        assert.strictEqual(err.cause, domException);
        return true;
      }
    );

    await assert.rejects(
      service.runs.get("run-1", { signal: timeoutSignal }),
      (err: any) => {
        assert.strictEqual(err.name, "AbortError");
        assert.notStrictEqual(err.name, "TypeError");
        assert.strictEqual(err.cause, domException);
        assert.strictEqual((domException as any).name, "TimeoutError");
        return true;
      }
    );

    // 1.5 runs.list 与 runs.get 传入字符串 reason（如 controller.abort("custom cancel")）
    const customAbortController = new AbortController();
    customAbortController.abort("custom cancel");

    await assert.rejects(
      service.runs.list(undefined, { signal: customAbortController.signal }),
      (err: any) => {
        assert.strictEqual(err.name, "AbortError");
        assert.strictEqual(err.cause, "custom cancel");
        assert.strictEqual(err.message, "custom cancel");
        return true;
      }
    );

    await assert.rejects(
      service.runs.get("run-1", { signal: customAbortController.signal }),
      (err: any) => {
        assert.strictEqual(err.name, "AbortError");
        assert.strictEqual(err.cause, "custom cancel");
        assert.strictEqual(err.message, "custom cancel");
        return true;
      }
    );

    // 断言未向宿主发送任何 listRuns / getRun IPC 消息
    assert.strictEqual(sentCallMessagesCount, 0);
    // 断言宿主侧未接收到任何查询调用
    assert.strictEqual(receivedMessages.filter((m) => m.type === "test-list-called" || m.type === "test-get-called").length, 0);

    // 2. 验证在途取消：runs.list 在途取消被有效中止
    const listAbortController = new AbortController();
    const listPromise = service.runs.list({ slow: true } as any, { signal: listAbortController.signal });

    // 等待宿主接收到慢查询并上报消息
    const listCalledMsg = await waitForHostMessage("test-list-called");
    assert.strictEqual(listCalledMsg.hasSignal, true);

    // 在途触发取消
    listAbortController.abort();

    await assert.rejects(listPromise, (err: any) => {
      assert.strictEqual(err.name, "AbortError");
      return true;
    });

    // 断言宿主侧在途接收到 abort 消息并执行了取消中止
    await waitForHostMessage("test-list-aborted");

    // 3. 验证在途取消：runs.get 在途取消被有效中止
    const getAbortController = new AbortController();
    const getPromise = service.runs.get("slow-run", { signal: getAbortController.signal });

    // 等待宿主接收到慢详情查询并上报消息
    const getCalledMsg = await waitForHostMessage("test-get-called");
    assert.strictEqual(getCalledMsg.hasSignal, true);

    // 在途触发取消
    getAbortController.abort();

    await assert.rejects(getPromise, (err: any) => {
      assert.strictEqual(err.name, "AbortError");
      return true;
    });

    // 断言宿主侧在途接收到 abort 消息并执行了取消中止
    await waitForHostMessage("test-get-aborted");

    // 4. 验证正常查询不受影响
    const normalRuns = await service.runs.list();
    assert.strictEqual(normalRuns.length, 1);
    assert.strictEqual(normalRuns[0].id, "mock-run-1");

    const normalRun = await service.runs.get("mock-run-1");
    assert.strictEqual(normalRun?.id, "mock-run-1");

    // 5. 验证包含 "aborted" 文本的非取消错误保持为 ActionDockError，保留原始错误码与详情，未被篡改为 AbortError
    await assert.rejects(
      service.runs.list({ triggerStorageClosed: true } as any),
      (err: any) => {
        assert.ok(err instanceof ActionDockError, "Expected ActionDockError instance");
        assert.strictEqual(err.name, "ActionDockError");
        assert.notStrictEqual(err.name, "AbortError");
        assert.strictEqual(err.code, "STORAGE_CLOSED");
        assert.strictEqual(err.message, "Storage operation aborted: storage is already closed");
        assert.deepStrictEqual(err.details, { reason: "closed" });
        return true;
      }
    );

    await assert.rejects(
      service.runs.get("storage-closed-run"),
      (err: any) => {
        assert.ok(err instanceof ActionDockError, "Expected ActionDockError instance");
        assert.strictEqual(err.name, "ActionDockError");
        assert.notStrictEqual(err.name, "AbortError");
        assert.strictEqual(err.code, "STORAGE_CLOSED");
        assert.strictEqual(err.message, "Storage operation aborted: storage is already closed");
        assert.deepStrictEqual(err.details, { reason: "closed" });
        return true;
      }
    );

    await assert.rejects(
      service.runs.list({ triggerGenericAbortedError: true } as any),
      (err: any) => {
        assert.ok(err instanceof ActionDockError, "Expected ActionDockError instance");
        assert.strictEqual(err.name, "ActionDockError");
        assert.notStrictEqual(err.name, "AbortError");
        assert.strictEqual(err.code, "SERVICE_ERROR");
        assert.strictEqual(err.message, "Generic operation aborted by unknown internal condition");
        return true;
      }
    );

    // 6. 验证真正的取消错误码与名称依然正确转换为 AbortError
    await assert.rejects(
      service.runs.list({ triggerExplicitAbortError: true } as any),
      (err: any) => {
        assert.strictEqual(err.name, "AbortError");
        assert.strictEqual(err.message, "Explicit query abort");
        return true;
      }
    );

    await assert.rejects(
      service.runs.list({ triggerExecutionAbortedCode: true } as any),
      (err: any) => {
        assert.strictEqual(err.name, "AbortError");
        assert.strictEqual(err.message, "Query execution was aborted");
        return true;
      }
    );

    await assert.rejects(
      service.runs.list({ triggerOperationAbortedCode: true } as any),
      (err: any) => {
        assert.strictEqual(err.name, "AbortError");
        assert.strictEqual(err.message, "Query operation was aborted");
        return true;
      }
    );

    await assert.rejects(
      service.runs.list({ triggerAbortErrCode: true } as any),
      (err: any) => {
        assert.strictEqual(err.name, "AbortError");
        assert.strictEqual(err.message, "Query abort err code");
        return true;
      }
    );

    await service.close();
  });

  it("preserves AbortSignal.timeout DOMException and custom string abort reasons on host runs.list and runs.get", async () => {
    const { createActionDock } = await import("../src/service/factory");
    const hostService = await createActionDock({
      runtimeOptions: { inMemory: true },
    });

    // 1. 使用 AbortSignal.timeout(1) 产生的 DOMException 作为 reason
    const timeoutSignal = AbortSignal.timeout(1);
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(timeoutSignal.aborted, true);
    assert.ok(timeoutSignal.reason instanceof Error);
    const domException = timeoutSignal.reason;

    await assert.rejects(
      hostService.runs.list(undefined, { signal: timeoutSignal }),
      (err: any) => {
        assert.strictEqual(err.name, "AbortError");
        assert.notStrictEqual(err.name, "TypeError");
        assert.strictEqual(err.cause, domException);
        assert.strictEqual((domException as any).name, "TimeoutError");
        return true;
      }
    );

    await assert.rejects(
      hostService.runs.list({ signal: timeoutSignal }),
      (err: any) => {
        assert.strictEqual(err.name, "AbortError");
        assert.notStrictEqual(err.name, "TypeError");
        assert.strictEqual(err.cause, domException);
        return true;
      }
    );

    await assert.rejects(
      hostService.runs.get("run-1", { signal: timeoutSignal }),
      (err: any) => {
        assert.strictEqual(err.name, "AbortError");
        assert.notStrictEqual(err.name, "TypeError");
        assert.strictEqual(err.cause, domException);
        assert.strictEqual((domException as any).name, "TimeoutError");
        return true;
      }
    );

    // 2. 传入字符串 reason（如 controller.abort("custom cancel")）
    const customController = new AbortController();
    customController.abort("custom cancel");

    await assert.rejects(
      hostService.runs.list(undefined, { signal: customController.signal }),
      (err: any) => {
        assert.strictEqual(err.name, "AbortError");
        assert.strictEqual(err.cause, "custom cancel");
        assert.strictEqual(err.message, "custom cancel");
        return true;
      }
    );

    await assert.rejects(
      hostService.runs.get("run-1", { signal: customController.signal }),
      (err: any) => {
        assert.strictEqual(err.name, "AbortError");
        assert.strictEqual(err.cause, "custom cancel");
        assert.strictEqual(err.message, "custom cancel");
        return true;
      }
    );
  });

  it("createAbortError creates new AbortError with cause and does not mutate input reason", async () => {
    const { createAbortError } = await import("../src/ipc/service");

    // DOMException from AbortSignal.timeout
    const timeoutSignal = AbortSignal.timeout(1);
    await new Promise((r) => setTimeout(r, 20));
    const domException = timeoutSignal.reason;
    const abortErr1 = createAbortError(domException);
    assert.strictEqual(abortErr1.name, "AbortError");
    assert.strictEqual(abortErr1.cause, domException);
    assert.strictEqual(abortErr1.message, (domException as any).message);
    assert.strictEqual((domException as any).name, "TimeoutError");

    // String reason
    const abortErr2 = createAbortError("custom cancel");
    assert.strictEqual(abortErr2.name, "AbortError");
    assert.strictEqual(abortErr2.cause, "custom cancel");
    assert.strictEqual(abortErr2.message, "custom cancel");

    // Standard Error
    const originalErr = new Error("something failed");
    originalErr.name = "CustomError";
    const abortErr3 = createAbortError(originalErr);
    assert.strictEqual(abortErr3.name, "AbortError");
    assert.strictEqual(abortErr3.cause, originalErr);
    assert.strictEqual(abortErr3.message, "something failed");
    assert.strictEqual(originalErr.name, "CustomError");

    // undefined
    const abortErr4 = createAbortError();
    assert.strictEqual(abortErr4.name, "AbortError");
    assert.strictEqual(abortErr4.message, "The operation was aborted");
    assert.strictEqual("cause" in abortErr4, false);
  });

  it("markIpcSignal 序列化收敛、过滤非安全值并防御循环引用", async () => {
    const { markIpcSignal, IPC_SIGNAL_MARKER } = await import("../src/ipc/service");

    // 基础空值防御
    assert.strictEqual(markIpcSignal(undefined), undefined);
    assert.strictEqual(markIpcSignal(null as any), undefined);
    assert.deepStrictEqual(markIpcSignal({}), {});

    // signal 占位标记转换与支持合法选项透传
    const controller = new AbortController();
    const marked = markIpcSignal({
      signal: controller.signal,
      timeoutMs: 3000,
      requestId: "req-123",
      packageId: "pkg-a",
      action: "do-work",
      status: "running",
      since: "2026-01-01T00:00:00Z",
      until: "2026-01-02T00:00:00Z",
      limit: 50,
      offset: 10,
      requestIds: ["r1", "r2"],
      filter: { active: true },
      config: { retry: 3, debug: false },
    });

    assert.strictEqual(marked?.[IPC_SIGNAL_MARKER], true);
    assert.strictEqual("signal" in (marked ?? {}), false);
    assert.strictEqual(marked?.timeoutMs, 3000);
    assert.strictEqual(marked?.requestId, "req-123");
    assert.strictEqual(marked?.packageId, "pkg-a");
    assert.strictEqual(marked?.action, "do-work");
    assert.strictEqual(marked?.status, "running");
    assert.strictEqual(marked?.since, "2026-01-01T00:00:00Z");
    assert.strictEqual(marked?.until, "2026-01-02T00:00:00Z");
    assert.strictEqual(marked?.limit, 50);
    assert.strictEqual(marked?.offset, 10);
    assert.deepStrictEqual(marked?.requestIds, ["r1", "r2"]);
    assert.deepStrictEqual(marked?.filter, { active: true });
    assert.deepStrictEqual(marked?.config, { retry: 3, debug: false });

    // 过滤非安全值（函数、undefined、Symbol 等）
    const sanitized = markIpcSignal({
      fn: () => {},
      undef: undefined,
      sym: Symbol("test"),
      validField: "keep-me",
      nested: {
        innerFn: () => {},
        innerOk: true,
      },
      list: [1, () => {}, "ok", undefined],
    } as any);

    assert.strictEqual(sanitized?.validField, "keep-me");
    assert.strictEqual("fn" in (sanitized ?? {}), false);
    assert.strictEqual("undef" in (sanitized ?? {}), false);
    assert.strictEqual("sym" in (sanitized ?? {}), false);
    assert.deepStrictEqual(sanitized?.nested, { innerOk: true });
    assert.deepStrictEqual(sanitized?.list, [1, "ok"]);

    // 循环引用防御
    const circularObj: any = { name: "cycle" };
    circularObj.self = circularObj;
    const circularResult = markIpcSignal({
      config: circularObj,
      timeoutMs: 1000,
    });
    assert.strictEqual(circularResult?.timeoutMs, 1000);
    assert.deepStrictEqual(circularResult?.config, { name: "cycle" });
  });
});
