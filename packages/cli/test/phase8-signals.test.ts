import { describe, expect, it } from "bun:test";
import { defineAction } from "@actiondock/sdk";
import { executeAction } from "../src/commands/run";
import { main } from "../src/index";
import { runStandaloneCli } from "../src/standalone";
import { ExitCode, type CliContext } from "../src/types";

describe("Phase 8 CLI: 操作系统信号所有权与可复用 API 纯净性", () => {
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

  const baseStandaloneOpts = {
    packageId: "test.signals",
    version: "1.0.0",
    actions: [{ id: "slow", action: slowAction }],
    inMemory: true,
    stdout: () => {},
    stderr: () => {},
  };

  it("runStandaloneCli: 区分外部 abort 与 SIGINT 取消", async () => {
    // 1. SIGINT 取消 -> 130
    const sigintController = new AbortController();
    const sigintPromise = runStandaloneCli(["run", "slow"], baseStandaloneOpts, {
      signal: sigintController.signal,
      cancellationSource: "sigint",
    });
    sigintController.abort(new Error("Interrupted by SIGINT"));
    const sigintCode = await sigintPromise;
    expect(sigintCode).toBe(ExitCode.SIGINT);

    // 2. 外部取消 -> 1 (FAILURE)
    const extController = new AbortController();
    const extPromise = runStandaloneCli(["run", "slow"], baseStandaloneOpts, {
      signal: extController.signal,
      cancellationSource: "external",
    });
    extController.abort(new Error("External cancel"));
    const extCode = await extPromise;
    expect(extCode).toBe(ExitCode.FAILURE);
  });

  it("executeAction: 纯净性保证，严禁写入 process.exitCode，区分外部 abort 与 SIGINT 取消", async () => {
    const origExitCode = process.exitCode;
    const initialListeners = process.listenerCount("SIGINT");

    // 1. 外部取消：抛出普通取消错误，绝不抛出 SigintError (130)
    const extController = new AbortController();
    const context: CliContext = {
      control: {
        signal: extController.signal,
        cancellationSource: "external",
      },
      stdout: () => {},
      stderr: () => {},
    };

    const extPromise = executeAction("slow", { json: true }, context, undefined, context.control);
    extController.abort(new Error("Cancelled externally"));
    await extPromise;

    // 校验 process.exitCode 未被写入
    expect(process.exitCode).toBe(origExitCode);
    expect(process.listenerCount("SIGINT")).toBe(initialListeners);
    // context.exitCode 记录了失败状态 1
    expect(context.exitCode).toBe(1);

    // 2. SIGINT 取消：抛出 SigintError
    const sigintController = new AbortController();
    const sigintContext: CliContext = {
      control: {
        signal: sigintController.signal,
        cancellationSource: "sigint",
      },
      stdout: () => {},
      stderr: () => {},
    };

    const sigintPromise = executeAction("slow", { json: true }, sigintContext, undefined, sigintContext.control);
    sigintController.abort(new Error("Interrupted by SIGINT"));

    await expect(sigintPromise).rejects.toThrow("Interrupted by SIGINT");
    expect(process.exitCode).toBe(origExitCode);
    expect(process.listenerCount("SIGINT")).toBe(initialListeners);
  });

  it("main: 纯净可复用 API，严禁写入 process.exitCode，区分外部 abort 与 SIGINT", async () => {
    const origExitCode = process.exitCode;
    const initialListeners = process.listenerCount("SIGINT");

    // 1. 外部取消 -> 返回 1
    const extController = new AbortController();
    extController.abort(new Error("External abort"));
    const extCode = await main(["run", "slow", "--json"], {
      signal: extController.signal,
      cancellationSource: "external",
    });
    expect(extCode).toBe(ExitCode.FAILURE);
    expect(process.exitCode).toBe(origExitCode);
    expect(process.listenerCount("SIGINT")).toBe(initialListeners);

    // 2. SIGINT 取消 -> 返回 130
    const sigintController = new AbortController();
    sigintController.abort(new Error("Interrupted by SIGINT"));
    const sigintCode = await main(["run", "slow", "--json"], {
      signal: sigintController.signal,
      cancellationSource: "sigint",
    });
    expect(sigintCode).toBe(ExitCode.SIGINT);
    expect(process.exitCode).toBe(origExitCode);
    expect(process.listenerCount("SIGINT")).toBe(initialListeners);
  });

  it("并发可复用 API 调用互不干扰且无 process.exitCode 竞态", async () => {
    const origExitCode = process.exitCode;
    const initialListeners = process.listenerCount("SIGINT");

    const controllerA = new AbortController();
    const controllerB = new AbortController();

    const callA = runStandaloneCli(["run", "slow"], baseStandaloneOpts, {
      signal: controllerA.signal,
      cancellationSource: "external",
    });

    const callB = runStandaloneCli(["run", "slow"], baseStandaloneOpts, {
      signal: controllerB.signal,
      cancellationSource: "external",
    });

    expect(process.listenerCount("SIGINT")).toBe(initialListeners);

    controllerA.abort(new Error("Cancelled A"));

    const [codeA, codeB] = await Promise.all([callA, callB]);

    expect(codeA).toBe(ExitCode.FAILURE);
    expect(codeB).toBe(ExitCode.SUCCESS);

    expect(process.exitCode).toBe(origExitCode);
    expect(process.listenerCount("SIGINT")).toBe(initialListeners);
  });
});
