import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import { isRunHostDead, RUN_LIVENESS_GRACE_MS } from "../src/storage/run-liveness";
import { FakeClock, createTestRuntime, MemoryStorage } from "@actiondock/testing";

/**
 * 孤儿收割竞态回归验证。
 *
 * 缺陷形态：多个本地进程并发打开同一数据目录时，后启动的持有者把先启动
 * 进程仍在执行的在途 running 记录误收割为 interrupted。会话归属不等于进程
 * 存活，收割判定必须以宿主存活为依据，无法确认死亡时保守保留。
 */

describe("孤儿收割竞态：以宿主存活而非会话归属判定", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-orphan-race-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  const openStorage = (options?: { recoverOrphans?: boolean; clock?: any }) =>
    new SqliteRuntimeStorage({
      packageId: "race-pkg",
      dbPath: join(tempDir, "race-pkg", "runtime.db"),
      recoverOrphans: options?.recoverOrphans,
      clock: options?.clock,
    });

  const writeRunningRun = (
    storage: SqliteRuntimeStorage,
    id: string,
    extra: { hostSessionId?: string; hostPid?: number; startedAt?: string } = {}
  ) => {
    storage.createRun({
      id,
      rootRunId: id,
      packageId: "race-pkg",
      actionId: "job",
      status: "running" as const,
      startedAt: extra.startedAt ?? new Date().toISOString(),
      hostSessionId: extra.hostSessionId,
      hostPid: extra.hostPid,
    });
  };

  it("并发实例互不收割：后启动持有者打开时先启动进程的在途记录保持 running", async () => {
    // 模拟进程 A：先启动，写入带自身进程标识的在途记录（当前测试进程即存活宿主）
    const first = openStorage();
    writeRunningRun(first, "run-first-inflight", {
      hostSessionId: "session-first",
      hostPid: process.pid,
    });

    // 模拟进程 B：后启动，以持有者身份打开同一数据目录并触发收割
    const second = openStorage({ recoverOrphans: true });
    const observed = second.getRun("run-first-inflight");
    assert.notStrictEqual(observed, null);
    assert.strictEqual(
      observed?.status,
      "running",
      "存活宿主的在途记录不得因会话归属不同被误收割"
    );

    // 进程 A 正常终态结算不受影响
    first.updateRun("run-first-inflight", "success", { done: true });
    assert.strictEqual(first.getRun("run-first-inflight")?.status, "success");

    await second.close();
    await first.close();
  });

  it("确认死亡后可收割：宿主进程探测失败的遗留记录收敛为 interrupted", async () => {
    const deadPid = await findDeadPid();
    const writer = openStorage();
    writeRunningRun(writer, "run-dead-holder", {
      hostSessionId: "session-dead",
      hostPid: deadPid,
    });
    await writer.close();

    const reclaimer = openStorage({ recoverOrphans: true });
    const reclaimed = reclaimer.getRun("run-dead-holder");
    assert.strictEqual(reclaimed?.status, "interrupted");
    assert.strictEqual(reclaimed?.error?.code, "RUN_INTERRUPTED");
    assert.notStrictEqual(reclaimed?.finishedAt, undefined);
    await reclaimer.close();
  });

  it("单语句批量收割：多个死亡宿主的遗留记录在单次打开中批量收敛为 interrupted", async () => {
    const deadPid = await findDeadPid();
    const writer = openStorage();
    writeRunningRun(writer, "run-dead-batch-1", {
      hostSessionId: "session-dead-1",
      hostPid: deadPid,
    });
    writeRunningRun(writer, "run-dead-batch-2", {
      hostSessionId: "session-dead-2",
      hostPid: deadPid,
    });
    await writer.close();

    const reclaimer = openStorage({ recoverOrphans: true });
    assert.strictEqual(reclaimer.getRun("run-dead-batch-1")?.status, "interrupted");
    assert.strictEqual(reclaimer.getRun("run-dead-batch-2")?.status, "interrupted");
    await reclaimer.close();
  });

  it("实例正常退出后的在途记录由下次打开收割（本进程记录在进程退出前不可收割）", async () => {
    // 在途记录先保持不可收割（持有进程存活）
    const writer = openStorage();
    writeRunningRun(writer, "run-exiting", {
      hostSessionId: "session-exit",
      hostPid: process.pid,
    });
    await writer.close();

    const interim = openStorage({ recoverOrphans: true });
    assert.strictEqual(
      interim.getRun("run-exiting")?.status,
      "running",
      "宿主进程仍在运行（本测试进程）时不得收割"
    );
    await interim.close();

    // 模拟宿主进程已死：以确认死亡的进程标识验证收割路径生效
    const deadPid = await findDeadPid();
    const deadWriter = openStorage();
    writeRunningRun(deadWriter, "run-after-exit", {
      hostSessionId: "session-exit-2",
      hostPid: deadPid,
    });
    await deadWriter.close();

    const next = openStorage({ recoverOrphans: true });
    assert.strictEqual(next.getRun("run-after-exit")?.status, "interrupted");
    await next.close();
  });

  it("旁观模式行为不变：recoverOrphans 缺省打开不触碰任何在途记录", async () => {
    const deadPid = await findDeadPid();
    const writer = openStorage();
    writeRunningRun(writer, "run-observed", { hostSessionId: "session-obs", hostPid: deadPid });
    await writer.close();

    const observer = openStorage();
    assert.strictEqual(
      observer.getRun("run-observed")?.status,
      "running",
      "旁观打开不得收割，即使持有进程已死"
    );
    await observer.close();
  });

  it("心跳刷新推迟遗留记录的宽限期判定（FakeClock 确定性驱动）", async () => {
    const clock = new FakeClock({ now: new Date("2026-01-01T00:00:00.000Z") });
    const writer = openStorage({ clock });
    // 遗留形态：无进程标识，仅心跳时间戳
    writeRunningRun(writer, "run-legacy", {
      hostSessionId: "session-legacy",
      startedAt: clock.now().toISOString(),
    });
    await writer.close();

    // 宽限期内：收割在存储构造阶段发生，先推进时钟再打开验证不收割
    await clock.advance(RUN_LIVENESS_GRACE_MS / 2);
    const half = openStorage({ recoverOrphans: true, clock });
    assert.strictEqual(half.getRun("run-legacy")?.status, "running");
    await half.close();

    // 超过宽限期：心跳过期的遗留记录在构造阶段即被收敛
    await clock.advance(RUN_LIVENESS_GRACE_MS + 1000);
    const settled = openStorage({ recoverOrphans: true, clock });
    assert.strictEqual(
      settled.getRun("run-legacy")?.status,
      "interrupted",
      "心跳超过宽限期的遗留记录应被收割"
    );
    await settled.close();
  });

  it("心跳续期使长任务不被宽限期误判（touchRunHeartbeat 刷新后保持 running）", async () => {
    const clock = new FakeClock({ now: new Date("2026-01-01T00:00:00.000Z") });
    const storage = openStorage({ clock });
    writeRunningRun(storage, "run-long", {
      hostSessionId: "session-long",
      startedAt: clock.now().toISOString(),
    });

    // 模拟长任务执行期间的周期性心跳：每推进一段时间刷新一次心跳
    for (let round = 0; round < 4; round++) {
      await clock.advance(RUN_LIVENESS_GRACE_MS / 2);
      storage.touchRunHeartbeat(["run-long"]);
    }

    // 总时长已远超单次宽限期，但心跳持续续期，记录仍在途
    const holder = openStorage({ recoverOrphans: true, clock });
    assert.strictEqual(
      holder.getRun("run-long")?.status,
      "running",
      "心跳持续续期的长任务不得被宽限期误判收割"
    );
    await holder.close();
    await storage.close();
  });

  it("真实跨进程验证：子进程在途记录在子进程存活期间不被收割，退出后被收割", { timeout: 30000 }, async () => {
    // 子进程写入带自身进程标识的在途记录后保持存活
    const childScript = [
      `import { SqliteRuntimeStorage } from ${JSON.stringify("@actiondock/core/package")};`,
      "const storage = new SqliteRuntimeStorage({",
      "  packageId: 'race-pkg',",
      `  dbPath: ${JSON.stringify(join(tempDir, "race-pkg", "runtime.db"))},`,
      "});",
      "storage.createRun({",
      "  id: 'run-child-inflight',",
      "  rootRunId: 'run-child-inflight',",
      "  packageId: 'race-pkg',",
      "  actionId: 'job',",
      "  status: 'running',",
      "  startedAt: new Date().toISOString(),",
      "  hostSessionId: 'session-child',",
      "  hostPid: process.pid,",
      "});",
      "if (process.send) process.send('ready');",
      "process.on('message', () => process.exit(0));",
    ].join("\n");

    const child = spawn(
      process.execPath,
      ["--input-type=module", "--import", pathToFileURL(join(process.cwd(), "scripts/test-preload.ts")).href, "-e", childScript],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] }
    );

    // 等待子进程落库在途记录（就绪消息或超时兑底）
    await new Promise<void>((resolve) => {
      child.once("message", () => resolve());
      setTimeout(resolve, 8000);
    });
    const probe = openStorage();
    assert.notStrictEqual(
      probe.getRun("run-child-inflight"),
      null,
      "expected child run record to appear"
    );
    await probe.close();

    // 子进程存活期间：另一持有者打开不得收割
    const concurrent = openStorage({ recoverOrphans: true });
    assert.strictEqual(
      concurrent.getRun("run-child-inflight")?.status,
      "running",
      "存活子进程的在途记录不得被并发持有者收割"
    );
    await concurrent.close();

    // 子进程退出并完成回收（回收前僵尸态下探测仍返回存活，须等待回收完成）
    const exited = await new Promise<boolean>((resolve) => {
      child.once("exit", () => resolve(true));
      child.send("exit");
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        resolve(false);
      }, 5000);
    });
    assert.strictEqual(exited, true, "expected child process to exit");
    // 显式等待回收，确保内核释放进程标识后探测才返回不存在
    await new Promise<void>((resolve) => {
      const check = () => {
        try {
          process.kill(child.pid!, 0);
          setTimeout(check, 50);
        } catch {
          resolve();
        }
      };
      check();
    });

    const reclaimer = openStorage({ recoverOrphans: true });
    assert.strictEqual(
      reclaimer.getRun("run-child-inflight")?.status,
      "interrupted",
      "子进程退出后的遗留记录应被收割"
    );
    await reclaimer.close();
  });
});

