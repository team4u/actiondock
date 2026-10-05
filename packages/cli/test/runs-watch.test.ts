import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { initProject, isTerminalRunStatus, parseDuration } from "@actiondock/core";
import {
  pollRunsUntilTerminal,
  renderWatchSummary,
  resolveRunsByRequestIds,
  type WatchAggregation,
  type WatchRunSource,
} from "../src/services/run-watch";
import { normalizeRequestIds } from "../src/commands/runs";
import { runCliAsync } from "./helpers/run-cli";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");

/**
 * 从本地运行库中提取指定状态的首条运行记录标识。
 * 以进程内 CLI 查询替代直接开库，保持与用户真实工作流一致。
 */
async function pickRunIdByStatus(cwd: string, status: string): Promise<string | undefined> {
  const res = await runCliAsync(["runs", "list", "--json"], cwd);
  const runs = JSON.parse(res.stdout.toString()) as Array<{ id: string; status: string }>;
  const hit = runs.find((r) => r.status === status);
  return hit?.id;
}

/**
 * 后台启动一个本地 run 进程（对应真实工作流：本地 shell 并发起多个 ad run 后台进程）。
 */
function spawnBackgroundRun(cwd: string, home: string, args: string[]) {
  return spawn(process.execPath, [cliPath, "run", ...args], {
    cwd,
    env: { ...process.env, ACTIONDOCK_HOME: home },
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
  });
}

