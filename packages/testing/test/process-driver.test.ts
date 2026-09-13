import { describe, expect, it } from "bun:test";
import {
  FakeProcessDriver,
  type ProcessHandle,
} from "../src";

describe("FakeProcessDriver 测试桩驱动测试", () => {
  it("spawn 失败时按真实驱动契约通知 fault、exited 与 outputClosed 三件套", async () => {
    const driver = new FakeProcessDriver();

    const events: string[] = [];
    let reportedFault: Error | undefined;
    let exitResult: { code: number | null; signal: string | null } | undefined;

    driver.simulateSpawnFailure(new Error("cannot start broken-bin"));

    await expect(
      driver.spawn(
        { executable: "broken-bin", args: [], io: { mode: "pipe" } },
        {
          output() {},
          exited(res) {
            exitResult = res;
            events.push("exited");
          },
          outputClosed(reason) {
            events.push("outputClosed:" + reason);
          },
          fault(err) {
            reportedFault = err;
            events.push("fault");
          },
        }
      )
    ).rejects.toThrow("cannot start broken-bin");

    // 与 NodeProcessDriver 契约一致：fault 先行，exited 携带 spawn 失败语义（code 与 signal 均为 null），随后 outputClosed
    expect(events).toEqual(["fault", "exited", "outputClosed:natural"]);
    expect(reportedFault?.message).toBe("cannot start broken-bin");
    expect(exitResult).toEqual({ code: null, signal: null });
  });
});

