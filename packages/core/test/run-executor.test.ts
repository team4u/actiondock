import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import { FakeProcessDriver } from "@actiondock/testing";
import { RunExecutor } from "../src/process/run-executor";
import { NodeProcessDriver } from "../src/process/process-driver";
import { PROCESS_CANCELLED, PROCESS_TIMEOUT, ProcessError } from "../src/errors";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
const spec = { executable: "dummy", args: [], io: { mode: "pipe" as const } };

describe("RunExecutor 终止收尾", () => {
  it("超时等待终止完成，清理失败通过原调用报告且没有未处理拒绝", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const driver = new FakeProcessDriver();
    const started = deferred();
    const cleanup = deferred();
    const cleanupError = new Error("drain failed");
    driver.terminate = async () => {
      started.resolve();
      await cleanup.promise;
      throw cleanupError;
    };
    const unhandled: unknown[] = [];
    const record = (error: unknown) => { unhandled.push(error); };
    process.on("unhandledRejection", record);
    try {
      let settled = false;
      const result = new RunExecutor(driver).execute({ spec, timeoutMs: 10, maxOutputBytes: 1024 });
      void result.then(() => { settled = true; }, () => { settled = true; });
      const rejected = assert.rejects(result, (error: any) => {
        assert.equal(error.code, PROCESS_TIMEOUT);
        assert.equal(error.cause, cleanupError);
        return true;
      });
      await nextTurn();
      t.mock.timers.tick(10);
      await started.promise;
      assert.equal(settled, false, "清理未完成时不能返回");
      cleanup.resolve();
      await rejected;
      await nextTurn();
      assert.deepEqual(unhandled, []);
    } finally {
      cleanup.resolve();
      process.off("unhandledRejection", record);
    }
  });

  it("取消等待清理，保留原始错误并附带清理失败", async () => {
    const driver = new FakeProcessDriver();
    const started = deferred();
    const cleanup = deferred();
    const cleanupError = new Error("kill failed");
    driver.terminate = async () => {
      started.resolve();
      await cleanup.promise;
      throw cleanupError;
    };
    const reason = new Error("cancel requested");
    const controller = new AbortController();
    const result = new RunExecutor(driver).execute(
      { spec, timeoutMs: 0, maxOutputBytes: 1024 },
      { signal: controller.signal }
    );
    const rejected = assert.rejects(result, (error: unknown) => {
      assert.equal(error, reason);
      assert.equal(reason.cause, cleanupError);
      return true;
    });
    await nextTurn();
    controller.abort(reason);
    await started.promise;
    cleanup.resolve();
    await rejected;
  });

  it("同步派生期间输出超限也必须在获得句柄后终止，并透传清理错误", async () => {
    const driver = new FakeProcessDriver();
    const cleanupError = new ProcessError(PROCESS_TIMEOUT, "drain failed");
    driver.nextTerminateError = cleanupError;
    driver.onSpawn = (_handle, _spec, observer) => {
      observer.output("stdout", new Uint8Array(128));
    };
    await assert.rejects(
      new RunExecutor(driver).execute({ spec, timeoutMs: 0, maxOutputBytes: 8 }),
      (error: unknown) => error === cleanupError
    );
    assert.equal(driver.nextTerminateError, undefined, "终止故障应已被实际消费");
  });

  it("同步派生期间故障在获得句柄后清理，保留立即终止的宽限值", async () => {
    const driver = new FakeProcessDriver();
    const fault = new Error("driver fault");
    driver.onSpawn = (_handle, _spec, observer) => { observer.fault?.(fault); };
    await assert.rejects(
      new RunExecutor(driver).execute({ spec, timeoutMs: 0, maxOutputBytes: 8 }),
      (error: unknown) => error === fault
    );
    assert.equal(driver.terminateCalls.length, 1);
    assert.equal(driver.terminateCalls[0].graceMs, 0);
  });

  it("成功清理后保持输出截断返回契约", async () => {
    const driver = new FakeProcessDriver();
    driver.onSpawn = (_handle, _spec, observer) => {
      observer.output("stdout", new Uint8Array(128));
    };
    const result = await new RunExecutor(driver).execute({ spec, timeoutMs: 0, maxOutputBytes: 8 });
    assert.equal(result.truncated, true);
    assert.equal(driver.terminateCalls.length, 1);
    assert.ok(result.exit);
  });

  it("成功清理后保留非 Error 的原始取消原因", async () => {
    const driver = new FakeProcessDriver();
    const controller = new AbortController();
    const result = new RunExecutor(driver).execute(
      { spec, timeoutMs: 0, maxOutputBytes: 8 },
      { signal: controller.signal }
    );
    const rejected = assert.rejects(result, (error: unknown) => error === "stop");
    await nextTurn();
    controller.abort("stop");
    await rejected;
    assert.equal(driver.terminateCalls.length, 1);
  });

  it("派生前已取消时不启动进程", async () => {
    const driver = new FakeProcessDriver();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      new RunExecutor(driver).execute(
        { spec, timeoutMs: 0, maxOutputBytes: 8 },
        { signal: controller.signal }
      ),
      { code: PROCESS_CANCELLED }
    );
    assert.equal(driver.spawnCalls.length, 0);
  });
});

function fakeChild(pid: number) {
  const child = new EventEmitter() as any;
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  return child;
}

describe("NodeProcessDriver 输出关闭策略", () => {
  it("自然等待模式不会在排空期限结束时提前关闭输出", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const child = fakeChild(2_147_483_647);
    let closed: string | undefined;
    const driver = new NodeProcessDriver({
      waitForOutputClose: true,
      drainDeadlineMs: 10,
      spawnFn: (() => child) as any,
    });
    await driver.spawn(spec, {
      output() {}, exited() {}, outputClosed(reason) { closed = reason; },
    });
    child.emit("exit", 0, null);
    t.mock.timers.tick(20);
    assert.equal(closed, undefined);
    child.emit("close", 0, null);
    assert.equal(closed, "natural");
  });

  it("自然等待模式下强杀仍有清理期限", { skip: process.platform === "win32" }, async () => {
    const child = fakeChild(2_147_483_646);
    let closed: string | undefined;
    const driver = new NodeProcessDriver({
      waitForOutputClose: true,
      drainDeadlineMs: 20,
      spawnFn: (() => child) as any,
    });
    const handle = await driver.spawn(spec, {
      output() {}, exited() {}, outputClosed(reason) { closed = reason; },
    });
    const terminating = driver.terminate(handle, 0);
    child.emit("exit", null, "SIGKILL");
    await assert.rejects(terminating, { code: PROCESS_TIMEOUT });
    assert.equal(closed, "drain-timeout");
    assert.equal(child.stdout.destroyed, true);
  });

  it("排空超时后的真实 close 不会提前移除清理句柄，也不再转发输出", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const child = fakeChild(2_147_483_645);
    let lateOutputs = 0;
    let closed: string | undefined;
    const driver = new NodeProcessDriver({ drainDeadlineMs: 10, spawnFn: (() => child) as any });
    const handle = await driver.spawn(spec, {
      output() { if (closed) lateOutputs++; },
      exited() {},
      outputClosed(reason) { closed = reason; },
    });
    child.emit("exit", 0, null);
    t.mock.timers.tick(10);
    assert.equal(closed, "drain-timeout");
    child.emit("close", 0, null);
    const instances = (driver as any).instances as Map<string, unknown>;
    assert.equal(instances.has(handle.id), true);
    child.stdout.emit("data", Buffer.from("late output"));
    assert.equal(lateOutputs, 0);
    await driver.dispose(handle);
    assert.equal(instances.has(handle.id), false);
  });
});