describe("createTestRuntime 驱动的并发实例互不收割", () => {
  it("两个运行时实例共享同一存储时，各自在途记录不被对方收割", async () => {
    // 共享同一存储实例（等价于并发打开同一数据目录的内存形态）
    const sharedStorage = new MemoryStorage({ packageId: "test-pkg" });
    const clock = new FakeClock();

    // 实例一（先启动）正常装配
    createTestRuntime({
      packageId: "test-pkg",
      clock,
      storage: sharedStorage,
    });

    // 实例一的在途记录（宿主进程存活：即当前测试进程）
    sharedStorage.createRun({
      id: "run-first",
      rootRunId: "run-first",
      packageId: "test-pkg",
      actionId: "slow",
      status: "running",
      startedAt: clock.now().toISOString(),
      hostSessionId: "session-first",
      hostPid: process.pid,
    });

    // 实例二（后启动）触发收割路径：存活宿主的记录保持 running
    const before = sharedStorage.getRun("run-first")?.status;
    sharedStorage.recoverDeadSessionRuns("session-second");
    const after = sharedStorage.getRun("run-first")?.status;
    assert.strictEqual(before, "running");
    assert.strictEqual(after, "running", "后启动实例不得收割存活宿主的在途记录");
  });
});

describe("存活判定单元行为（isRunHostDead）", () => {
  it("携带进程标识时以探测结果为准：存活保留，探测失败判死", () => {
    const clock = new FakeClock();
    const alive = isRunHostDead(
      { id: "r1", hostPid: process.pid },
      { clock, probe: () => true }
    );
    assert.strictEqual(alive, false);

    const dead = isRunHostDead(
      { id: "r2", hostPid: 12345 },
      { clock, probe: () => false }
    );
    assert.strictEqual(dead, true);
  });

  it("无进程标识时按心跳宽限期判定：未过期保留，过期判死", async () => {
    const clock = new FakeClock({ now: new Date("2026-01-01T00:00:00.000Z") });
    const base = { id: "r3", heartbeatAt: clock.now().toISOString() };

    await clock.advance(RUN_LIVENESS_GRACE_MS - 1000);
    assert.strictEqual(isRunHostDead(base, { clock }), false);

    await clock.advance(2000);
    assert.strictEqual(isRunHostDead(base, { clock }), true);
  });

  it("心跳与进程标识均缺失时缺少可靠存活依据，不凭开始时间超过九十秒认定死亡，保守保留", async () => {
    const clock = new FakeClock({ now: new Date("2026-01-01T00:00:00.000Z") });
    await clock.advance(RUN_LIVENESS_GRACE_MS + 1000);
    // 缺少可靠依据：不凭 startedAt 认定死亡
    assert.strictEqual(
      isRunHostDead({ id: "r4", startedAt: "2026-01-01T00:00:00.000Z" }, { clock }),
      false
    );
    assert.strictEqual(
      isRunHostDead({ id: "r5", startedAt: clock.now().toISOString() }, { clock }),
      false
    );
  });

  it("完全无判定依据时保守保留（宁可不动也不误杀）", () => {
    const clock = new FakeClock();
    assert.strictEqual(isRunHostDead({ id: "r6" }, { clock }), false);
    assert.strictEqual(
      isRunHostDead({ id: "r7", heartbeatAt: "not-a-date" }, { clock }),
      false
    );
  });

  it("非法进程标识（零、负数、非整数）不触发进程探测，落入心跳兜底", () => {
    const clock = new FakeClock({ now: new Date("2026-01-01T00:00:00.000Z") });
    let probed = false;
    const opts = {
      probe: () => {
        probed = true;
        return false;
      },
    };
    // 零与负数非法：不探测，且无时间基准时保守保留
    assert.strictEqual(isRunHostDead({ id: "r8", hostPid: 0 }, { clock, ...opts }), false);
    assert.strictEqual(isRunHostDead({ id: "r9", hostPid: -5 }, { clock, ...opts }), false);
    assert.strictEqual(probed, false, "非法进程标识不得触发进程探测");
  });
});

/**
 * 寻找一个确认已死亡的进程标识符。
 *
 * 派生短暂子进程并等待其退出并回收（避免僵尸态下探测仍返回存活），
 * 校验探测确认死亡后才返回；不允许时回退到一个几乎不可能被占用的值。
 */
async function findDeadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
    stdio: "ignore",
  });
  const pid = child.pid ?? 0;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve();
    }, 3000);
  });
  if (pid > 0) {
    try {
      process.kill(pid, 0);
    } catch {
      return pid;
    }
  }
  // 探测仍存活（被回收复用等）：回退几乎不可能被占用的标识，并逐次递减重试
  return 99999998;
}
