import { describe, expect, it } from "bun:test";
import { defineAction } from "@actiondock/sdk";
import { ActionRunner } from "../src/runtime/runner";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import { StandaloneDispatcher, ExitCode } from "../src/runtime/standalone";
import { createPackageIdentity } from "../src/runtime/identity";

describe("Phase 7: 运行时安全边界与布尔模式修正", () => {
  it("inputSchema: false 拒绝所有输入且不执行 Action", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    let executed = false;
    const testAction = defineAction({
      inputSchema: false,
      run() {
        executed = true;
        return { ok: true };
      },
    });

    const runner = new ActionRunner({
      identity: createPackageIdentity({ id: "test-pkg" }),
      packageId: "test-pkg",
      storage,
      actions: new Map([["test.reject", testAction]]),
    });

    const res = await runner.execute("test.reject", { some: "data" });
    expect(res.ok).toBe(false);
    expect(executed).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("INPUT_VALIDATION_FAILED");
    }

    const runs = storage.listRuns();
    expect(runs.length).toBe(1);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].error?.code).toBe("INPUT_VALIDATION_FAILED");
  });

  it("outputSchema: false 拦截所有输出并返回 OUTPUT_VALIDATION_FAILED", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    let executed = false;
    const testAction = defineAction({
      outputSchema: false,
      run() {
        executed = true;
        return { result: "hello" };
      },
    });

    const runner = new ActionRunner({
      identity: createPackageIdentity({ id: "test-pkg" }),
      packageId: "test-pkg",
      storage,
      actions: new Map([["test.out-reject", testAction]]),
    });

    const res = await runner.execute("test.out-reject", {});
    expect(res.ok).toBe(false);
    expect(executed).toBe(true);
    if (!res.ok) {
      expect(res.error.code).toBe("OUTPUT_VALIDATION_FAILED");
    }

    const runs = storage.listRuns();
    expect(runs.length).toBe(1);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].error?.code).toBe("OUTPUT_VALIDATION_FAILED");
  });

  it("非 Canonical JsonValue 输出（Date、Map、Set 等）返回 OUTPUT_NOT_JSON", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    const dateAction = defineAction({
      run() {
        return new Date() as any;
      },
    });

    const mapAction = defineAction({
      run() {
        return new Map() as any;
      },
    });

    const setAction = defineAction({
      run() {
        return new Set() as any;
      },
    });

    const customClassAction = defineAction({
      run() {
        class CustomClass {}
        return new CustomClass() as any;
      },
    });

    const undefinedPropAction = defineAction({
      run() {
        return { bad: undefined } as any;
      },
    });

    const sparseArrAction = defineAction({
      run() {
        const arr = [1, 2, 3];
        delete (arr as any)[1];
        return arr as any;
      },
    });

    const runner = new ActionRunner({
      identity: createPackageIdentity({ id: "test-pkg" }),
      packageId: "test-pkg",
      storage,
      actions: new Map([
        ["test.date", dateAction],
        ["test.map", mapAction],
        ["test.set", setAction],
        ["test.custom", customClassAction],
        ["test.undef", undefinedPropAction],
        ["test.sparse", sparseArrAction],
      ]),
    });

    for (const id of ["test.date", "test.map", "test.set", "test.custom", "test.undef", "test.sparse"]) {
      const res = await runner.execute(id, {});
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("OUTPUT_NOT_JSON");
      }
    }
  });

  it("输入策略违规在持久化前拦截且不将原始 input 写入持久化存储", async () => {
    const storage = new SqliteRuntimeStorage({
      packageId: "test-pkg",
      dbPath: ":memory:",
    });

    let executed = false;
    const testAction = defineAction({
      run() {
        executed = true;
        return { ok: true };
      },
    });

    const runner = new ActionRunner({
      identity: createPackageIdentity({ id: "test-pkg" }),
      packageId: "test-pkg",
      storage,
      actions: new Map([["test.policy", testAction]]),
    });

    const forbiddenInputs = [
      JSON.parse('{"__proto__": {"admin": true}}'),
      { constructor: "malicious" },
      { prototype: "malicious" },
      { nested: { ["__proto__"]: { admin: true } } },
    ];

    for (const badInput of forbiddenInputs) {
      executed = false;
      const res = await runner.execute("test.policy", badInput);
      expect(res.ok).toBe(false);
      expect(executed).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("INPUT_VALIDATION_FAILED");
        expect(Array.isArray(res.error.details)).toBe(true);
      }

      const runs = storage.listRuns();
      const latestRun = runs[0];
      expect(latestRun.status).toBe("failed");
      expect(latestRun.error?.code).toBe("INPUT_VALIDATION_FAILED");
      expect(latestRun.input).toBeUndefined();
    }
  });
});