describe("FakeProcessDriver 原有行为测试", () => {
  it("支持派生进程并记录启动调用", async () => {
    const driver = new FakeProcessDriver();
    let exitedCalled = false;

    const handle = await driver.spawn(
      {
        executable: "test-bin",
        args: ["--arg1", "val1"],
        io: { mode: "pipe" },
      },
      {
        output() {},
        exited() {
          exitedCalled = true;
        },
        outputClosed() {},
      }
    );

    expect(handle.id).toBeDefined();
    expect(driver.spawnCalls.length).toBe(1);
    expect(driver.spawnCalls[0].spec.executable).toBe("test-bin");
    expect(driver.getLastHandle()?.id).toBe(handle.id);

    driver.emitExit(handle, { code: 0 });
    expect(exitedCalled).toBe(true);
  });

  it("支持确定性模拟输出 emitOutput 并正确传递流与字节", async () => {
    const driver = new FakeProcessDriver();
    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];
    const ptyParts: string[] = [];

    const handle = await driver.spawn(
      {
        executable: "echo-bin",
        args: [],
        io: { mode: "pipe" },
      },
      {
        output(stream, data) {
          const str = new TextDecoder().decode(data);
          if (stream === "stdout") stdoutParts.push(str);
          if (stream === "stderr") stderrParts.push(str);
          if (stream === "pty") ptyParts.push(str);
        },
        exited() {},
        outputClosed() {},
      }
    );

    driver.emitOutput(handle, "stdout", "chunk-stdout-1");
    driver.emitOutput(handle, "stdout", new TextEncoder().encode("-chunk-stdout-2"));
    driver.emitOutput(handle, "stderr", "error-msg");
    driver.emitOutput(handle, "pty", "pty-text");

    expect(stdoutParts.join("")).toBe("chunk-stdout-1-chunk-stdout-2");
    expect(stderrParts.join("")).toBe("error-msg");
    expect(ptyParts.join("")).toBe("pty-text");
  });

  it("支持确定性模拟退出 emitExit 与输出关闭 emitOutputClosed", async () => {
    const driver = new FakeProcessDriver();
    let exitCode: number | null | undefined;
    let exitSignal: string | null | undefined;
    let closeReason: string | undefined;

    const handle = await driver.spawn(
      {
        executable: "test-proc",
        args: [],
        io: { mode: "pipe" },
      },
      {
        output() {},
        exited(res) {
          exitCode = res.code;
          exitSignal = res.signal;
        },
        outputClosed(reason) {
          closeReason = reason;
        },
      }
    );

    driver.emitExit(handle, { code: 137, signal: "SIGKILL" });
    expect(exitCode).toBe(137);
    expect(exitSignal).toBe("SIGKILL");

    driver.emitOutputClosed(handle, "drain-timeout");
    expect(closeReason).toBe("drain-timeout");
  });

  it("支持确定性模拟底层故障 emitFault", async () => {
    const driver = new FakeProcessDriver();
    let caughtFault: Error | undefined;

    const handle = await driver.spawn(
      {
        executable: "fault-proc",
        args: [],
        io: { mode: "pipe" },
      },
      {
        output() {},
        exited() {},
        outputClosed() {},
        fault(err) {
          caughtFault = err;
        },
      }
    );

    const testError = new Error("simulated driver crash");
    driver.emitFault(handle, testError);
    expect(caughtFault).toBe(testError);
  });

  it("支持记录写入、EOF 与前台作业中断", async () => {
    const driver = new FakeProcessDriver();

    const handle = await driver.spawn(
      {
        executable: "writer-proc",
        args: [],
        io: { mode: "pipe" },
      },
      {
        output() {},
        exited() {},
        outputClosed() {},
      }
    );

    await driver.write(handle, new TextEncoder().encode("line 1\n"));
    await driver.write(handle, new TextEncoder().encode("line 2\n"));
    await driver.inputEOF(handle);
    await driver.interruptForeground(handle);

    expect(driver.writes.length).toBe(2);
    expect(driver.getWrittenStrings(handle)).toEqual(["line 1\n", "line 2\n"]);
    expect(driver.hasInputEOF(handle)).toBe(true);
    expect(driver.hasInterrupted(handle)).toBe(true);
  });

  it("支持记录调整终端尺寸与终止流程", async () => {
    const driver = new FakeProcessDriver();

    const handle = await driver.spawn(
      {
        executable: "pty-proc",
        args: [],
        io: { mode: "pty", cols: 80, rows: 24, term: "xterm" },
      },
      {
        output() {},
        exited() {},
        outputClosed() {},
      }
    );

    await driver.resize(handle, 120, 40);
    await driver.terminate(handle, 500);
    await driver.dispose(handle);

    expect(driver.resizeCalls.length).toBe(1);
    expect(driver.resizeCalls[0].cols).toBe(120);
    expect(driver.resizeCalls[0].rows).toBe(40);

    expect(driver.terminateCalls.length).toBe(1);
    expect(driver.terminateCalls[0].graceMs).toBe(500);

    expect(driver.disposeCalls.length).toBe(1);
  });

  it("支持故障注入 simulateSpawnFailure 与 simulateWriteFailure", async () => {
    const driver = new FakeProcessDriver();

    // 注入 spawn 失败
    driver.simulateSpawnFailure(new Error("cannot fork process"));
    await expect(
      driver.spawn(
        { executable: "failing-bin", args: [], io: { mode: "pipe" } },
        { output() {}, exited() {}, outputClosed() {} }
      )
    ).rejects.toThrow("cannot fork process");

    // 随后一次正常恢复
    const handle = await driver.spawn(
      { executable: "ok-bin", args: [], io: { mode: "pipe" } },
      { output() {}, exited() {}, outputClosed() {} }
    );
    expect(handle).toBeDefined();

    // 注入 write 失败
    driver.simulateWriteFailure(new Error("broken pipe simulation"));
    await expect(
      driver.write(handle, new TextEncoder().encode("test"))
    ).rejects.toThrow("broken pipe simulation");

    // 注入 resize 失败
    driver.simulateResizeFailure(new Error("resize rejected"));
    await expect(driver.resize(handle, 80, 24)).rejects.toThrow("resize rejected");

    // 注入 terminate 失败
    driver.simulateTerminateFailure(new Error("kill permission denied"));
    await expect(driver.terminate(handle, 100)).rejects.toThrow("kill permission denied");
  });

  it("支持 reset 重置全部状态与历史记录", async () => {
    const driver = new FakeProcessDriver();

    const handle = await driver.spawn(
      { executable: "dummy", args: [], io: { mode: "pipe" } },
      { output() {}, exited() {}, outputClosed() {} }
    );
    await driver.write(handle, new TextEncoder().encode("msg"));

    expect(driver.spawnCalls.length).toBe(1);
    expect(driver.writes.length).toBe(1);

    driver.reset();

    expect(driver.spawnCalls.length).toBe(0);
    expect(driver.writes.length).toBe(0);
    expect(driver.getLastHandle()).toBeUndefined();
  });
});
