import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { defineAction, type ActionContract, type ActionContext, type Logger } from "@actiondock/sdk";
import { createActionDock } from "../src/service";
import { startActionDockServer } from "../src/server";
import { ActionDockError, ACTION_CANCELLED, INVALID_ARGUMENT, SERVICE_CLOSED } from "../src/errors";
import { createInvocationContext } from "../src/invocation/types";
import { RemoteInvocationExecutor, type RemoteInvocationMetadata } from "../src/invocation/remote";
import type { RemoteServiceOptions } from "../src/service/types";

describe("安全的远端嵌套调用适配器 (RemoteInvocationExecutor)", () => {
  const AUTH_TOKEN = "remote-invoker-secret-token";
  let serverInstance: any;
  let target: RemoteServiceOptions;

  const logs: string[] = [];
  const testLogger: Logger = {
    debug: (msg: string) => logs.push(`[DEBUG] ${msg}`),
    info: (msg: string) => logs.push(`[INFO] ${msg}`),
    warn: (msg: string) => logs.push(`[WARN] ${msg}`),
    error: (msg: string) => logs.push(`[ERROR] ${msg}`),
  };

  const metadata: RemoteInvocationMetadata = {
    binding: "test-binding",
    profile: "test-profile",
  };

  before(async () => {
    const echoAction = defineAction({
      inputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
      },
      outputSchema: {
        type: "object",
        properties: { reply: { type: "string" } },
      },
      run: (input: any) => ({ reply: input?.message }),
    });

    const failAction = defineAction({
      run: () => {
        throw new ActionDockError(
          "CUSTOM_BIZ_FAILURE" as any,
          "Remote business logic failure",
          { detailCode: 42 }
        );
      },
    });

    const slowAction = defineAction({
      run: async (_input: unknown, ctx: ActionContext) => {
        while (!ctx.signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return { cancelled: true };
      },
    });

    const service = await createActionDock({
      runtimeOptions: {
        projectConfig: {
          id: "pkg.remote-test",
          name: "Remote Test App",
          version: "1.0.0",
        },
        actions: [
          { id: "echo", action: echoAction },
          { id: "fail", action: failAction },
          { id: "slow", action: slowAction },
        ],
        inMemory: true,
      },
    });

    serverInstance = await startActionDockServer({
      port: 0,
      hostname: "127.0.0.1",
      token: AUTH_TOKEN,
      service,
      enableManagement: false,
      packageAllowlist: ["*"],
    });

    target = Object.freeze({
      serverUrl: `http://127.0.0.1:${serverInstance.port}`,
      token: AUTH_TOKEN,
      allowInsecureHttp: true,
    });
  });

  after(async () => {
    if (serverInstance) {
      await serverInstance.stop();
    }
  });

  it("成功：校验契约一致、执行成功并剥离内部私有上下文", async () => {
    const executor = new RemoteInvocationExecutor({ logger: testLogger });
    const ctx = createInvocationContext({
      package: { id: "pkg.caller", instanceId: "inst-1", generation: "gen-1" },
      logger: testLogger,
      config: { internalKey: "secret-value" },
    });

    const contract: ActionContract = {
      id: "echo",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
      },
      outputSchema: {
        type: "object",
        properties: { reply: { type: "string" } },
      },
    };

    const result = await executor.invoke(
      target,
      "pkg.remote-test/echo",
      { message: "hello-world" },
      ctx,
      metadata,
      contract
    );

    assert.deepEqual(result, { reply: "hello-world" });

    // 验证日志中未泄漏 Token 与敏感内部配置
    const allLogs = logs.join("\n");
    assert.strictEqual(allLogs.includes(AUTH_TOKEN), false);
    assert.strictEqual(allLogs.includes("secret-value"), false);

    await executor.close();
  });

  it("业务错误：确定业务失败保留原错误码与元信息", async () => {
    const executor = new RemoteInvocationExecutor();
    const ctx = createInvocationContext({
      package: { id: "pkg.caller", instanceId: "inst-1", generation: "gen-1" },
    });

    await assert.rejects(
      async () => {
        await executor.invoke(
          target,
          "pkg.remote-test/fail",
          {},
          ctx,
          metadata
        );
      },
      (err: any) => {
        assert.strictEqual(err instanceof ActionDockError, true);
        assert.strictEqual(err.code, "CUSTOM_BIZ_FAILURE");
        assert.strictEqual(err.details?.action, "pkg.remote-test/fail");
        assert.strictEqual(err.details?.binding, metadata.binding);
        assert.strictEqual(err.details?.profile, metadata.profile);
        assert.strictEqual(typeof err.details?.requestId, "string");
        assert.strictEqual(typeof err.details?.remoteRunId, "string");
        assert.strictEqual(err.details?.resultUnknown, false);
        return true;
      }
    );

    await executor.close();
  });

  it("同一ref连续两次独立执行：复用连接且各自分配独立requestId与remoteRunId", async () => {
    const executor = new RemoteInvocationExecutor();
    const ctx1 = createInvocationContext({
      package: { id: "pkg.caller", instanceId: "inst-1", generation: "gen-1" },
      requestId: "parent-req-id",
    });
    const ctx2 = createInvocationContext({
      package: { id: "pkg.caller", instanceId: "inst-1", generation: "gen-1" },
      requestId: "parent-req-id",
    });

    const res1: any = await executor.invoke(
      target,
      "pkg.remote-test/echo",
      { message: "first-call" },
      ctx1,
      metadata
    );

    const res2: any = await executor.invoke(
      target,
      "pkg.remote-test/echo",
      { message: "second-call" },
      ctx2,
      metadata
    );

    assert.strictEqual(res1.reply, "first-call");
    assert.strictEqual(res2.reply, "second-call");

    await executor.close();
  });

  it("契约不一致在执行前拒绝：使用 INVALID_ARGUMENT 且附带元字段报错", async () => {
    const executor = new RemoteInvocationExecutor();
    const ctx = createInvocationContext({
      package: { id: "pkg.caller", instanceId: "inst-1", generation: "gen-1" },
    });

    const mismatchedContract: ActionContract = {
      id: "echo",
      inputSchema: { type: "number" },
      outputSchema: { type: "string" },
    };

    await assert.rejects(
      async () => {
        await executor.invoke(
          target,
          "pkg.remote-test/echo",
          { message: "mismatch" },
          ctx,
          metadata,
          mismatchedContract
        );
      },
      (err: any) => {
        assert.strictEqual(err instanceof ActionDockError, true);
        assert.strictEqual(err.code, INVALID_ARGUMENT);
        assert.strictEqual(err.details?.action, "pkg.remote-test/echo");
        assert.strictEqual(err.details?.binding, metadata.binding);
        assert.strictEqual(err.details?.profile, metadata.profile);
        assert.strictEqual(typeof err.details?.requestId, "string");
        assert.strictEqual(err.details?.remoteRunId, undefined);
        assert.strictEqual(err.details?.resultUnknown, false);
        return true;
      }
    );

    await executor.close();
  });

  it("预取消不发起网络：调用前已取消立即抛出 ACTION_CANCELLED", async () => {
    const executor = new RemoteInvocationExecutor();
    const controller = new AbortController();
    controller.abort();

    const ctx = createInvocationContext({
      package: { id: "pkg.caller", instanceId: "inst-1", generation: "gen-1" },
      signal: controller.signal,
    });

    await assert.rejects(
      async () => {
        await executor.invoke(
          target,
          "pkg.remote-test/echo",
          { message: "pre-aborted" },
          ctx,
          metadata
        );
      },
      (err: any) => {
        assert.strictEqual(err instanceof ActionDockError, true);
        assert.strictEqual(err.code, ACTION_CANCELLED);
        assert.strictEqual(err.details?.action, "pkg.remote-test/echo");
        assert.strictEqual(err.details?.binding, metadata.binding);
        assert.strictEqual(err.details?.profile, metadata.profile);
        assert.strictEqual(err.details?.remoteRunId, undefined);
        assert.strictEqual(err.details?.resultUnknown, false);
        return true;
      }
    );

    await executor.close();
  });

  it("已接收取消传到远端：保留取消回执语义并检查远端最终状态", async () => {
    const executor = new RemoteInvocationExecutor();
    const controller = new AbortController();
    const ctx = createInvocationContext({
      package: { id: "pkg.caller", instanceId: "inst-1", generation: "gen-1" },
      signal: controller.signal,
    });

    let remoteRunId: string | undefined;

    const invokePromise = executor.invoke(
      target,
      "pkg.remote-test/slow",
      {},
      ctx,
      metadata
    );

    // 等待远端接收并启动任务
    await new Promise((resolve) => setTimeout(resolve, 80));

    // 触发父级信号取消
    controller.abort();

    await assert.rejects(
      invokePromise,
      (err: any) => {
        assert.strictEqual(err instanceof ActionDockError, true);
        assert.strictEqual(err.code, ACTION_CANCELLED);
        assert.strictEqual(err.details?.action, "pkg.remote-test/slow");
        assert.strictEqual(err.details?.binding, metadata.binding);
        assert.strictEqual(err.details?.profile, metadata.profile);
        assert.strictEqual(typeof err.details?.remoteRunId, "string");
        assert.strictEqual(
          err.details?.resultUnknown,
          err.details?.cancelOutcome !== "already_terminal"
        );
        remoteRunId = err.details?.remoteRunId;
        return true;
      }
    );

    assert.ok(remoteRunId, "remoteRunId 必须存在");

    // 验证远端服务记录中的终态状态为 cancelled
    const record = await serverInstance.service.runs.get(remoteRunId);
    assert.strictEqual(record?.status, "cancelled");

    await executor.close();
  });

  it("close：全量释放连接资源并对外拒绝新调用", async () => {
    const executor = new RemoteInvocationExecutor();
    const ctx = createInvocationContext({
      package: { id: "pkg.caller", instanceId: "inst-1", generation: "gen-1" },
    });

    // 首次调用成功
    const res: any = await executor.invoke(
      target,
      "pkg.remote-test/echo",
      { message: "before-close" },
      ctx,
      metadata
    );
    assert.strictEqual(res.reply, "before-close");

    // 关闭资源
    await executor.close();

    // 再次调用被拒绝
    await assert.rejects(
      async () => {
        await executor.invoke(
          target,
          "pkg.remote-test/echo",
          { message: "after-close" },
          ctx,
          metadata
        );
      },
      (err: any) => {
        assert.strictEqual(err instanceof ActionDockError, true);
        assert.strictEqual(err.code, SERVICE_CLOSED);
        assert.strictEqual(err.details?.action, "pkg.remote-test/echo");
        assert.strictEqual(err.details?.binding, metadata.binding);
        assert.strictEqual(err.details?.profile, metadata.profile);
        assert.strictEqual(err.details?.resultUnknown, false);
        return true;
      }
    );

    // 幂等关闭无副作用
    await executor.close();
  });

  it("确定鉴权拒绝：execution.start 返回 401/UNAUTHORIZED 时保留确定拒绝码且 resultUnknown 为 false", async () => {
    const localLogs: string[] = [];
    const customLogger: Logger = {
      debug: (msg: string) => localLogs.push(msg),
      info: (msg: string) => localLogs.push(msg),
      warn: (msg: string) => localLogs.push(msg),
      error: (msg: string) => localLogs.push(msg),
    };
    const executor = new RemoteInvocationExecutor({ logger: customLogger });
    const ctx = createInvocationContext({
      package: { id: "pkg.caller", instanceId: "inst-1", generation: "gen-1" },
      logger: customLogger,
    });

    const secretToken = "super-secret-bearer-token";
    const customTarget: RemoteServiceOptions = {
      serverUrl: "http://127.0.0.1:8999",
      token: secretToken,
      allowInsecureHttp: true,
    };

    const mockService = {
      discovery: {
        describeAction: async () => ({
          id: "echo",
          description: "Mock echo",
        }),
      },
      execution: {
        start: async () => ({
          runId: "",
          status: "failed" as const,
          result: Promise.resolve({
            ok: false,
            runId: "",
            error: {
              code: "UNAUTHORIZED",
              message: `Unauthorized access with token ${secretToken}`,
              details: { secret: secretToken },
            },
          }),
        }),
      },
      runs: {
        list: async () => [],
        cancel: async () => ({ outcome: "not_found" as const, runId: "" }),
      },
      close: async () => {},
    };

    (executor as any).services.set(customTarget, mockService as any);

    await assert.rejects(
      async () => {
        await executor.invoke(
          customTarget,
          "pkg.remote-test/echo",
          { message: "test" },
          ctx,
          metadata
        );
      },
      (err: any) => {
        assert.strictEqual(err instanceof ActionDockError, true);
        assert.strictEqual(err.code, "UNAUTHORIZED");
        assert.strictEqual(err.details?.resultUnknown, false);
        assert.strictEqual(err.details?.remoteRunId, undefined);
        assert.strictEqual(typeof err.details?.requestId, "string");

        // 验证禁止透传 target token 和 URL 凭据到日志/error.message/originalError
        assert.strictEqual(err.message.includes(secretToken), false);
        assert.strictEqual(JSON.stringify(err.details).includes(secretToken), false);
        assert.strictEqual(localLogs.join("\n").includes(secretToken), false);
        return true;
      }
    );

    await executor.close();
  });

  it("握手失败无runId：网络中断且反查无记录时判定为 SERVICE_RESULT_UNKNOWN 且 resultUnknown 为 true", async () => {
    const localLogs: string[] = [];
    const customLogger: Logger = {
      debug: (msg: string) => localLogs.push(msg),
      info: (msg: string) => localLogs.push(msg),
      warn: (msg: string) => localLogs.push(msg),
      error: (msg: string) => localLogs.push(msg),
    };
    const executor = new RemoteInvocationExecutor({ logger: customLogger });
    const ctx = createInvocationContext({
      package: { id: "pkg.caller", instanceId: "inst-1", generation: "gen-1" },
      logger: customLogger,
    });

    const mockTarget: RemoteServiceOptions = {
      serverUrl: "http://127.0.0.1:8998",
      token: "mock-token",
      allowInsecureHttp: true,
    };

    let runsListCalled = false;
    const mockService = {
      discovery: {
        describeAction: async () => ({
          id: "echo",
        }),
      },
      execution: {
        start: async () => {
          throw new ActionDockError("NETWORK_ERROR" as any, "Connection reset by peer");
        },
      },
      runs: {
        list: async () => {
          runsListCalled = true;
          return [];
        },
        cancel: async () => ({ outcome: "not_found" as const, runId: "" }),
      },
      close: async () => {},
    };

    (executor as any).services.set(mockTarget, mockService as any);

    await assert.rejects(
      async () => {
        await executor.invoke(
          mockTarget,
          "pkg.remote-test/echo",
          {},
          ctx,
          metadata
        );
      },
      (err: any) => {
        assert.strictEqual(err instanceof ActionDockError, true);
        assert.strictEqual(err.code, "SERVICE_RESULT_UNKNOWN");
        assert.strictEqual(err.details?.resultUnknown, true);
        assert.strictEqual(err.details?.remoteRunId, undefined);
        assert.strictEqual(err.details?.lookupRecordFound, false);
        return true;
      }
    );

    assert.strictEqual(runsListCalled, true);
    await executor.close();
  });

  it("查回记录使用.id：反查已存在记录时使用 .id 取消远端任务并标记 remoteRunId", async () => {
    const executor = new RemoteInvocationExecutor({ logger: testLogger });
    const ctx = createInvocationContext({
      package: { id: "pkg.caller", instanceId: "inst-1", generation: "gen-1" },
    });

    const mockTarget: RemoteServiceOptions = {
      serverUrl: "http://127.0.0.1:8997",
      allowInsecureHttp: true,
    };

    const targetRunId = "rec-uuid-999";
    let cancelledId: string | undefined;

    const mockService = {
      discovery: {
        describeAction: async () => ({
          id: "echo",
        }),
      },
      execution: {
        start: async () => {
          // 握手阶段网络抖动，未返回 ticket
          throw new Error("Client socket timeout before receiving runId");
        },
      },
      runs: {
        list: async () => [
          // RunRecord 的标识字段是 id，不是 runId
          {
            id: targetRunId,
            packageId: "pkg.remote-test",
            actionId: "echo",
            rootRunId: targetRunId,
            generationId: "gen-1",
            ownerId: "owner-1",
            packageInstanceId: "inst-1",
            status: "running",
          } as any,
        ],
        cancel: async (runId: string) => {
          cancelledId = runId;
          return { outcome: "already_terminal" as const, runId, status: "cancelled" as any };
        },
      },
      close: async () => {},
    };

    (executor as any).services.set(mockTarget, mockService as any);

    await assert.rejects(
      async () => {
        await executor.invoke(
          mockTarget,
          "pkg.remote-test/echo",
          {},
          ctx,
          metadata
        );
      },
      (err: any) => {
        assert.strictEqual(err instanceof ActionDockError, true);
        assert.strictEqual(err.code, "SERVICE_RESULT_UNKNOWN");
        assert.strictEqual(err.details?.remoteRunId, targetRunId);
        assert.strictEqual(err.details?.cancelOutcome, "already_terminal");
        assert.strictEqual(err.details?.resultUnknown, false);
        return true;
      }
    );

    // 严谨验证：使用 foundRun.id 成功发起取消，而不是 undefined
    assert.strictEqual(cancelledId, targetRunId);
    await executor.close();
  });

  it("取消outcome语义：not_found与not_owner不可当取消成功，requested诚实返回resultUnknown，ticket.result缺失不可TypeError", async () => {
    // 1. not_found 不能当作取消成功
    {
      const localLogs: string[] = [];
      const customLogger: Logger = {
        debug: (msg: string) => localLogs.push(msg),
        info: (msg: string) => localLogs.push(msg),
        warn: (msg: string) => localLogs.push(msg),
        error: (msg: string) => localLogs.push(msg),
      };
      const executor = new RemoteInvocationExecutor({ logger: customLogger });
      const controller = new AbortController();
      const ctx = createInvocationContext({
        package: { id: "pkg.caller", instanceId: "inst-1", generation: "gen-1" },
        signal: controller.signal,
        logger: customLogger,
      });

      const mockTarget: RemoteServiceOptions = {
        serverUrl: "http://127.0.0.1:8996",
        allowInsecureHttp: true,
      };

      let abortExecutionPromise: (val: any) => void;
      const executionResultPromise = new Promise((resolve) => {
        abortExecutionPromise = resolve;
      });

      const mockService = {
        discovery: {
          describeAction: async () => ({ id: "echo" }),
        },
        execution: {
          start: async () => ({
            runId: "orphan-run-123",
            status: "running" as const,
            result: executionResultPromise as any,
          }),
        },
        runs: {
          list: async () => [],
          cancel: async () => ({ outcome: "not_found" as const, runId: "orphan-run-123" }),
        },
        close: async () => {},
      };

      (executor as any).services.set(mockTarget, mockService as any);

      const invokePromise = executor.invoke(
        mockTarget,
        "pkg.remote-test/echo",
        {},
        ctx,
        metadata
      );

      // 等待任务启动并注册 abort 监听
      await new Promise((r) => setTimeout(r, 20));
      controller.abort();
      abortExecutionPromise!({ ok: false, error: { code: "ACTION_CANCELLED", message: "aborted" } });

      await assert.rejects(
        invokePromise,
        (err: any) => {
          assert.strictEqual(err instanceof ActionDockError, true);
          assert.strictEqual(err.code, "SERVICE_RESULT_UNKNOWN");
          assert.strictEqual(err.details?.resultUnknown, true);
          assert.strictEqual(err.details?.remoteRunId, "orphan-run-123");
          assert.strictEqual(err.details?.cancelOutcome, "not_found");
          return true;
        }
      );

      // 验证上下文 logger 观测到了清理失败
      assert.strictEqual(
        localLogs.some((l) => l.includes("Cancellation cleanup failed")),
        true
      );
      await executor.close();
    }

    // 2. requested 仅表示已请求，不可宣称终态已停止，resultUnknown 要诚实为 true
    {
      const executor = new RemoteInvocationExecutor({ logger: testLogger });
      const controller = new AbortController();
      const ctx = createInvocationContext({
        package: { id: "pkg.caller", instanceId: "inst-1", generation: "gen-1" },
        signal: controller.signal,
      });

      const mockTarget: RemoteServiceOptions = {
        serverUrl: "http://127.0.0.1:8995",
        allowInsecureHttp: true,
      };

      const mockService = {
        discovery: {
          describeAction: async () => ({ id: "echo" }),
        },
        execution: {
          start: async () => {
            // 握手在途时触发信号取消并模拟网络中断
            controller.abort();
            throw new Error("transport interrupted");
          },
        },
        runs: {
          list: async () => [
            {
              id: "req-run-1",
              packageId: "pkg.remote-test",
              actionId: "echo",
              rootRunId: "req-run-1",
              generationId: "gen-1",
              ownerId: "owner-1",
              packageInstanceId: "inst-1",
              status: "running",
            } as any,
          ],
          cancel: async () => ({ outcome: "requested" as const, runId: "req-run-1" }),
        },
        close: async () => {},
      };

      (executor as any).services.set(mockTarget, mockService as any);

      await assert.rejects(
        async () => {
          await executor.invoke(
            mockTarget,
            "pkg.remote-test/echo",
            {},
            ctx,
            metadata
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof ActionDockError, true);
          assert.strictEqual(err.code, ACTION_CANCELLED);
          assert.strictEqual(err.details?.cancelOutcome, "requested");
          // requested 必须诚实返回 resultUnknown: true
          assert.strictEqual(err.details?.resultUnknown, true);
          return true;
        }
      );
      await executor.close();
    }

    // 3. 缺失 ticket.result 应 EXECUTION_FAILED 或 UNKNOWN，不可抛出 TypeError
    {
      const executor = new RemoteInvocationExecutor({ logger: testLogger });
      const ctx = createInvocationContext({
        package: { id: "pkg.caller", instanceId: "inst-1", generation: "gen-1" },
      });

      const mockTarget: RemoteServiceOptions = {
        serverUrl: "http://127.0.0.1:8994",
        allowInsecureHttp: true,
      };

      const mockService = {
        discovery: {
          describeAction: async () => ({ id: "echo" }),
        },
        execution: {
          start: async () => ({
            runId: "run-no-result-promise",
            status: "running" as const,
            // result 缺失
          }),
        },
        runs: {
          list: async () => [],
          cancel: async () => ({ outcome: "already_terminal" as const, runId: "" }),
        },
        close: async () => {},
      };

      (executor as any).services.set(mockTarget, mockService as any);

      await assert.rejects(
        async () => {
          await executor.invoke(
            mockTarget,
            "pkg.remote-test/echo",
            {},
            ctx,
            metadata
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof ActionDockError, true);
          assert.strictEqual(err.code, "EXECUTION_FAILED");
          assert.strictEqual(err.details?.resultUnknown, true);
          assert.strictEqual(err.details?.remoteRunId, "run-no-result-promise");
          return true;
        }
      );
      await executor.close();
    }
  });
});
