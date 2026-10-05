import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  initProject,
  isRunHostDead,
  startActionDockServer,
  type ActionDockServerInstance,
} from "@actiondock/core";
import {
  pollRunsUntilTerminal,
  resolveRunsByRequestIds,
  type WatchRunSource,
} from "../src/services/run-watch";
import { runCliAsync } from "./helpers/run-cli";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");

/**
 * 寻找一个已确认死亡退出的进程标识符。
 */
async function findDeadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const pid = child.pid ?? 0;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(resolve, 500);
  });
  if (pid > 0) {
    try {
      process.kill(pid, 0);
    } catch {
      return pid;
    }
  }
  return 99999998;
}

describe("CLI runs watch - 四大核心回归用例", () => {
  let tempLocalDir: string;
  let tempRemoteDir: string;
  let tempHome: string;
  let serverInstance: ActionDockServerInstance | undefined;
  let serverUrl: string | undefined;
  const SECRET_TOKEN = "test-secret-token";

  beforeEach(async () => {
    tempLocalDir = mkdtempSync(join(tmpdir(), "ad-watch-local-"));
    tempRemoteDir = mkdtempSync(join(tmpdir(), "ad-watch-remote-"));
    tempHome = mkdtempSync(join(tmpdir(), "ad-watch-home-"));
    process.env.ACTIONDOCK_HOME = tempHome;

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(tempLocalDir, "node_modules"), "junction");
        symlinkSync(rootNodeModules, join(tempRemoteDir, "node_modules"), "junction");
      } catch {}
    }

    // 初始化本地与远端工程
    initProject(tempLocalDir, { id: "test.local-pkg", name: "Local Package" });
    initProject(tempRemoteDir, { id: "test.remote-pkg", name: "Remote Package" });

    // 启动一个真实远端 ActionDock HTTP 服务
    serverInstance = await startActionDockServer({
      port: 0,
      host: "127.0.0.1",
      token: SECRET_TOKEN,
      projectRoot: tempRemoteDir,
    });
    serverUrl = `http://127.0.0.1:${serverInstance.port}`;
  });

  afterEach(async () => {
    delete process.env.ACTIONDOCK_HOME;
    if (serverInstance) {
      try {
        await serverInstance.stop();
      } catch {}
      serverInstance = undefined;
    }
    for (const dir of [tempLocalDir, tempRemoteDir, tempHome]) {
      if (dir && existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
        } catch {}
      }
    }
  });

  // --- 回归场景一：远端工程目录 ---
  describe("回归场景一：远端工程目录隔离（目标解析优先）", () => {
    it("指定远端目标时仅查远端，本地工程目录不触发本地寻址与漏查", async () => {
      // 1. 在远端执行一次 greet，生成远端 run 记录
      const remoteRunRes = await runCliAsync(
        [
          "run",
          "sample.greet",
          "--input",
          '{"name": "RemoteUser"}',
          "--server",
          serverUrl!,
          "--token",
          SECRET_TOKEN,
          "--allow-insecure-http",
          "--json",
        ],
        tempLocalDir
      );
      assert.strictEqual(remoteRunRes.exitCode, 0);
      const remoteRunId = JSON.parse(remoteRunRes.stdout.toString()).runId;

      // 2. 在本地执行一次 greet，生成仅存在于本地库的 run 记录
      const localRunRes = await runCliAsync(
        ["run", "sample.greet", "--input", '{"name": "LocalUser"}', "--json"],
        tempLocalDir
      );
      assert.strictEqual(localRunRes.exitCode, 0);
      const localRunId = JSON.parse(localRunRes.stdout.toString()).runId;

      // 3. 从本地工程目录发起 watch 远端 run：成功命中远端记录并聚合
      const watchRemoteRes = await runCliAsync(
        [
          "runs",
          "watch",
          remoteRunId,
          "--server",
          serverUrl!,
          "--token",
          SECRET_TOKEN,
          "--allow-insecure-http",
          "--interval",
          "100ms",
          "--json",
        ],
        tempLocalDir
      );
      assert.strictEqual(watchRemoteRes.exitCode, 0);
      const remoteAgg = JSON.parse(watchRemoteRes.stdout.toString());
      assert.strictEqual(remoteAgg.ok, true);
      assert.strictEqual(remoteAgg.runs[0].runId, remoteRunId);
      assert.strictEqual(remoteAgg.runs[0].source, "remote");

      // 4. 从本地工程目录发起 watch 本地 run 但指定了远端 server：报错 not found on remote server，不回退本地
      const watchLocalViaRemoteRes = await runCliAsync(
        [
          "runs",
          "watch",
          localRunId,
          "--server",
          serverUrl!,
          "--token",
          SECRET_TOKEN,
          "--allow-insecure-http",
          "--interval",
          "100ms",
          "--json",
        ],
        tempLocalDir
      );
      assert.strictEqual(watchLocalViaRemoteRes.exitCode, 1);
      const errOut = watchLocalViaRemoteRes.stdout.toString() + watchLocalViaRemoteRes.stderr.toString();
      assert.ok(errOut.includes("not found on remote server"), "必须明确报告在远端未找到，不得偷偷在本地查");
    });

    it("位置参数指定包 A 校验不归属时报 not found（远端与本地模式）", async () => {
      // 1. 远端生成一个属于 test.remote-pkg 的运行记录
      const remoteRunRes = await runCliAsync(
        [
          "run",
          "sample.greet",
          "--input",
          '{"name": "RemotePkgUser"}',
          "--server",
          serverUrl!,
          "--token",
          SECRET_TOKEN,
          "--allow-insecure-http",
          "--json",
        ],
        tempLocalDir
      );
      assert.strictEqual(remoteRunRes.exitCode, 0);
      const remoteRunId = JSON.parse(remoteRunRes.stdout.toString()).runId;

      // 2. 指定了不匹配的包标识 test.other-pkg 查询该 runId
      const watchMismatchRes = await runCliAsync(
        [
          "runs",
          "watch",
          remoteRunId,
          "--package",
          "test.other-pkg",
          "--server",
          serverUrl!,
          "--token",
          SECRET_TOKEN,
          "--allow-insecure-http",
          "--json",
        ],
        tempLocalDir
      );
      assert.strictEqual(watchMismatchRes.exitCode, 1);
      const errOut = watchMismatchRes.stdout.toString() + watchMismatchRes.stderr.toString();
      assert.ok(errOut.includes("not found"), "位置参数指定包 A 校验不归属时必须报 not found");
    });
  });

  // --- 回归场景二：重复 requestId 与歧义 ---
  describe("回归场景二：requestId 歧义报错与 runId 去重顺序", () => {
    it("多条匹配明确报歧义，不偷偷选择最新一条", async () => {
      // 模拟 runs.list 针对同一 requestId 返回两条不同的 runId 记录
      const ambiguousService = {
        runs: {
          list: async (query: any) => {
            assert.deepStrictEqual(query.requestIds, ["req-ambiguous"]);
            return [
              { id: "run-newer", requestId: "req-ambiguous", status: "running" },
              { id: "run-older", requestId: "req-ambiguous", status: "success" },
            ];
          },
        },
      } as any;

      await assert.rejects(
        async () => {
          await resolveRunsByRequestIds(ambiguousService, ["req-ambiguous"], {
            intervalMs: 10,
            resolveTimeoutMs: 100,
            now: () => 0,
          });
        },
        (err: any) => {
          assert.ok(err.message.includes("is ambiguous"), "必须明确提示歧义");
          assert.ok(err.message.includes("run-newer"), "必须包含冲突的 runId");
          assert.ok(err.message.includes("run-older"), "必须包含冲突的 runId");
          return true;
        }
      );
    });

    it("位置参数与 requestId 混合时执行 runId 去重且保持用户输入顺序", async () => {
      // 本地先产生两个任务
      const runA = await runCliAsync(
        ["run", "sample.greet", "--input", '{"name": "A"}', "--request-id", "req-A", "--json"],
        tempLocalDir
      );
      const idA = JSON.parse(runA.stdout.toString()).runId;

      const runB = await runCliAsync(
        ["run", "sample.greet", "--input", '{"name": "B"}', "--request-id", "req-B", "--json"],
        tempLocalDir
      );
      const idB = JSON.parse(runB.stdout.toString()).runId;

      // 用户指定重复的位置参数与对应的 requestId：[idB, idA, idB] 与 --request-id req-A
      const watchRes = await runCliAsync(
        [
          "runs",
          "watch",
          idB,
          idA,
          idB,
          "--request-id",
          "req-A",
          "--interval",
          "100ms",
          "--json",
        ],
        tempLocalDir
      );
      assert.strictEqual(watchRes.exitCode, 0);
      const agg = JSON.parse(watchRes.stdout.toString());
      assert.strictEqual(agg.runs.length, 2, "去重后结果数量应为 2");
      // 保持用户最初指定的顺序：先 B，后 A
      assert.strictEqual(agg.runs[0].runId, idB);
      assert.strictEqual(agg.runs[1].runId, idA);
      // idA 通过 --request-id 对应，应携带 requestId
      assert.strictEqual(agg.runs[1].requestId, "req-A");
    });

    it("远端指定包 A 不受包 B 同名 requestId 干扰", async () => {
      // 模拟 runs.list：若限定 packageId 则仅返回匹配包的记录，未限定则返回全部产生歧义
      const multiPackageService = {
        runs: {
          list: async (query: any) => {
            if (query.packageId === "test.pkg-a") {
              return [{ id: "run-a", requestId: "req-shared", packageId: "test.pkg-a", status: "success" }];
            }
            return [
              { id: "run-a", requestId: "req-shared", packageId: "test.pkg-a", status: "success" },
              { id: "run-b", requestId: "req-shared", packageId: "test.pkg-b", status: "success" },
            ];
          },
        },
      } as any;

      // 未传 packageId：报歧义
      await assert.rejects(
        async () => {
          await resolveRunsByRequestIds(multiPackageService, ["req-shared"], {
            intervalMs: 10,
            resolveTimeoutMs: 100,
            now: () => 0,
          });
        },
        (err: any) => {
          assert.ok(err.message.includes("is ambiguous"));
          return true;
        }
      );

      // 传 packageId: "test.pkg-a"：精准隔离，解析成功
      const resolved = await resolveRunsByRequestIds(multiPackageService, ["req-shared"], {
        packageId: "test.pkg-a",
        intervalMs: 10,
        resolveTimeoutMs: 100,
        now: () => 0,
      });
      assert.strictEqual(resolved.resolved.length, 1);
      assert.strictEqual(resolved.resolved[0].runId, "run-a");
      assert.strictEqual(resolved.unresolved.length, 0);
    });

    it("--resolve-timeout 耗时超限后即便查询返回数据依然判定未命中并报错", async () => {
      let nowTime = 0;
      const slowService = {
        runs: {
          list: async () => {
            nowTime += 300; // 查询耗时 300ms
            return [{ id: "run-late", requestId: "req-overdue", status: "running" }];
          },
        },
      } as any;

      const res = await resolveRunsByRequestIds(slowService, ["req-overdue"], {
        intervalMs: 10,
        resolveTimeoutMs: 50, // 预算仅 50ms
        now: () => nowTime,
      });

      assert.strictEqual(res.resolved.length, 0, "超预算返回数据不得算作解析成功");
      assert.deepStrictEqual(res.unresolved, ["req-overdue"]);
    });

    it("CLI 端到端：--resolve-timeout 超限时报错未在指定时限内找到请求", async () => {
      const res = await runCliAsync(
        [
          "runs",
          "watch",
          "--request-id",
          "req-not-exist",
          "--resolve-timeout",
          "50ms",
          "--interval",
          "10ms",
          "--json",
        ],
        tempLocalDir
      );
      assert.strictEqual(res.exitCode, 1);
      const out = res.stdout.toString() + res.stderr.toString();
      assert.ok(out.includes("not found"), "必须明确报告未找到");
      assert.ok(out.includes("within 50ms"), "必须包含超时时限");
      assert.ok(out.includes("req-not-exist"), "必须包含未命中的请求标识");
    });

    it("未触发取消信号时 resolveRunsByRequestIds 遇到包含 aborted 字符串的真实异常直接抛出不吞没", async () => {
      const errorService = {
        runs: {
          list: async () => {
            throw new Error("Database transaction aborted unexpectedly");
          },
        },
      } as any;

      await assert.rejects(
        async () => {
          await resolveRunsByRequestIds(errorService, ["req-test"], {
            intervalMs: 10,
            resolveTimeoutMs: 1000,
            now: () => 0,
          });
        },
        (err: any) => {
          assert.ok(err.message.includes("Database transaction aborted unexpectedly"));
          return true;
        }
      );
    });
  });

  // --- 回归场景三：卡住查询与统一超时取消 ---
  describe("回归场景三：卡住查询与统一超时取消", () => {
    it("查询挂死时取消信号在统一 deadline 到期时触发并退出，不无限阻塞", async () => {
      let aborted = false;
      let cancelCalled = false;

      const hangingService = {
        runs: {
          get: async (_id: string, opts?: { signal?: AbortSignal }) => {
            return new Promise((resolve) => {
              opts?.signal?.addEventListener("abort", () => {
                aborted = true;
                resolve(undefined);
              });
            });
          },
          cancel: async () => {
            cancelCalled = true;
            return { ok: true };
          },
        },
      } as any;

      const started = Date.now();
      const sources: WatchRunSource[] = [{ runId: "run-hang", source: "remote" }];

      const controller = new AbortController();
      const timeoutMs = 200;
      setTimeout(() => controller.abort(), timeoutMs);

      const agg = await pollRunsUntilTerminal(sources, {
        service: hangingService,
        intervalMs: 50,
        timeoutMs,
        timeoutSignal: controller.signal,
        now: () => Date.now(),
      });

      const elapsed = Date.now() - started;
      assert.ok(elapsed < 2000, `超时取消应在短时间内生效，实际耗时 ${elapsed}ms`);
      assert.ok(aborted, "读取查询应当收到取消信号");
      assert.strictEqual(cancelCalled, false, "watch 超时只取消查询与等待，严禁调用任务取消接口");
      assert.strictEqual(agg.ok, false);
      assert.strictEqual(agg.timedOut, true, "必须正确标记 timedOut");
      assert.strictEqual(agg.interrupted, false, "超时绝非外部用户中断");
      assert.strictEqual(agg.reason, "timeout", "结束原因必须为 timeout");
      assert.strictEqual(agg.runs[0].terminal, false, "未到达终态的任务 terminal 必须为 false");
    });

    it("中断信号与超时信号明确区分：用户中断标记 interrupted 且 timedOut=false", async () => {
      const interruptCtrl = new AbortController();
      const hangingService = {
        runs: {
          get: async (_id: string, opts?: { signal?: AbortSignal }) => {
            return new Promise((resolve) => {
              opts?.signal?.addEventListener("abort", () => {
                resolve(undefined);
              });
            });
          },
        },
      } as any;

      setTimeout(() => interruptCtrl.abort(), 50);

      const agg = await pollRunsUntilTerminal([{ runId: "run-interrupted", source: "remote" }], {
        service: hangingService,
        intervalMs: 20,
        signal: interruptCtrl.signal,
        now: () => Date.now(),
      });

      assert.strictEqual(agg.ok, false);
      assert.strictEqual(agg.interrupted, true, "用户中断必须标记 interrupted 为 true");
      assert.strictEqual(agg.timedOut, false, "未超时的用户中断 timedOut 必须为 false");
      assert.strictEqual(agg.reason, "interrupted", "结束原因必须为 interrupted");
    });

    it("真实 HTTP 服务在途期间超时中止：收敛为 timeout 且不误判为 observation_failed", async () => {
      // 在远端数据库中写入一条 running 状态的在途运行记录
      const { createStorage } = await import("@actiondock/core/package");
      const storage = createStorage("test.remote-pkg", {
        customHome: tempHome,
        projectRoot: tempRemoteDir,
        recoverOrphans: false,
      });
      const inFlightRunId = "run-inflight-remote-timeout";
      storage.createRun({
        id: inFlightRunId,
        rootRunId: inFlightRunId,
        packageId: "test.remote-pkg",
        packageInstanceId: "pkg-inst",
        actionId: "sample.greet",
        generationId: "1",
        ownerId: "remote",
        status: "running",
        startedAt: new Date().toISOString(),
      });
      await storage.close();

      // 发起带超时限制的 watch
      const watchRes = await runCliAsync(
        [
          "runs",
          "watch",
          inFlightRunId,
          "--server",
          serverUrl!,
          "--token",
          SECRET_TOKEN,
          "--allow-insecure-http",
          "--timeout",
          "200ms",
          "--interval",
          "50ms",
          "--json",
        ],
        tempLocalDir
      );

      assert.strictEqual(watchRes.exitCode, 1);
      const agg = JSON.parse(watchRes.stdout.toString());
      assert.strictEqual(agg.timedOut, true, "必须标记 timedOut 为 true");
      assert.strictEqual(agg.interrupted, false, "未发生用户中断，interrupted 必须为 false");
      assert.strictEqual(agg.reason, "timeout", "真实 HTTP 轮询超时必须归为 timeout");
      assert.strictEqual(agg.runs[0].error, undefined, "超时中止不得记录为观察失败错误");
      assert.strictEqual(agg.runs[0].status, "running");
      assert.strictEqual(agg.runs[0].terminal, false);
    });

    it("真实 HTTP 服务连接拒绝：正确归类为 observation_failed 且 timedOut=false", async () => {
      if (serverInstance) {
        await serverInstance.stop();
        serverInstance = undefined;
      }

      const { connectActionDock } = await import("@actiondock/core");
      const deadService = await connectActionDock({
        serverUrl: serverUrl!,
        token: SECRET_TOKEN,
        allowInsecureHttp: true,
      });

      const agg = await pollRunsUntilTerminal(
        [{ runId: "run-unreachable", source: "remote" }],
        {
          service: deadService,
          intervalMs: 50,
          timeoutMs: 500,
        }
      );

      assert.strictEqual(agg.ok, false);
      assert.strictEqual(agg.timedOut, false, "连接被拒绝属于观察失败，绝非超时");
      assert.strictEqual(agg.interrupted, false);
      assert.strictEqual(agg.reason, "observation_failed");
      assert.ok(agg.runs[0].error !== undefined, "必须记录观察失败错误");
    });

    it("未触发取消信号时 service.runs.get 抛出包含 aborted 字符串的真实业务错误立即收敛为 observation_failed 不无限重试且不误判为 timeout", async () => {
      let callCount = 0;
      const failingService = {
        runs: {
          get: async (_id: string, opts?: { signal?: AbortSignal }) => {
            callCount++;
            assert.strictEqual(opts?.signal?.aborted ?? false, false);
            throw new Error("HTTP 500: query aborted by database");
          },
        },
      } as any;

      const startedAt = Date.now();
      const sources: WatchRunSource[] = [{ runId: "run-aborted-msg-err", source: "remote" }];

      const agg = await pollRunsUntilTerminal(sources, {
        service: failingService,
        intervalMs: 50,
        timeoutMs: 5000,
        now: () => Date.now(),
      });

      const elapsed = Date.now() - startedAt;
      assert.ok(elapsed < 2000, `必须立即退出，不得持续重试等待超时，实际耗时 ${elapsed}ms`);
      assert.strictEqual(callCount, 3, "未触发取消信号时查询失败连续达到阈值后应记录 queryError 退出");
      assert.strictEqual(agg.ok, false);
      assert.strictEqual(agg.timedOut, false, "业务查询异常严禁误判为 timeout");
      assert.strictEqual(agg.interrupted, false);
      assert.strictEqual(agg.reason, "observation_failed", "结束原因必须为 observation_failed");
      assert.strictEqual(agg.runs.length, 1);
      assert.strictEqual(agg.runs[0].terminal, false);
      assert.ok(agg.runs[0].error !== undefined, "必须记录错误详情");
      assert.ok((agg.runs[0].error as any).message.includes("HTTP 500: query aborted by database"));
    });
  });

  // --- 回归场景四：宿主崩溃（只读观察） ---
  describe("回归场景四：宿主崩溃检测（只读观察且不改动运行记录）", () => {
    it("确认宿主死亡时以 observation_failed 结束等待且不修改数据库记录", async () => {
      const deadPid = await findDeadPid();

      const { createStorage } = await import("@actiondock/core/package");
      const storage = createStorage("test.local-pkg", {
        customHome: tempHome,
        projectRoot: tempLocalDir,
        recoverOrphans: false,
      });
      const runId = "run-dead-host-test";
      storage.createRun({
        id: runId,
        rootRunId: runId,
        packageId: "test.local-pkg",
        packageInstanceId: "pkg-inst",
        actionId: "sample.greet",
        generationId: "1",
        ownerId: "local",
        status: "running",
        startedAt: new Date().toISOString(),
        hostPid: deadPid,
      });
      await storage.close();

      // 执行 watch
      const watchRes = await runCliAsync(
        ["runs", "watch", runId, "--interval", "100ms", "--json"],
        tempLocalDir
      );
      assert.strictEqual(watchRes.exitCode, 1);
      const agg = JSON.parse(watchRes.stdout.toString());
      assert.strictEqual(agg.ok, false);
      assert.strictEqual(agg.reason, "observation_failed");
      assert.strictEqual(agg.runs[0].terminal, false, "查询失败或宿主丢失不代表任务终态");
      assert.strictEqual(agg.runs[0].status, "running", "状态保持真实记录的 running");
      assert.strictEqual(agg.runs[0].error.code, "HOST_LOST", "错误码应为 HOST_LOST 宿主已丢失");

      // 验证底层数据库记录未被 watch 修改（依然是 running，坚持只读）
      const showRes = await runCliAsync(["runs", "show", runId, "--json"], tempLocalDir);
      assert.strictEqual(showRes.exitCode, 0);
      const dbRun = JSON.parse(showRes.stdout.toString());
      assert.strictEqual(dbRun.status, "running", "watch 坚持只读，绝对不得修改持久化运行记录");
    });

    it("缺少可靠存活依据时（无 hostPid 且无 heartbeatAt），不凭开始时间超过九十秒认定死亡", () => {
      const oldStartedAt = new Date(Date.now() - 120_000).toISOString();
      const dead = isRunHostDead({
        id: "run-long",
        status: "running",
        hostPid: undefined,
        heartbeatAt: undefined,
        startedAt: oldStartedAt,
      });
      assert.strictEqual(dead, false, "缺少可靠依据时宁可保守保留，严禁凭 startedAt 认定死亡");
    });
  });
});