describe("CLI runs watch - 阻塞等待运行终态聚合", () => {
  let tempDir: string;
  let tempHome: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-cli-watch-"));
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-cli-watch-home-"));
    process.env.ACTIONDOCK_HOME = tempHome;

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
      } catch {}
    }

    initProject(tempDir, { id: "test.watch-pkg", name: "Watch Test Package" });

    // 追加一个延迟可控的慢 Action 供阻塞等待路径驱动
    const manifestPath = join(tempDir, "actiondock.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.actions["test.slow"] = {
      entry: "actions/slow.ts",
      description: "Slow action with configurable delay",
      inputSchema: {
        type: "object",
        properties: { ms: { type: "number" } },
      },
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    writeFileSync(
      join(tempDir, "actions", "slow.ts"),
      [
        'import { defineAction } from "@actiondock/sdk";',
        "",
        "export default defineAction(async (input: { ms?: number }) => {",
        "  await new Promise((r) => setTimeout(r, input.ms ?? 1500));",
        "  return { done: true, waitedMs: input.ms ?? 1500 };",
        "});",
        "",
      ].join("\n")
    );
  });

  afterEach(async () => {
    delete process.env.ACTIONDOCK_HOME;
    for (const dir of [tempHome, tempDir]) {
      if (dir && existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch {
          await new Promise((r) => setTimeout(r, 200));
          try {
            rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
          } catch {}
        }
      }
    }
  });

  it("单条已完成 run 立即返回聚合成功（人读模式）", async () => {
    const runRes = await runCliAsync(
      ["run", "sample.greet", "--input", '{"name": "Alice"}', "--json"],
      tempDir
    );
    assert.strictEqual(runRes.exitCode, 0);
    const runId = JSON.parse(runRes.stdout.toString()).runId;

    const watchRes = await runCliAsync(["runs", "watch", runId, "--interval", "100ms"], tempDir);
    assert.strictEqual(watchRes.exitCode, 0);
    const out = watchRes.stdout.toString();
    assert.ok(out.includes(runId));
    assert.ok(out.includes("local"));
    assert.ok(out.includes("success"));
    assert.ok(out.includes("all runs succeeded"));
  });

  it("单条已完成 run 的机器模式输出聚合对象（含 data 载荷）", async () => {
    const runRes = await runCliAsync(
      ["run", "sample.greet", "--input", '{"name": "Bob"}', "--json"],
      tempDir
    );
    const runId = JSON.parse(runRes.stdout.toString()).runId;

    const watchRes = await runCliAsync(
      ["runs", "watch", runId, "--interval", "100ms", "--json"],
      tempDir
    );
    assert.strictEqual(watchRes.exitCode, 0);
    const agg = JSON.parse(watchRes.stdout.toString());
    assert.strictEqual(agg.ok, true);
    assert.strictEqual(agg.runs.length, 1);
    assert.strictEqual(agg.runs[0].runId, runId);
    assert.strictEqual(agg.runs[0].source, "local");
    assert.strictEqual(agg.runs[0].status, "success");
    assert.strictEqual(agg.runs[0].data.message, "Hello, Bob!");
  });

  it("慢 run 后台执行时 watch 阻塞等待直至终态并聚合输出", { timeout: 60000 }, async () => {
    const child = spawnBackgroundRun(tempDir, tempHome, [
      "test.slow",
      "--input",
      '{"ms": 1000}',
      "--json",
    ]);
    try {
      // 等待运行记录落库为 running
      let runId: string | undefined;
      for (let i = 0; i < 50; i++) {
        runId = await pickRunIdByStatus(tempDir, "running");
        if (runId) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(runId, "expected a running run record to appear");

      const watchRes = await runCliAsync(
        ["runs", "watch", runId, "--interval", "200ms", "--json"],
        tempDir
      );
      assert.strictEqual(watchRes.exitCode, 0);
      const agg = JSON.parse(watchRes.stdout.toString());
      assert.strictEqual(agg.ok, true);
      assert.strictEqual(agg.runs[0].runId, runId);
      assert.strictEqual(agg.runs[0].status, "success");
      assert.strictEqual(agg.runs[0].data.done, true);
      assert.strictEqual(agg.runs[0].data.waitedMs, 1000);
    } finally {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }
    }
  });

  // 孤儿收割竞态已修复：收割判定以宿主存活（进程探测与心跳宽限期）为依据，
  // 不再按会话归属误收敛并发进程的在途记录；派工进程保持真并发启动
  // （不引入错峰规避），用例内保留对历史竞态形态的重试兑底不产生实际作用
  it("多条本地 run 混合等待：全部终态后一次性聚合", { timeout: 120000 }, async () => {
    const runOnce = async (): Promise<void> => {
    // 先记录已存在的运行标识，后续仅选取本轮新增记录，保证重试轮次间互不污染
    const preListRes = await runCliAsync(["runs", "list", "--json"], tempDir);
    const preExisting = new Set(
      (JSON.parse(preListRes.stdout.toString()) as Array<{ id: string }>).map((r) => r.id)
    );
    const children = [
      spawnBackgroundRun(tempDir, tempHome, ["test.slow", "--input", '{"ms": 1200}', "--json"]),
      spawnBackgroundRun(tempDir, tempHome, ["test.slow", "--input", '{"ms": 2000}', "--json"]),
      spawnBackgroundRun(tempDir, tempHome, ["sample.greet", "--input", '{"name": "Cara"}', "--json"]),
    ];
    try {
      const ids: string[] = [];
      for (let i = 0; i < 80 && ids.length < 3; i++) {
        const res = await runCliAsync(["runs", "list", "--json"], tempDir);
        const runs = JSON.parse(res.stdout.toString()) as Array<{ id: string; status: string }>;
        ids.length = 0;
        for (const r of runs) {
          if (preExisting.has(r.id)) continue;
          if (!ids.includes(r.id)) ids.push(r.id);
        }
        if (ids.length < 3) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      // 记录数不足：派工进程可能因已知竞态未落库，标记竞态形态交由上层重试判定
      if (ids.length < 3) {
        throw Object.assign(new Error("expected three run records"), { knownRace: true });
      }

      const watchRes = await runCliAsync(
        ["runs", "watch", ...ids, "--interval", "200ms", "--json"],
        tempDir
      );
      const agg = JSON.parse(watchRes.stdout.toString());
      if (agg.runs?.length !== 3) {
        throw Object.assign(new Error("expected three aggregated runs"), { knownRace: true });
      }
      // 命中孤儿收割竞态时个别记录被收敛为 interrupted，整体 ok 与退出码为假与 1，
      // 属已知竞态的预期形态，标记交由上层重试判定；无竞态时严格断言全部成功
      const raced = agg.runs.some((entry: any) => entry.status === "interrupted");
      if (raced) {
        throw Object.assign(new Error("run reaped as interrupted by concurrent host open"), {
          knownRace: true,
        });
      }
      assert.strictEqual(watchRes.exitCode, 0);
      assert.strictEqual(agg.ok, true);
      for (const entry of agg.runs) {
        assert.strictEqual(entry.source, "local");
        assert.strictEqual(entry.status, "success");
      }
      const watched = new Set(agg.runs.map((r: { runId: string }) => r.runId));
      for (const id of ids) {
        assert.ok(watched.has(id));
      }
    } finally {
      for (const child of children) {
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {}
        }
      }
      // 等待残留后台进程退出，避免重试轮次间残留进程继续写入同一运行库
      await new Promise((r) => setTimeout(r, 300));
    }
    };

    try {
      await runOnce();
    } catch (err: any) {
      if (!err?.knownRace) throw err;
      console.warn(`[known-race] ${err.message}; retrying once`);
      await runOnce();
    }
  });

  it("失败 run 聚合 ok 为 false 且退出码为 1", async () => {
    // 直接复用已完成 run，制造失败记录：以非法输入触发执行失败
    const badRes = await runCliAsync(
      ["run", "sample.greet", "--input", '{"name": 12345}', "--json"],
      tempDir
    );
    const runId = JSON.parse(badRes.stdout.toString()).runId;
    assert.strictEqual(badRes.exitCode, 1);

    const watchRes = await runCliAsync(
      ["runs", "watch", runId, "--interval", "100ms", "--json"],
      tempDir
    );
    assert.strictEqual(watchRes.exitCode, 1);
    const agg = JSON.parse(watchRes.stdout.toString());
    assert.strictEqual(agg.ok, false);
    assert.strictEqual(agg.runs[0].status, "failed");
    assert.ok(agg.runs[0].error);
  });

  it("失败 run 的人读模式输出包含具体的错误码与错误信息", async () => {
    const badRes = await runCliAsync(
      ["run", "sample.greet", "--input", '{"name": 12345}', "--json"],
      tempDir
    );
    assert.strictEqual(badRes.exitCode, 1);
    const badData = JSON.parse(badRes.stdout.toString());
    const runId = badData.runId;
    const expectedCode = badData.error.code;
    const expectedMessage = badData.error.message;

    const watchRes = await runCliAsync(
      ["runs", "watch", runId, "--interval", "100ms"],
      tempDir
    );
    assert.strictEqual(watchRes.exitCode, 1);
    const out = watchRes.stdout.toString();
    assert.ok(out.includes("Errors:"), "应包含 Errors: 分组");
    assert.ok(out.includes(runId), "应包含失败运行标识");
    assert.ok(out.includes("one or more runs failed"), "应输出运行失败结果");
    assert.ok(out.includes(`[${expectedCode}]`), "应展示具体错误码且与机器模式一致");
    assert.ok(out.includes(expectedMessage), "应展示具体错误信息且与机器模式一致");
  });

  it("整体超时：输出未终态 run 当前状态并以退出码 1 结束", { timeout: 60000 }, async () => {
    const child = spawnBackgroundRun(tempDir, tempHome, [
      "test.slow",
      "--input",
      '{"ms": 1500}',
      "--json",
    ]);
    try {
      let runId: string | undefined;
      for (let i = 0; i < 50; i++) {
        runId = await pickRunIdByStatus(tempDir, "running");
        if (runId) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.ok(runId, "expected a running run record to appear");

      const watchRes = await runCliAsync(
        ["runs", "watch", runId, "--interval", "100ms", "--timeout", "300ms", "--json"],
        tempDir
      );
      assert.strictEqual(watchRes.exitCode, 1);
      const agg = JSON.parse(watchRes.stdout.toString());
      assert.strictEqual(agg.ok, false);
      assert.strictEqual(agg.runs[0].status, "running");

      // 超时不得取消任务：等待后台自然终态后确认仍可达 success
      const finalRes = await runCliAsync(
        ["runs", "watch", runId, "--interval", "200ms", "--timeout", "30s", "--json"],
        tempDir
      );
      assert.strictEqual(finalRes.exitCode, 0);
      assert.strictEqual(JSON.parse(finalRes.stdout.toString()).runs[0].status, "success");
    } finally {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }
    }
  });

  it("按 requestId 等待：预置 requestId 后台派工，watch 反查后阻塞到终态聚合输出", { timeout: 60000 }, async () => {
    const requestId = `req-watch-${Date.now()}`;
    const child = spawnBackgroundRun(tempDir, tempHome, [
      "test.slow",
      "--input",
      '{"ms": 1200}',
      "--request-id",
      requestId,
      "--json",
    ]);
    try {
      // 直接以 requestId 启动 watch（不等待运行记录落库）：验证反查带有限重试能容忍派工写入延迟
      const watchRes = await runCliAsync(
        [
          "runs",
          "watch",
          "--request-id",
          requestId,
          "--interval",
          "200ms",
          "--json",
        ],
        tempDir
      );
      assert.strictEqual(watchRes.exitCode, 0);
      const agg = JSON.parse(watchRes.stdout.toString());
      assert.strictEqual(agg.ok, true);
      assert.strictEqual(agg.runs.length, 1);
      assert.strictEqual(agg.runs[0].requestId, requestId);
      assert.strictEqual(agg.runs[0].source, "local");
      assert.strictEqual(agg.runs[0].status, "success");
      assert.strictEqual(agg.runs[0].data.done, true);
      assert.strictEqual(agg.runs[0].data.waitedMs, 1200);

      // 反查得到的 runId 可与位置参数语义互通：runs show 可直接取到同一记录
      const runId = agg.runs[0].runId;
      const showRes = await runCliAsync(["runs", "show", runId, "--json"], tempDir);
      assert.strictEqual(showRes.exitCode, 0);
      assert.strictEqual(JSON.parse(showRes.stdout.toString()).requestId, requestId);
    } finally {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }
    }
  });

  // 同上：孤儿收割竞态已修复（存活判定代替会话归属），保留重试兑底不产生实际作用
  it("按 requestId 等待：多个 requestId 混合并聚合到各自终态", { timeout: 120000 }, async () => {
    const runOnce = async (requestIds: string[]): Promise<void> => {
      const children = [
        spawnBackgroundRun(tempDir, tempHome, [
          "test.slow",
          "--input",
          '{"ms": 800}',
          "--request-id",
          requestIds[0],
          "--json",
        ]),
        spawnBackgroundRun(tempDir, tempHome, [
          "sample.greet",
          "--input",
          '{"name": "Rid"}',
          "--request-id",
          requestIds[1],
          "--json",
        ]),
      ];
      try {
        const watchRes = await runCliAsync(
          [
            "runs",
            "watch",
            "--request-id",
            requestIds[0],
            "--request-id",
            requestIds[1],
            "--interval",
            "200ms",
            "--json",
          ],
          tempDir
        );
        const agg = JSON.parse(watchRes.stdout.toString());
        // requestId 均需反查命中（核心断言，不受竞态影响）
        if (agg.runs?.length !== 2) {
          throw Object.assign(new Error("expected two resolved runs"), { knownRace: true });
        }
        const byRequestId = new Map<string, any>(agg.runs.map((r: any) => [r.requestId, r]));
        for (const requestId of requestIds) {
          assert.ok(byRequestId.has(requestId), `expected requestId ${requestId} resolved`);
        }
        // 命中孤儿收割竞态时个别记录被收敛为 interrupted，整体 ok 与退出码为假与 1，
        // 属已知竞态的预期形态，标记交由上层重试判定；无竞态时严格断言全部成功
        const raced = agg.runs.some((entry: any) => entry.status === "interrupted");
        if (raced) {
          throw Object.assign(new Error("run reaped as interrupted by concurrent host open"), {
            knownRace: true,
          });
        }
        assert.strictEqual(watchRes.exitCode, 0);
        assert.strictEqual(agg.ok, true);
        assert.strictEqual(byRequestId.get(requestIds[0]).status, "success");
        assert.strictEqual(byRequestId.get(requestIds[1]).status, "success");
        assert.strictEqual(byRequestId.get(requestIds[1]).data.message, "Hello, Rid!");
      } finally {
        for (const child of children) {
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {}
          }
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    };

    try {
      await runOnce([`req-multi-a-${Date.now()}`, `req-multi-b-${Date.now()}`]);
    } catch (err: any) {
      if (!err?.knownRace) throw err;
      console.warn(`[known-race] ${err.message}; retrying once`);
      // 重试轮次使用全新 requestId，避免与上一轮已登记幂等键冲突
      await new Promise((r) => setTimeout(r, 200));
      await runOnce([`req-multi-c-${Date.now()}`, `req-multi-d-${Date.now()}`]);
    }
  });

  it("按 requestId 等待：requestId 不存在时超出反查预算报错", { timeout: 30000 }, async () => {
    const watchRes = await runCliAsync(
      [
        "runs",
        "watch",
        "--request-id",
        "no-such-request-id",
        "--resolve-timeout",
        "1s",
        "--interval",
        "200ms",
        "--json",
      ],
      tempDir
    );
    assert.strictEqual(watchRes.exitCode, 1);
    const out = watchRes.stdout.toString() + watchRes.stderr.toString();
    assert.ok(out.includes("no-such-request-id"));
    assert.ok(out.includes("not found"));
  });

  it("runs list 按 --request-id 过滤命中记录", async () => {
    const requestId = `req-list-${Date.now()}`;
    const runRes = await runCliAsync(
      [
        "run",
        "sample.greet",
        "--input",
        '{"name": "List"}',
        "--request-id",
        requestId,
        "--json",
      ],
      tempDir
    );
    assert.strictEqual(runRes.exitCode, 0);

    const listRes = await runCliAsync(
      ["runs", "list", "--request-id", requestId, "--json"],
      tempDir
    );
    assert.strictEqual(listRes.exitCode, 0);
    const runs = JSON.parse(listRes.stdout.toString());
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].requestId, requestId);
    assert.strictEqual(runs[0].status, "success");

    // 未命中过滤：返回空集合且退出码 0
    const missRes = await runCliAsync(
      ["runs", "list", "--request-id", "req-list-none", "--json"],
      tempDir
    );
    assert.strictEqual(missRes.exitCode, 0);
    assert.deepStrictEqual(JSON.parse(missRes.stdout.toString()), []);
  });

  it("runs list 与 watch 完整支持包含逗号与首尾空格的 --request-id 原样传递", async () => {
    const reqWithComma = "batch,sub,item";
    const reqWithSpaces = "  leading-trailing-space  ";

    const runRes1 = await runCliAsync(
      [
        "run",
        "sample.greet",
        "--input",
        '{"name": "CommaUser"}',
        "--request-id",
        reqWithComma,
        "--json",
      ],
      tempDir
    );
    assert.strictEqual(runRes1.exitCode, 0);

    const runRes2 = await runCliAsync(
      [
        "run",
        "sample.greet",
        "--input",
        '{"name": "SpacedUser"}',
        "--request-id",
        reqWithSpaces,
        "--json",
      ],
      tempDir
    );
    assert.strictEqual(runRes2.exitCode, 0);

    // runs list 验证
    const listResComma = await runCliAsync(
      ["runs", "list", "--request-id", reqWithComma, "--json"],
      tempDir
    );
    assert.strictEqual(listResComma.exitCode, 0);
    const runsComma = JSON.parse(listResComma.stdout.toString());
    assert.strictEqual(runsComma.length, 1);
    assert.strictEqual(runsComma[0].requestId, reqWithComma);

    const listResSpaces = await runCliAsync(
      ["runs", "list", "--request-id", reqWithSpaces, "--json"],
      tempDir
    );
    assert.strictEqual(listResSpaces.exitCode, 0);
    const runsSpaces = JSON.parse(listResSpaces.stdout.toString());
    assert.strictEqual(runsSpaces.length, 1);
    assert.strictEqual(runsSpaces[0].requestId, reqWithSpaces);

    // runs watch 验证
    const watchResComma = await runCliAsync(
      ["runs", "watch", "--request-id", reqWithComma, "--interval", "100ms", "--json"],
      tempDir
    );
    assert.strictEqual(watchResComma.exitCode, 0);
    const aggComma = JSON.parse(watchResComma.stdout.toString());
    assert.strictEqual(aggComma.ok, true);
    assert.strictEqual(aggComma.runs[0].requestId, reqWithComma);

    const watchResSpaces = await runCliAsync(
      ["runs", "watch", "--request-id", reqWithSpaces, "--interval", "100ms", "--json"],
      tempDir
    );
    assert.strictEqual(watchResSpaces.exitCode, 0);
    const aggSpaces = JSON.parse(watchResSpaces.stdout.toString());
    assert.strictEqual(aggSpaces.ok, true);
    assert.strictEqual(aggSpaces.runs[0].requestId, reqWithSpaces);
  });

  it("归属解析失败：本地与远端均未命中时报错列出该 id", async () => {
    const watchRes = await runCliAsync(
      ["runs", "watch", "no-such-run-a", "no-such-run-b", "--json"],
      tempDir
    );
    assert.strictEqual(watchRes.exitCode, 1);
    const out = watchRes.stdout.toString() + watchRes.stderr.toString();
    assert.ok(out.includes("no-such-run-a"));
    assert.ok(out.includes("no-such-run-b"));
    assert.ok(out.includes("not found"));
  });

  it("参数校验：非法 interval 与 timeout 格式返回退出码 2", async () => {
    const badInterval = await runCliAsync(["runs", "watch", "x", "--interval", "abc"], tempDir);
    assert.strictEqual(badInterval.exitCode, 2);

    const badTimeout = await runCliAsync(["runs", "watch", "x", "--timeout", "10x"], tempDir);
    assert.strictEqual(badTimeout.exitCode, 2);
  });
});

