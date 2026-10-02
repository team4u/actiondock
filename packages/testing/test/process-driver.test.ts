import { describe, it } from "node:test";
import assert from "node:assert/strict";
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

    await assert.rejects(
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
    , /cannot start broken\-bin/);

    // 与 NodeProcessDriver 契约一致：fault 先行，exited 携带 spawn 失败语义（code 与 signal 均为 null），随后 outputClosed
    assert.deepStrictEqual(events, ["fault", "exited", "outputClosed:natural"]);
    assert.strictEqual(reportedFault?.message, "cannot start broken-bin");
    assert.deepStrictEqual(exitResult, { code: null, signal: null });
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

    assert.notStrictEqual(handle.id, undefined);
    assert.strictEqual(driver.spawnCalls.length, 1);
    assert.strictEqual(driver.spawnCalls[0].spec.executable, "test-bin");
    assert.strictEqual(driver.getLastHandle()?.id, handle.id);

    driver.emitExit(handle, { code: 0 });
    assert.strictEqual(exitedCalled, true);
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

    assert.strictEqual(stdoutParts.join(""), "chunk-stdout-1-chunk-stdout-2");
    assert.strictEqual(stderrParts.join(""), "error-msg");
    assert.strictEqual(ptyParts.join(""), "pty-text");
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
    assert.strictEqual(exitCode, 137);
    assert.strictEqual(exitSignal, "SIGKILL");

    driver.emitOutputClosed(handle, "drain-timeout");
    assert.strictEqual(closeReason, "drain-timeout");
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
    assert.strictEqual(caughtFault, testError);
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

    assert.strictEqual(driver.writes.length, 2);
    assert.deepStrictEqual(driver.getWrittenStrings(handle), ["line 1\n", "line 2\n"]);
    assert.strictEqual(driver.hasInputEOF(handle), true);
    assert.strictEqual(driver.hasInterrupted(handle), true);
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

    assert.strictEqual(driver.resizeCalls.length, 1);
    assert.strictEqual(driver.resizeCalls[0].cols, 120);
    assert.strictEqual(driver.resizeCalls[0].rows, 40);

    assert.strictEqual(driver.terminateCalls.length, 1);
    assert.strictEqual(driver.terminateCalls[0].graceMs, 500);

    assert.strictEqual(driver.disposeCalls.length, 1);
  });

  it("支持故障注入 simulateSpawnFailure 与 simulateWriteFailure", async () => {
    const driver = new FakeProcessDriver();

    // 注入 spawn 失败
    driver.simulateSpawnFailure(new Error("cannot fork process"));
    await assert.rejects(
      driver.spawn(
        { executable: "failing-bin", args: [], io: { mode: "pipe" } },
        { output() {}, exited() {}, outputClosed() {} }
      )
    , /cannot fork process/);

    // 随后一次正常恢复
    const handle = await driver.spawn(
      { executable: "ok-bin", args: [], io: { mode: "pipe" } },
      { output() {}, exited() {}, outputClosed() {} }
    );
    assert.notStrictEqual(handle, undefined);

    // 注入 write 失败
    driver.simulateWriteFailure(new Error("broken pipe simulation"));
    await assert.rejects(
      driver.write(handle, new TextEncoder().encode("test"))
    , /broken pipe simulation/);

    // 注入 resize 失败
    driver.simulateResizeFailure(new Error("resize rejected"));
    await assert.rejects(driver.resize(handle, 80, 24), /resize rejected/);

    // 注入 terminate 失败
    driver.simulateTerminateFailure(new Error("kill permission denied"));
    await assert.rejects(driver.terminate(handle, 100), /kill permission denied/);
  });

  it("支持 reset 重置全部状态与历史记录", async () => {
    const driver = new FakeProcessDriver();

    const handle = await driver.spawn(
      { executable: "dummy", args: [], io: { mode: "pipe" } },
      { output() {}, exited() {}, outputClosed() {} }
    );
    await driver.write(handle, new TextEncoder().encode("msg"));

    assert.strictEqual(driver.spawnCalls.length, 1);
    assert.strictEqual(driver.writes.length, 1);

    driver.reset();

    assert.strictEqual(driver.spawnCalls.length, 0);
    assert.strictEqual(driver.writes.length, 0);
    assert.strictEqual(driver.getLastHandle(), undefined);
  });
});
