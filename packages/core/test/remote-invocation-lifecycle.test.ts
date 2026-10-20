import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RemoteInvocationExecutor } from "../src/invocation/remote";
import { createInvocationContext } from "../src/invocation/types";
import { ActionDockError, ACTION_CANCELLED, SERVICE_RESULT_UNKNOWN, TIMEOUT } from "../src/errors";
import type { RemoteServiceOptions } from "../src/service/types";

const ref = { packageId: "pricing", actionId: "quote" };
const metadata = { binding: "primary", profile: "office" };

function fixture() {
  const executor = new RemoteInvocationExecutor();
  const target: RemoteServiceOptions = { serverUrl: "http://127.0.0.1:1", token: "private-token" };
  const context = createInvocationContext({
    package: { id: "caller", instanceId: "caller-instance", generation: "test" },
  });
  const service = {
    discovery: { describeAction: async () => ({ id: "quote" }) },
    execution: {
      start: async (): Promise<any> => ({
        runId: "remote-run", status: "running",
        result: Promise.resolve({ ok: true, runId: "remote-run", data: {} }),
      }),
    },
    runs: {
      list: async () => [],
      cancel: async (_id: string): Promise<any> => ({ outcome: "requested", runId: "remote-run" }),
    },
    close: async () => {},
  };
  (executor as any).services.set(target, service);
  return { executor, target, context, service };
}

describe("远端调用生命周期边界", () => {
  it("本地等待超时不等于远端执行失败", async () => {
    const { executor, target, context, service } = fixture();
    service.execution.start = async () => ({
      runId: "remote-run", status: "running",
      result: Promise.resolve({
        ok: false, runId: "remote-run", error: { code: TIMEOUT, message: "Waiting timed out" },
      }),
    });
    try {
      await assert.rejects(executor.invoke(target, ref, {}, context, metadata), (error: any) => {
        assert.equal(error.code, SERVICE_RESULT_UNKNOWN);
        assert.equal(error.details.resultUnknown, true);
        assert.equal(error.details.remoteRunId, "remote-run");
        return true;
      });
    } finally { await executor.close(); }
  });

  it("关闭先取消在途调用，再释放服务，不依赖结果 Promise 主动响应取消", async () => {
    const { executor, target, context, service } = fixture();
    const order: string[] = [];
    let accepted!: () => void;
    const ready = new Promise<void>((resolve) => { accepted = resolve; });
    service.execution.start = async () => {
      accepted();
      return { runId: "remote-run", status: "running", result: new Promise(() => {}) };
    };
    service.runs.cancel = async (id: string) => {
      assert.equal(id, "remote-run");
      order.push("cancel");
      return { outcome: "requested", runId: id };
    };
    service.close = async () => { order.push("close"); };
    const call = executor.invoke(target, ref, {}, context, metadata);
    const rejected = assert.rejects(call, (error: any) => {
      assert.equal(error.code, ACTION_CANCELLED);
      assert.equal(error.details.resultUnknown, true);
      return true;
    });
    await ready;
    await executor.close();
    await rejected;
    assert.deepEqual(order, ["cancel", "close"]);
  });

  it("发现阶段错误保留绑定关联并脱敏", async () => {
    const { executor, target, context, service } = fixture();
    service.discovery.describeAction = async () => {
      throw new ActionDockError("UNAUTHORIZED", "Denied private-token", { token: "private-token" });
    };
    try {
      await assert.rejects(executor.invoke(target, ref, {}, context, metadata), (error: any) => {
        assert.equal(error.code, "UNAUTHORIZED");
        assert.equal(error.details.resultUnknown, false);
        assert.equal(error.details.binding, "primary");
        assert.equal(JSON.stringify(error.details).includes("private-token"), false);
        assert.equal(error.message.includes("private-token"), false);
        return true;
      });
    } finally { await executor.close(); }
  });
});