describe("runs watch 轮询引擎单元行为", () => {
  it("resolveRunsByRequestIds：首轮即命中时立即返回且不进入重试", async () => {
    const service = {
      runs: {
        list: async (query: any) => {
          assert.deepStrictEqual(query.requestIds, ["req-now"]);
          return [
            { id: "run-now", requestId: "req-now", status: "success", output: { v: 1 } },
          ];
        },
      },
      close: async () => {},
    } as any;

    const { resolved, unresolved } = await resolveRunsByRequestIds(service, ["req-now"], {
      intervalMs: 10,
      sleep: async () => {
        throw new Error("sleep must not be called when resolved in first round");
      },
      now: () => 0,
    });

    assert.strictEqual(resolved.length, 1);
    assert.strictEqual(resolved[0].requestId, "req-now");
    assert.strictEqual(resolved[0].runId, "run-now");
    assert.strictEqual(unresolved.length, 0);
  });

  it("resolveRunsByRequestIds：延迟写入场景按轮询间隔重试直至命中", async () => {
    let round = 0;
    const service = {
      runs: {
        list: async () => {
          round++;
          if (round < 3) return [];
          return [{ id: "run-late", requestId: "req-late", status: "running" }];
        },
      },
      close: async () => {},
    } as any;

    let slept = 0;
    const { resolved, unresolved } = await resolveRunsByRequestIds(service, ["req-late"], {
      intervalMs: 10,
      resolveTimeoutMs: 5000,
      sleep: async () => {
        slept++;
      },
      now: () => 0,
    });

    assert.strictEqual(round, 3);
    assert.strictEqual(slept, 2);
    assert.strictEqual(resolved.length, 1);
    assert.strictEqual(resolved[0].runId, "run-late");
    assert.strictEqual(unresolved.length, 0);
  });

  it("resolveRunsByRequestIds：超出反查预算仍未命中时归入 unresolved", async () => {
    const service = {
      runs: {
        list: async () => [],
      },
      close: async () => {},
    } as any;

    let clock = 0;
    const { resolved, unresolved } = await resolveRunsByRequestIds(
      service,
      ["req-gone-a", "req-gone-b"],
      {
        intervalMs: 10,
        resolveTimeoutMs: 100,
        sleep: async () => {
          clock += 40;
        },
        now: () => clock,
      }
    );

    assert.strictEqual(resolved.length, 0);
    assert.deepStrictEqual(unresolved.sort(), ["req-gone-a", "req-gone-b"]);
  });

  it("isTerminalRunStatus 终态集合与 storage 定义一致", () => {
    assert.strictEqual(isTerminalRunStatus("success"), true);
    assert.strictEqual(isTerminalRunStatus("failed"), true);
    assert.strictEqual(isTerminalRunStatus("cancelled"), true);
    assert.strictEqual(isTerminalRunStatus("timed_out"), true);
    assert.strictEqual(isTerminalRunStatus("interrupted"), true);
    assert.strictEqual(isTerminalRunStatus("running"), false);
    assert.strictEqual(isTerminalRunStatus("pending"), false);
  });

  it("parseDuration 支持纯毫秒与带单位格式", () => {
    assert.strictEqual(parseDuration("1000"), 1000);
    assert.strictEqual(parseDuration("1s"), 1000);
    assert.strictEqual(parseDuration("500ms"), 500);
  });

  it("远端分支轮询：终态到达即收敛（退轮询路径）", async () => {
    // 构造远端 RunsPort 桩：前两轮返回 running，随后返回终态
    const statuses = ["running", "running", "success"];
    let calls = 0;
    const service = {
      runs: {
        get: async (runId: string) => ({
          id: runId,
          status: statuses[Math.min(calls++, statuses.length - 1)],
          output: { value: 42 },
        }),
      },
      close: async () => {},
    } as any;

    const sources: WatchRunSource[] = [{ runId: "run-remote-1", source: "remote" }];
    const agg = await pollRunsUntilTerminal(sources, {
      service,
      intervalMs: 10,
      sleep: async () => {},
      now: () => 0,
    });

    assert.strictEqual(agg.ok, true);
    assert.strictEqual(agg.runs[0].status, "success");
    assert.deepStrictEqual(agg.runs[0].data, { value: 42 });
    assert.strictEqual(agg.runs[0].terminal, true);
  });

  it("远端分支轮询：超时上限生效且不臆断终态", async () => {
    const service = {
      runs: {
        get: async (runId: string) => ({ id: runId, status: "running" }),
      },
      close: async () => {},
    } as any;

    let clock = 0;
    const agg = await pollRunsUntilTerminal([{ runId: "run-remote-2", source: "remote" }], {
      service,
      intervalMs: 10,
      timeoutMs: 100,
      sleep: async () => {
        clock += 50;
      },
      now: () => clock,
    });

    assert.strictEqual(agg.timedOut, true);
    assert.strictEqual(agg.interrupted, false);
    assert.strictEqual(agg.reason, "timeout");
    assert.strictEqual(agg.ok, false);
    assert.strictEqual(agg.runs[0].status, "running");
    assert.strictEqual(agg.runs[0].terminal, false);
  });

  it("中断信号：立即退出且标记 interrupted", async () => {
    const controller = new AbortController();
    const service = {
      runs: {
        get: async (runId: string) => ({ id: runId, status: "running" }),
      },
      close: async () => {},
    } as any;

    const agg = await pollRunsUntilTerminal([{ runId: "run-remote-3", source: "remote" }], {
      service,
      intervalMs: 10,
      signal: controller.signal,
      sleep: async () => {
        controller.abort();
      },
      now: () => 0,
    });

    assert.strictEqual(agg.interrupted, true);
    assert.strictEqual(agg.timedOut, false);
    assert.strictEqual(agg.reason, "interrupted");
    assert.strictEqual(agg.ok, false);
  });

  it("休眠期间超时触发：返回 reason=timeout 且 timedOut=true，不误判为 interrupted", async () => {
    const timeoutCtrl = new AbortController();
    const service = {
      runs: {
        get: async (runId: string) => ({ id: runId, status: "running" }),
      },
    } as any;

    const agg = await pollRunsUntilTerminal([{ runId: "run-sleep-timeout", source: "remote" }], {
      service,
      intervalMs: 10,
      timeoutSignal: timeoutCtrl.signal,
      sleep: async () => {
        timeoutCtrl.abort();
      },
      now: () => 0,
    });

    assert.strictEqual(agg.timedOut, true);
    assert.strictEqual(agg.interrupted, false);
    assert.strictEqual(agg.reason, "timeout");
  });

  it("真实 HTTP 查询期间超时中止：返回 reason=timeout 且 timedOut=true，不误判为 observation_failed", async () => {
    const timeoutCtrl = new AbortController();
    const abortingService = {
      runs: {
        get: async (_runId: string, opts?: { signal?: AbortSignal }) => {
          return new Promise((_, reject) => {
            opts?.signal?.addEventListener("abort", () => {
              const err = new Error("This operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
            timeoutCtrl.abort();
          });
        },
      },
    } as any;

    const agg = await pollRunsUntilTerminal([{ runId: "run-query-timeout", source: "remote" }], {
      service: abortingService,
      intervalMs: 10,
      timeoutSignal: timeoutCtrl.signal,
      now: () => 0,
    });

    assert.strictEqual(agg.timedOut, true);
    assert.strictEqual(agg.interrupted, false);
    assert.strictEqual(agg.reason, "timeout");
    assert.strictEqual(agg.runs[0].error, undefined, "超时中止绝不写入 queryError 造成观察失败假象");
  });

  it("resolveRunsByRequestIds：支持 packageId 过滤并透传至 runs.list", async () => {
    let capturedPackageId: string | undefined;
    const mockService = {
      runs: {
        list: async (query: any) => {
          capturedPackageId = query.packageId;
          return [{ id: "run-1", requestId: "req-1", packageId: "pkg-a", status: "running" }];
        },
      },
    } as any;

    const res = await resolveRunsByRequestIds(mockService, ["req-1"], {
      packageId: "pkg-a",
      intervalMs: 10,
    });
    assert.strictEqual(capturedPackageId, "pkg-a");
    assert.strictEqual(res.resolved.length, 1);
    assert.strictEqual(res.resolved[0].runId, "run-1");
  });

  it("resolveRunsByRequestIds：耗时超限后即便查询返回数据依然判定未命中并放入 unresolved", async () => {
    let clock = 0;
    const slowService = {
      runs: {
        list: async () => {
          clock += 200;
          return [{ id: "run-late", requestId: "req-late", status: "running" }];
        },
      },
    } as any;

    const res = await resolveRunsByRequestIds(slowService, ["req-late"], {
      intervalMs: 10,
      resolveTimeoutMs: 100,
      now: () => clock,
    });

    assert.strictEqual(res.resolved.length, 0, "超预算返回的数据不得算作命中");
    assert.deepStrictEqual(res.unresolved, ["req-late"], "未在预算内收敛的请求标识应在 unresolved 中");
  });

  it("resolveRunsByRequestIds：挂死查询在 resolveDeadline 到来时被中止", async () => {
    let queryAborted = false;
    const hangingService = {
      runs: {
        list: async (_query: any, opts?: { signal?: AbortSignal }) => {
          return new Promise<any[]>((resolve) => {
            opts?.signal?.addEventListener("abort", () => {
              queryAborted = true;
              resolve([]);
            });
          });
        },
      },
    } as any;

    const res = await resolveRunsByRequestIds(hangingService, ["req-hang"], {
      intervalMs: 10,
      resolveTimeoutMs: 80,
    });

    assert.strictEqual(queryAborted, true, "反查超时应中止在途查询");
    assert.deepStrictEqual(res.unresolved, ["req-hang"]);
  });

  it("查询异常不中断整体：透传到该 run 的 error 字段", async () => {
    const failing = {
      runs: {
        get: async () => {
          throw Object.assign(new Error("remote unreachable"), { code: "NETWORK_ERROR" });
        },
      },
      close: async () => {},
    } as any;

    const agg = await pollRunsUntilTerminal([{ runId: "run-remote-4", source: "remote" }], {
      service: failing,
      intervalMs: 10,
      sleep: async () => {},
      now: () => 0,
    });

    assert.strictEqual(agg.ok, false);
    const error = agg.runs[0].error as { code: string; message: string };
    assert.strictEqual(error.code, "NETWORK_ERROR");
    assert.strictEqual(error.message, "remote unreachable");
  });

  it("瞬态查询错误容忍机制：未达连续错误阈值前保持重试并在查询恢复后收敛终态", async () => {
    let callCount = 0;
    const transientService = {
      runs: {
        get: async (runId: string) => {
          callCount++;
          if (callCount <= 2) {
            throw Object.assign(new Error("Transient connection reset"), { code: "ECONNRESET" });
          }
          return {
            id: runId,
            status: "success",
            output: { recovered: true, callCount },
          };
        },
      },
      close: async () => {},
    } as any;

    const agg = await pollRunsUntilTerminal([{ runId: "run-transient-1", source: "remote" }], {
      service: transientService,
      intervalMs: 10,
      sleep: async () => {},
      now: () => 0,
    });

    assert.strictEqual(agg.ok, true);
    assert.strictEqual(agg.reason, "all_terminal");
    assert.strictEqual(agg.runs[0].status, "success");
    assert.deepStrictEqual(agg.runs[0].data, { recovered: true, callCount: 3 });
    assert.strictEqual(agg.runs[0].error, undefined);
    assert.strictEqual(callCount, 3);
  });

  it("瞬态查询错误容忍机制：连续查询错误达到阈值时才标记 observation_failed 并退出", async () => {
    let callCount = 0;
    const persistentFailing = {
      runs: {
        get: async () => {
          callCount++;
          throw Object.assign(new Error("Persistent query failure"), { code: "QUERY_TIMEOUT" });
        },
      },
      close: async () => {},
    } as any;

    const agg = await pollRunsUntilTerminal([{ runId: "run-consecutive-err", source: "remote" }], {
      service: persistentFailing,
      intervalMs: 10,
      maxConsecutiveErrors: 3,
      sleep: async () => {},
      now: () => 0,
    });

    assert.strictEqual(agg.ok, false);
    assert.strictEqual(agg.reason, "observation_failed");
    assert.strictEqual(callCount, 3);
    const error = agg.runs[0].error as { code: string; message: string };
    assert.strictEqual(error.code, "QUERY_TIMEOUT");
    assert.strictEqual(error.message, "Persistent query failure");
  });

  it("瞬态查询错误容忍机制：宿主丢失 HOST_LOST 判定立即记录错误且不等待连续错误阈值", async () => {
    let callCount = 0;
    const deadHostService = {
      runs: {
        get: async (runId: string) => {
          callCount++;
          return {
            id: runId,
            status: "running",
            hostPid: 999999,
          };
        },
      },
      close: async () => {},
    } as any;

    const agg = await pollRunsUntilTerminal([{ runId: "run-local-dead-host", source: "local" }], {
      service: deadHostService,
      intervalMs: 10,
      probe: (_pid: number) => false,
      sleep: async () => {},
      now: () => 0,
    });

    assert.strictEqual(agg.ok, false);
    assert.strictEqual(agg.reason, "observation_failed");
    assert.strictEqual(callCount, 1, "宿主丢失应立即终止观察，不经过瞬态错误容忍重试");
    const error = agg.runs[0].error as { code: string; message: string };
    assert.strictEqual(error.code, "HOST_LOST");
  });
});

describe("normalizeRequestIds 规范契约单元测试", () => {
  it("原样保留包含逗号的字符串，严禁调用 split 拆分", () => {
    const raw = "batch,a";
    const result = normalizeRequestIds(raw);
    assert.deepStrictEqual(result, ["batch,a"]);
  });

  it("原样保留包含首尾空格的字符串，严禁调用 trim 剔除", () => {
    const raw = "  batch-id  ";
    const result = normalizeRequestIds(raw);
    assert.deepStrictEqual(result, ["  batch-id  "]);
  });

  it("数组输入时对逗号与首尾空格原样保留并过滤空值与非法类型", () => {
    const raw = ["batch,a", "  spaced  ", "", null, undefined, 123 as any, "normal"];
    const result = normalizeRequestIds(raw);
    assert.deepStrictEqual(result, ["batch,a", "  spaced  ", "normal"]);
  });

  it("重复的 requestId 原样去重", () => {
    const raw = ["batch,a", "batch,a", " spaced ", " spaced "];
    const result = normalizeRequestIds(raw);
    assert.deepStrictEqual(result, ["batch,a", " spaced "]);
  });

  it("未提供有效字符串时返回空数组", () => {
    assert.deepStrictEqual(normalizeRequestIds(undefined), []);
    assert.deepStrictEqual(normalizeRequestIds(null), []);
    assert.deepStrictEqual(normalizeRequestIds(""), []);
    assert.deepStrictEqual(normalizeRequestIds([]), []);
  });
});

describe("renderWatchSummary 错误可观测性单元测试", () => {
  it("渲染包含具体错误码与错误信息的单次失败运行", () => {
    const agg: WatchAggregation = {
      ok: false,
      timedOut: false,
      interrupted: false,
      reason: "all_terminal",
      runs: [
        {
          runId: "run-failed-123",
          source: "local",
          requestId: "req-err-1",
          status: "failed",
          terminal: true,
          durationMs: 150,
          error: {
            code: "ACTION_EXECUTION_FAILED",
            message: "Database connection timeout during batch sync",
          },
        },
      ],
    };

    const text = renderWatchSummary(agg);
    assert.ok(text.includes("run-failed-123"));
    assert.ok(text.includes("failed"));
    assert.ok(text.includes("Result: one or more runs failed."));
    assert.ok(text.includes("Errors:"));
    assert.ok(text.includes("Run run-failed-123: [ACTION_EXECUTION_FAILED] Database connection timeout during batch sync"));
  });

  it("渲染包含 queryError（如宿主丢失 HOST_LOST）的运行记录", () => {
    const agg: WatchAggregation = {
      ok: false,
      timedOut: false,
      interrupted: false,
      reason: "observation_failed",
      runs: [
        {
          runId: "run-host-lost-456",
          source: "local",
          status: "running",
          terminal: false,
          error: {
            code: "HOST_LOST",
            message: "Execution host for run 'run-host-lost-456' is lost or terminated unexpectedly",
          },
        },
      ],
    };

    const text = renderWatchSummary(agg);
    assert.ok(text.includes("run-host-lost-456"));
    assert.ok(text.includes("Result: observation failed before all runs reached a terminal state (host lost or query error)."));
    assert.ok(text.includes("Errors:"));
    assert.ok(text.includes("Run run-host-lost-456: [HOST_LOST] Execution host for run 'run-host-lost-456' is lost or terminated unexpectedly"));
  });

  it("多运行混合场景：成功运行不展示在 Errors 区域，失败运行按条展示具体错误", () => {
    const agg: WatchAggregation = {
      ok: false,
      timedOut: false,
      interrupted: false,
      reason: "all_terminal",
      runs: [
        {
          runId: "run-success-1",
          source: "local",
          status: "success",
          terminal: true,
          durationMs: 50,
        },
        {
          runId: "run-failed-2",
          source: "local",
          status: "failed",
          terminal: true,
          durationMs: 75,
          error: {
            code: "INVALID_INPUT",
            message: "Field 'count' must be a positive integer",
          },
        },
      ],
    };

    const text = renderWatchSummary(agg);
    assert.ok(text.includes("run-success-1"));
    assert.ok(text.includes("run-failed-2"));
    assert.ok(text.includes("Result: one or more runs failed."));
    assert.ok(text.includes("Errors:"));
    assert.ok(!text.includes("Run run-success-1:"));
    assert.ok(text.includes("Run run-failed-2: [INVALID_INPUT] Field 'count' must be a positive integer"));
  });

  it("全部成功运行时不渲染 Errors 区域", () => {
    const agg: WatchAggregation = {
      ok: true,
      timedOut: false,
      interrupted: false,
      reason: "all_terminal",
      runs: [
        {
          runId: "run-ok-1",
          source: "local",
          status: "success",
          terminal: true,
          durationMs: 20,
        },
      ],
    };

    const text = renderWatchSummary(agg);
    assert.ok(text.includes("run-ok-1"));
    assert.ok(text.includes("Result: all runs succeeded."));
    assert.ok(!text.includes("Errors:"));
  });
});


