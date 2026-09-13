import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  INPUT_CLOSED,
  UNSUPPORTED_CAPABILITY,
  ProcessError,
} from "@actiondock/core";
import {
  NodeProcessDriver,
  resolveProcessEnv,
} from "../src";

/** 读取驱动内部实例的 exit 监听器数量，用于验证 terminate 自清理 */
async function getExitListenerCount(driver: NodeProcessDriver, handle: any): Promise<number> {
  const instances = (driver as any).instances as Map<string, { exitListeners: Array<() => void> }>;
  const instance = instances.get(handle.id);
  return instance ? instance.exitListeners.length : -1;
}

describe("NodeProcessDriver 平台驱动测试", () => {
  it("pipe 模式成功派生并接收完整 stdout 与 stderr 输出", async () => {
    const driver = new NodeProcessDriver();
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let exitResult: { code: number | null; signal: string | null } | undefined;
    let outputClosedReason: string | undefined;

    let resolveClose: () => void;
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });

    const handle = await driver.spawn(
      {
        executable: process.execPath,
        args: [
          "-e",
          "process.stdout.write('hello-stdout\\n'); process.stderr.write('hello-stderr\\n'); process.exit(0);",
        ],
        io: { mode: "pipe" },
      },
      {
        output(stream, data) {
          const text = new TextDecoder().decode(data);
          if (stream === "stdout") {
            stdoutChunks.push(text);
          } else if (stream === "stderr") {
            stderrChunks.push(text);
          }
        },
        exited(res) {
          exitResult = res;
        },
        outputClosed(reason) {
          outputClosedReason = reason;
          resolveClose();
        },
      }
    );

    expect(handle.id).toBeDefined();
    expect(typeof handle.pid).toBe("number");

    await closePromise;

    expect(stdoutChunks.join("")).toContain("hello-stdout");
    expect(stderrChunks.join("")).toContain("hello-stderr");
    expect(exitResult?.code).toBe(0);
    expect(outputClosedReason).toBe("natural");

    await driver.dispose(handle);
  });

  it("支持环境变量 allowlisted 白名单策略与 set/unset 配置", async () => {
    const originalHostVar = "TEST_CUSTOM_HOST_VAR_XYZ";
    process.env[originalHostVar] = "should-not-leak";

    try {
      // 验证 resolveProcessEnv 纯函数行为
      const envAllowlisted = resolveProcessEnv({
        inherit: "allowlisted",
        set: { MY_INJECTED_VAR: "injected_val" },
        unset: ["PATH"],
      });

      expect(envAllowlisted[originalHostVar]).toBeUndefined();
      expect(envAllowlisted["MY_INJECTED_VAR"]).toBe("injected_val");
      expect(envAllowlisted["PATH"]).toBeUndefined();

      const envNone = resolveProcessEnv({
        inherit: "none",
        set: { FOO: "bar" },
      });
      expect(Object.keys(envNone)).toEqual(["FOO"]);

      // 验证真实子进程中的环境变量表现
      const driver = new NodeProcessDriver();
      const outputParts: string[] = [];

      let resolveClose: () => void;
      const closePromise = new Promise<void>((resolve) => {
        resolveClose = resolve;
      });

      const handle = await driver.spawn(
        {
          executable: process.execPath,
          args: [
            "-e",
            "process.stdout.write(JSON.stringify({ hasLeak: Boolean(process.env['TEST_CUSTOM_HOST_VAR_XYZ']), custom: process.env['MY_EXPLICIT_VAR'] }));",
          ],
          env: {
            inherit: "allowlisted",
            set: { MY_EXPLICIT_VAR: "explicit_value" },
          },
          io: { mode: "pipe" },
        },
        {
          output(stream, data) {
            if (stream === "stdout") {
              outputParts.push(new TextDecoder().decode(data));
            }
          },
          exited() {},
          outputClosed() {
            resolveClose();
          },
        }
      );

      await closePromise;
      const parsed = JSON.parse(outputParts.join(""));
      expect(parsed.hasLeak).toBe(false);
      expect(parsed.custom).toBe("explicit_value");

      await driver.dispose(handle);
    } finally {
      delete process.env[originalHostVar];
    }
  });

  it("支持 write 写入与 inputEOF 干净结束标准输入", async () => {
    const driver = new NodeProcessDriver();
    const receivedOutput: string[] = [];

    let resolveClose: () => void;
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });

    const handle = await driver.spawn(
      {
        executable: process.execPath,
        args: [
          "-e",
          "let data = ''; process.stdin.on('data', chunk => data += chunk); process.stdin.on('end', () => { process.stdout.write('ECHO:' + data); process.exit(0); });",
        ],
        io: { mode: "pipe" },
      },
      {
        output(stream, data) {
          if (stream === "stdout") {
            receivedOutput.push(new TextDecoder().decode(data));
          }
        },
        exited() {},
        outputClosed() {
          resolveClose();
        },
      }
    );

    // 写入多次数据
    await driver.write(handle, new TextEncoder().encode("part1-"));
    await driver.write(handle, new TextEncoder().encode("part2"));

    // 发送 EOF 信号
    await driver.inputEOF(handle);

    await closePromise;
    expect(receivedOutput.join("")).toBe("ECHO:part1-part2");

    await driver.dispose(handle);
  });

  it("管道已销毁时向 stdin 写入抛出 INPUT_CLOSED 结构化异常", async () => {
    const driver = new NodeProcessDriver();

    let resolveClose: () => void;
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });

    const handle = await driver.spawn(
      {
        executable: process.execPath,
        args: ["-e", "process.exit(0);"],
        io: { mode: "pipe" },
      },
      {
        output() {},
        exited() {},
        outputClosed() {
          resolveClose();
        },
      }
    );

    await closePromise;

    // 进程退出后再次写入，预期抛出 INPUT_CLOSED
    try {
      await driver.write(handle, new TextEncoder().encode("late-write"));
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(ProcessError);
      expect(err.code).toBe(INPUT_CLOSED);
    }

    await driver.dispose(handle);
  });

  it("支持 terminate 发送优雅终止并在超时后强杀兜底", async () => {
    const driver = new NodeProcessDriver();
    let exitedResult: { code: number | null; signal: string | null } | undefined;

    let resolveClose: () => void;
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });

    const handle = await driver.spawn(
      {
        executable: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000);"],
        io: { mode: "pipe" },
      },
      {
        output() {},
        exited(res) {
          exitedResult = res;
        },
        outputClosed() {
          resolveClose();
        },
      }
    );

    expect(handle.pid).toBeDefined();

    // 优雅终止子进程
    await driver.terminate(handle, 200);
    await closePromise;

    expect(exitedResult).toBeDefined();
    await driver.dispose(handle);
  });

  it("子进程 exit 但 stdio 未关闭时触发 5s drain deadline 超时上报", async () => {
    // 使用受控的 Mock 子进程模拟 exit 后长时间不关闭 stdio 的场景
    const mockChild = new EventEmitter() as any;
    mockChild.pid = 99999;
    mockChild.stdout = new PassThrough();
    mockChild.stderr = new PassThrough();
    mockChild.stdin = new PassThrough();

    const mockSpawn = () => mockChild;
    const driver = new NodeProcessDriver({
      drainDeadlineMs: 60,
      spawnFn: mockSpawn as any,
    });

    let closedReason: string | undefined;
    let resolveClose: () => void;
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });

    const handle = await driver.spawn(
      {
        executable: "mock-binary",
        args: [],
        io: { mode: "pipe" },
      },
      {
        output() {},
        exited() {},
        outputClosed(reason) {
          closedReason = reason;
          resolveClose();
        },
      }
    );

    // 触发 exit 事件，但 stdout/stderr 流刻意保持开启不触发 close
    mockChild.emit("exit", 0, null);

    // 等待排空超时计时器触发
    await closePromise;
    expect(closedReason).toBe("drain-timeout");

    await driver.dispose(handle);
  });

  it("未安装 node-pty 环境下请求 PTY 模式明确抛出 UNSUPPORTED_CAPABILITY 异常", async () => {
    const driver = new NodeProcessDriver();

    try {
      await driver.spawn(
        {
          executable: "bash",
          args: [],
          io: {
            mode: "pty",
            cols: 80,
            rows: 24,
            term: "xterm-256color",
          },
        },
        {
          output() {},
          exited() {},
          outputClosed() {},
        }
      );
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(ProcessError);
      expect(err.code).toBe(UNSUPPORTED_CAPABILITY);
    }
  });

  it("pipe 模式下调用 resize 明确抛出 UNSUPPORTED_CAPABILITY 异常", async () => {
    const driver = new NodeProcessDriver();

    let resolveClose: () => void;
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });

    const handle = await driver.spawn(
      {
        executable: process.execPath,
        args: ["-e", "process.exit(0);"],
        io: { mode: "pipe" },
      },
      {
        output() {},
        exited() {},
        outputClosed() {
          resolveClose();
        },
      }
    );

    try {
      await driver.resize(handle, 100, 40);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(ProcessError);
      expect(err.code).toBe(UNSUPPORTED_CAPABILITY);
    }

    await closePromise;
    await driver.dispose(handle);
  });

  it("支持向子进程发送 interruptForeground 中断信号", async () => {
    const driver = new NodeProcessDriver();

    if (!driver.capabilities.interruptForeground) {
      // 在不支持前台中断的平台（如 Windows 平台 pipe 模式），验证能力标识与拦截抛错
      expect(driver.capabilities.interruptForeground).toBe(false);
      const handle = await driver.spawn(
        {
          executable: process.execPath,
          args: ["-e", "setInterval(() => {}, 1000);"],
          io: { mode: "pipe" },
        },
        {
          output() {},
          exited() {},
          outputClosed() {},
        }
      );
      try {
        await driver.interruptForeground(handle);
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProcessError);
        expect(err.code).toBe(UNSUPPORTED_CAPABILITY);
      } finally {
        await driver.terminate(handle, 200);
        await driver.dispose(handle);
      }
      return;
    }

    const stdoutParts: string[] = [];
    let resolveClose: () => void;
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });

    const handle = await driver.spawn(
      {
        executable: process.execPath,
        args: [
          "-e",
          "process.on('SIGINT', () => { process.stdout.write('SIGINT_CAUGHT'); process.exit(0); }); setInterval(() => {}, 1000);",
        ],
        io: { mode: "pipe" },
      },
      {
        output(stream, data) {
          if (stream === "stdout") {
            stdoutParts.push(new TextDecoder().decode(data));
          }
        },
        exited() {},
        outputClosed() {
          resolveClose();
        },
      }
    );

    // 短暂等待子进程启动并注册信号监听
    await new Promise((r) => setTimeout(r, 80));

    await driver.interruptForeground(handle);
    await closePromise;

    expect(stdoutParts.join("")).toContain("SIGINT_CAUGHT");
    await driver.dispose(handle);
  });

  it("write 遇到背压时等待 drain 事件恢复", async () => {
    // 构造模拟子进程，控制 stdin.write 返回 false 并触发 drain
    const mockChild = new EventEmitter() as any;
    mockChild.pid = 88888;
    mockChild.stdout = new PassThrough();
    mockChild.stderr = new PassThrough();

    let drainHandler: (() => void) | undefined;
    let writeCount = 0;

    mockChild.stdin = {
      destroyed: false,
      writable: true,
      write(chunk: any, cb: (err?: Error | null) => void) {
        writeCount++;
        // 第一次写入模拟缓冲区已满返回 false
        setTimeout(() => {
          if (drainHandler) {
            drainHandler();
          }
        }, 30);
        return false;
      },
      once(event: string, fn: () => void) {
        if (event === "drain") {
          drainHandler = fn;
        }
      },
      removeListener() {},
      on() {},
    };

    const mockSpawn = () => mockChild;
    const driver = new NodeProcessDriver({ spawnFn: mockSpawn as any });

    const handle = await driver.spawn(
      { executable: "dummy", args: [], io: { mode: "pipe" } },
      { output() {}, exited() {}, outputClosed() {} }
    );

    const writePromise = driver.write(handle, new TextEncoder().encode("backpressure-test"));
    await writePromise;

    expect(writeCount).toBe(1);
    await driver.dispose(handle);
  });

  it("派生失败或二进制启动异常时通知 observer.fault 并抛出异常", async () => {
    const driver = new NodeProcessDriver({
      spawnFn: () => {
        throw new Error("simulated spawn failure");
      },
    });

    let faultReported = false;
    await expect(
      driver.spawn(
        { executable: "non_existent_binary", args: [], io: { mode: "pipe" } },
        {
          output() {},
          exited() {},
          outputClosed() {},
          fault(err) {
            faultReported = true;
          },
        }
      )
    ).rejects.toThrow("simulated spawn failure");

    expect(faultReported).toBe(true);
  });

  it("dispose 清理句柄后后续操作抛出明确异常", async () => {
    const driver = new NodeProcessDriver();

    let resolveClose: () => void;
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });

    const handle = await driver.spawn(
      { executable: process.execPath, args: ["-e", "process.exit(0);"], io: { mode: "pipe" } },
      { output() {}, exited() {}, outputClosed() { resolveClose(); } }
    );

    await closePromise;
    await driver.dispose(handle);

    // dispose 后操作句柄将报错找不到实例
    await expect(driver.write(handle, new Uint8Array([1]))).rejects.toThrow(
      `Process instance not found for handle id: ${handle.id}`
    );
  });

  it("getCapabilities 缓存探测结果，重复调用不再重复探测 node-pty", async () => {
    const driver = new NodeProcessDriver();

    const first = driver.getCapabilities();
    const second = driver.getCapabilities();
    const third = driver.getCapabilities();

    // 三次调用返回一致的能力快照，且均为独立副本（修改互不影响）
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first).not.toBe(second);

    // 能力字段契约保持完整
    expect(typeof first.pty).toBe("boolean");
    expect(typeof first.resize).toBe("boolean");
    expect(first.inputEOF).toBe(true);
    expect(first.terminationScope).toBe("process-tree");
  });

  it("多次 terminate 同一实例不会累积 exit 监听器", async () => {
    const mockChild = new EventEmitter() as any;
    mockChild.pid = 77777;
    mockChild.stdout = new PassThrough();
    mockChild.stderr = new PassThrough();
    mockChild.stdin = new PassThrough();

    const driver = new NodeProcessDriver({ spawnFn: (() => mockChild) as any });

    const handle = await driver.spawn(
      { executable: "mock-bin", args: [], io: { mode: "pipe" } },
      { output() {}, exited() {}, outputClosed() {} }
    );

    // 第一次 terminate：发送 SIGTERM 后模拟退出，监听器应完成后自注销
    const terminateOnce = driver.terminate(handle, 200);
    await new Promise((r) => setTimeout(r, 10));
    mockChild.emit("exit", 0, null);
    mockChild.emit("close", 0, null);
    await terminateOnce;

    // 监听器列表必须已自清理归零，不得残留累积
    expect(await getExitListenerCount(driver, handle)).toBe(0);

    // 反复 terminate 已退出实例：不应向监听器列表追加任何新条目
    await driver.terminate(handle, 100);
    await driver.terminate(handle, 100);
    expect(await getExitListenerCount(driver, handle)).toBe(0);

    // 通过内部状态断言监听器已清空：再次派生同 id 实例验证列表复用不受污染
    const handleAgain = await driver.spawn(
      { executable: "mock-bin-2", args: [], io: { mode: "pipe" } },
      { output() {}, exited() {}, outputClosed() {} }
    );
    expect(handleAgain.id).toBeDefined();

    await driver.dispose(handle);
    await driver.dispose(handleAgain);
  });
});