describe("Phase 8: 操作系统信号所有权与独立分发器", () => {
  it("并发可复用 API 调用（分别传入独立的 signalA 与 signalB），互不干扰且无全局 SIGINT 监听器增长与 process.exitCode 竞态", async () => {
    const initialListeners = process.listenerCount("SIGINT");
    const origExitCode = process.exitCode;

    const slowAction = defineAction({
      async run(_input, ctx) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ done: true }), 150);
          ctx.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("Action execution was cancelled"));
          });
        });
        return { done: true };
      },
    });

    const dispatcher = new StandaloneDispatcher({
      packageId: "test.concurrent",
      version: "1.0.0",
      actions: [{ id: "slow", action: slowAction }],
      inMemory: true,
      stdout: () => {},
      stderr: () => {},
    });

    const controllerA = new AbortController();
    const controllerB = new AbortController();

    const callA = dispatcher.dispatch(["run", "slow"], {
      signal: controllerA.signal,
      cancellationSource: "external",
    });

    const callB = dispatcher.dispatch(["run", "slow"], {
      signal: controllerB.signal,
      cancellationSource: "external",
    });

    // 校验全局 SIGINT 监听器数量无增长
    expect(process.listenerCount("SIGINT")).toBe(initialListeners);

    // 取消 A，保留 B
    controllerA.abort(new Error("Cancelled A"));

    const [codeA, codeB] = await Promise.all([callA, callB]);

    // A 被外部取消，退出码为 1 (FAILURE)，绝不能是 130
    expect(codeA).toBe(ExitCode.FAILURE);
    // B 正常运行完成，退出码为 0 (SUCCESS)
    expect(codeB).toBe(ExitCode.SUCCESS);

    // 校验全局 process.exitCode 未被可复用 API 写入/污染
    expect(process.exitCode).toBe(origExitCode);
    expect(process.listenerCount("SIGINT")).toBe(initialListeners);
  });

  it("外部 abort 与 SIGINT 取消的区分断言", async () => {
    const slowAction = defineAction({
      async run(_input, ctx) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ done: true }), 200);
          ctx.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("Action execution was cancelled"));
          });
        });
        return { done: true };
      },
    });

    const dispatcher = new StandaloneDispatcher({
      packageId: "test.cancel-diff",
      version: "1.0.0",
      actions: [{ id: "slow", action: slowAction }],
      inMemory: true,
      stdout: () => {},
      stderr: () => {},
    });

    // 1. cancellationSource === "sigint"
    const sigintController = new AbortController();
    const sigintPromise = dispatcher.dispatch(["run", "slow"], {
      signal: sigintController.signal,
      cancellationSource: "sigint",
    });
    sigintController.abort(new Error("Interrupted by SIGINT"));
    const sigintCode = await sigintPromise;
    expect(sigintCode).toBe(ExitCode.SIGINT);

    // 2. cancellationSource === "external"
    const externalController = new AbortController();
    const externalPromise = dispatcher.dispatch(["run", "slow"], {
      signal: externalController.signal,
      cancellationSource: "external",
    });
    externalController.abort(new Error("External cancel"));
    const externalCode = await externalPromise;
    expect(externalCode).toBe(ExitCode.FAILURE);

    // 3. control.signal.aborted 预设取消状态且 cancellationSource 为 external
    const preAbortedController = new AbortController();
    preAbortedController.abort(new Error("Pre-aborted"));
    const preCode = await dispatcher.dispatch(["run", "slow"], {
      signal: preAbortedController.signal,
      cancellationSource: "external",
    });
    expect(preCode).toBe(ExitCode.FAILURE);

    // 4. control.signal.aborted 预设取消状态且 cancellationSource 为 sigint
    const preSigintController = new AbortController();
    preSigintController.abort(new Error("Pre-sigint"));
    const preSigCode = await dispatcher.dispatch(["run", "slow"], {
      signal: preSigintController.signal,
      cancellationSource: "sigint",
    });
    expect(preSigCode).toBe(ExitCode.SIGINT);
  });
});
