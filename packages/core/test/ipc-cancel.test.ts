import { afterAll, describe, expect, it } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * IPC 取消链路端到端测试。
 *
 * 验证监督进程（IpcActionDockTarget）到宿主子进程（serveParentIpc）的
 * 跨进程取消传播：父侧 abort signal 后，宿主侧 AbortController 同步中止，
 * 长运行 Action 以取消语义（cancelled 状态与 ACTION_CANCELLED 错误码）结束。
 */

/** 测试专用宿主子进程脚本：以 serveParentIpc 暴露单个慢速 Action。 */
const HOST_SCRIPT = `
import { serveParentIpc } from "@actiondock/core";
import { createActionDockApp } from "@actiondock/core";
import { defineAction } from "@actiondock/sdk";

const slowAction = defineAction({
  async run(_input: unknown, ctx: any) {
    ctx.signal.addEventListener("abort", () => {
      process.send?.({ type: "test-signal-aborted" });
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ done: true }), 15000);
      ctx.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("Action execution was cancelled"));
      });
    });
  },
});

const app = await createActionDockApp({
  projectConfig: {
    id: "test.ipc-cancel-pkg",
    name: "IPC Cancel Test",
    version: "1.0.0",
    actions: {
      "task.blocking": { entry: "", description: "慢速动作用于取消链路验证" },
    },
  },
  actions: { "task.blocking": slowAction },
  inMemory: true,
});

await serveParentIpc(app);
`;

describe("IPC cross-process cancellation chain", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "ipc-cancel-test-"));
  let hostChild: ChildProcess | undefined;

  afterAll(() => {
    if (hostChild && hostChild.exitCode === null) {
      hostChild.kill("SIGKILL");
    }
    try {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      // 忽略清理异常，避免影响退出流程
    }
  });

  it("propagates parent-side abort to host-side ActionContext signal and ends with cancellation semantics", async () => {
    // 宿主脚本落盘为 .ts，复用仓库根 tsconfig 路径别名由测试加载器解析工作区依赖
    const hostScriptPath = join(tempDir, "ipc-cancel-host.ts");
    writeFileSync(hostScriptPath, HOST_SCRIPT);

    const { IpcActionDockTarget } = await import("../src/ipc/target");
    // fork 默认即建立 IPC 通道，无需自定义 stdio；类型断言收敛额外传参以保持与现有 fork 行为一致
    const target = new IpcActionDockTarget({
      scriptPath: hostScriptPath,
      cwd: tempDir,
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    } as ConstructorParameters<typeof IpcActionDockTarget>[0]);
    hostChild = target.process;

    let hostSignalAborted = false;
    hostChild.on("message", (msg: any) => {
      if (msg?.type === "test-signal-aborted") {
        hostSignalAborted = true;
      }
    });

    await target.waitReady();

    // 父侧发起长运行调用并携带取消信号
    const controller = new AbortController();
    const runPromise = target.runAction(
      "test.ipc-cancel-pkg/task.blocking",
      {} as never,
      { signal: controller.signal }
    );

    // 延迟触发取消，确保调用已送达宿主并进入执行体
    await new Promise((r) => setTimeout(r, 150));
    controller.abort();

    const result = await runPromise;

    // 断言宿主侧 ActionContext.signal 已随 abort 消息中止
    expect(hostSignalAborted).toBe(true);

    // 断言调用以取消语义结束：cancelled 状态与 ACTION_CANCELLED 错误码
    // 联合类型收窄：仅失败分支携带 error 字段
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected cancelled execution result, got success");
    }
    expect(result.error?.code).toBe("ACTION_CANCELLED");

    await target.close();
  }, 20000);
});
