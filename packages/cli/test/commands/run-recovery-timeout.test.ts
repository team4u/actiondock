import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter as pathDelimiter, join } from "node:path";
import { beginTransaction, hasPendingTransactions } from "@actiondock/core/project";
import { ACTION_TIMEOUT, ActionDockError } from "@actiondock/core";
import { executeAction } from "../../src/commands/run";
import type { CliContext } from "../../src/types";
import { runCliAsync } from "../helpers/run-cli";

describe("CLI ad run - 事务崩溃恢复与前置超时控制", () => {
  let tempDir: string;
  let fakeBinDir: string;
  let spawnedPids: number[] = [];

  /**
   * 写入跨平台 npm 替身：POSIX 为 shebang 垫片，Windows 为 npm.cmd 加标准 npm-cli.js 布局，
   * 行为由 FAKE_NPM_MODE 环境变量统一控制（materialize 物化依赖 / hang 挂起等待终止）。
   */
  function writeFakeNpm(): void {
    const impl = `
const fs = require("node:fs");
const path = require("node:path");
const mode = process.env.FAKE_NPM_MODE;
if (mode === "hang") {
  if (process.env.FAKE_NPM_PID_FILE) {
    fs.writeFileSync(process.env.FAKE_NPM_PID_FILE, String(process.pid));
  }
  setInterval(() => {}, 1000);
} else if (mode === "materialize") {
  const dep = process.env.FAKE_NPM_DEP_NAME;
  const dir = path.join(process.cwd(), "node_modules", dep);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: dep, version: "1.0.0" }));
  fs.writeFileSync(path.join(dir, "actiondock.json"), JSON.stringify({ id: dep, name: dep, version: "1.0.0" }));
}
if (mode !== "hang") process.exit(0);
`;
    writeFileSync(join(fakeBinDir, "npm-impl.cjs"), impl, "utf-8");
    if (process.platform === "win32") {
      // Windows 解析器命中 npm.cmd 后必须能定位标准 npm-cli.js，直接由 Node 运行时加载
      writeFileSync(join(fakeBinDir, "npm.cmd"), '@node "%~dp0npm-impl.cjs" %*\r\n', "utf-8");
      mkdirSync(join(fakeBinDir, "npm", "bin"), { recursive: true });
      writeFileSync(join(fakeBinDir, "npm", "bin", "npm-cli.js"), impl, "utf-8");
    } else {
      const shim = join(fakeBinDir, "npm");
      writeFileSync(shim, '#!/bin/sh\nexec node "$(dirname "$0")/npm-impl.cjs" "$@"\n', {
        mode: 0o755,
      });
      chmodSync(shim, 0o755);
    }
  }

  function fakeNpmEnv(extra?: Record<string, string>): Record<string, string> {
    return {
      PATH: `${fakeBinDir}${pathDelimiter}${process.env.PATH}`,
      ...extra,
    };
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-run-recovery-timeout-"));
    fakeBinDir = mkdtempSync(join(tmpdir(), "ad-fake-bin-"));
    spawnedPids = [];
  });

  afterEach(() => {
    for (const pid of spawnedPids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // 忽略已退出进程
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(fakeBinDir, { recursive: true, force: true });
  });

  function createProjectWithAction(options?: {
    actionDependencies?: Record<string, string>;
    npmDependencies?: Record<string, string>;
    actionCode?: string;
  }): string {
    const manifest: Record<string, any> = {
      id: "recovery-demo-pkg",
      name: "recovery-demo-pkg",
      version: "1.0.0",
      actions: {
        greet: {
          entry: "actions/greet.ts",
          description: "Greeting action",
        },
      },
    };
    if (options?.actionDependencies) {
      manifest.dependencies = options.actionDependencies;
    }
    writeFileSync(join(tempDir, "actiondock.json"), JSON.stringify(manifest, null, 2), "utf-8");

    const pkgJson: Record<string, any> = {
      name: "recovery-demo-pkg",
      version: "1.0.0",
      type: "module",
    };
    if (options?.npmDependencies) {
      pkgJson.dependencies = options.npmDependencies;
    }
    writeFileSync(join(tempDir, "package.json"), JSON.stringify(pkgJson, null, 2), "utf-8");

    mkdirSync(join(tempDir, "actions"), { recursive: true });
    const code =
      options?.actionCode ||
      `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  run(input) {
    return { message: "hello " + (input?.name || "world") };
  }
});
`;
    writeFileSync(join(tempDir, "actions", "greet.ts"), code, "utf-8");

    return tempDir;
  }

  it("正式 Action 依赖 + pending 事务（模拟崩溃并损坏 manifest）+ 缺 node_modules 时 ad run 成功恢复并执行", async () => {
    const dir = createProjectWithAction({
      actionDependencies: {
        "helper-action-dep": "^1.0.0",
      },
      npmDependencies: {
        "helper-action-dep": "^1.0.0",
      },
    });

    // 创建成功执行的 npm 替身，在恢复时物化依赖
    writeFakeNpm();

    // 开启事务并在崩溃前损坏 manifest
    const tx = await beginTransaction(dir, "simulated crash before run");
    writeFileSync(join(dir, "actiondock.json"), "{ damaged corrupted json ...", "utf-8");
    tx.releaseLock();

    assert.strictEqual(hasPendingTransactions(dir), true);

    const res = await runCliAsync(
      ["run", "greet", "--json", "--", "name=Alice"],
      dir,
      fakeNpmEnv({ FAKE_NPM_MODE: "materialize", FAKE_NPM_DEP_NAME: "helper-action-dep" })
    );

    assert.strictEqual(res.exitCode, 0);
    const parsed = JSON.parse(res.stdout.toString());
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.data.message, "hello Alice");

    // 验证事务快照已恢复且已无 pending 事务
    assert.strictEqual(hasPendingTransactions(dir), false);
    const restoredManifest = JSON.parse(readFileSync(join(dir, "actiondock.json"), "utf-8"));
    assert.strictEqual(restoredManifest.id, "recovery-demo-pkg");
    assert.strictEqual(restoredManifest.actions.greet.entry, "actions/greet.ts");
  });

  it("--no-install 时返回 PROJECT_RECOVERY_REQUIRED 且 transaction.json 与损坏 manifest 字节不变", async () => {
    const dir = createProjectWithAction({
      actionDependencies: {
        "helper-action-dep": "^1.0.0",
      },
      npmDependencies: {
        "helper-action-dep": "^1.0.0",
      },
    });

    const tx = await beginTransaction(dir, "simulated crash no-install");
    const damagedContent = "{ damaged manifest bytes for test }";
    writeFileSync(join(dir, "actiondock.json"), damagedContent, "utf-8");
    tx.releaseLock();

    const txDir = join(dir, ".actiondock", "transactions", tx.id);
    const metaPath = join(txDir, "transaction.json");
    const manifestPath = join(dir, "actiondock.json");

    const metaBytesBefore = readFileSync(metaPath);
    const manifestBytesBefore = readFileSync(manifestPath);

    const res = await runCliAsync(["run", "greet", "--no-install", "--json"], dir);

    assert.strictEqual(res.exitCode, 1);
    const parsed = JSON.parse(res.stdout.toString());
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.error.code, "PROJECT_RECOVERY_REQUIRED");

    // 验证 transaction.json 与损坏 manifest 字节绝对不变，零文件改动
    const metaBytesAfter = readFileSync(metaPath);
    const manifestBytesAfter = readFileSync(manifestPath);
    assert.deepStrictEqual(metaBytesAfter, metaBytesBefore);
    assert.deepStrictEqual(manifestBytesAfter, manifestBytesBefore);
    assert.strictEqual(hasPendingTransactions(dir), true);
  });

  it("--timeout 50ms + 卡住安装（npm 替身挂起，PATH 注入）时返回 ACTION_TIMEOUT 且 handler 未执行", async () => {
    const counterFile = join(tempDir, "exec-counter.txt");
    writeFileSync(counterFile, "", "utf-8");

    const dir = createProjectWithAction({
      actionDependencies: {
        "hanging-dep": "^1.0.0",
      },
      npmDependencies: {
        "hanging-dep": "^1.0.0",
      },
      actionCode: `
import { appendFileSync } from "node:fs";
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  run() {
    appendFileSync(${JSON.stringify(counterFile)}, "handler-executed\\n");
    return { ok: true };
  }
});
`,
    });

    const pidFile = join(fakeBinDir, "npm.pid");
    writeFakeNpm();

    const res = await runCliAsync(
      ["run", "greet", "--timeout", "50ms", "--json"],
      dir,
      fakeNpmEnv({ FAKE_NPM_MODE: "hang", FAKE_NPM_PID_FILE: pidFile })
    );

    assert.strictEqual(res.exitCode, 1);
    const parsed = JSON.parse(res.stdout.toString());
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.error.code, "ACTION_TIMEOUT");
    assert.match(parsed.error.message, /50ms/);

    // handler 绝对未执行，计数文件保持为空
    const counterContent = readFileSync(counterFile, "utf-8");
    assert.strictEqual(counterContent, "");

    // 若并发环境下替身已生成 PID，则纳入测试后的清理兜底
    if (existsSync(pidFile)) {
      const rawPid = readFileSync(pidFile, "utf-8").trim();
      if (rawPid) {
        const pid = parseInt(rawPid, 10);
        if (!Number.isNaN(pid)) spawnedPids.push(pid);
      }
    }
  });

  it("已启动的挂起安装替身进程在超时中止后被确定性收尾终止", async () => {
    const counterFile = join(tempDir, "exec-counter-cleanup.txt");
    writeFileSync(counterFile, "", "utf-8");

    const dir = createProjectWithAction({
      actionDependencies: {
        "hanging-dep": "^1.0.0",
      },
      npmDependencies: {
        "hanging-dep": "^1.0.0",
      },
      actionCode: `
import { appendFileSync } from "node:fs";
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  run() {
    appendFileSync(${JSON.stringify(counterFile)}, "handler-executed\\n");
    return { ok: true };
  }
});
`,
    });

    const pidFile = join(fakeBinDir, "npm-cleanup.pid");
    writeFakeNpm();

    const origCwd = process.cwd();
    const origEnv = { ...process.env };
    const abortController = new AbortController();
    const context: CliContext = {
      control: {
        signal: abortController.signal,
        cancellationSource: "external",
      },
      stdout: () => {},
      stderr: () => {},
    };

    try {
      process.chdir(dir);
      Object.assign(
        process.env,
        fakeNpmEnv({ FAKE_NPM_MODE: "hang", FAKE_NPM_PID_FILE: pidFile })
      );

      const actionPromise = executeAction(
        "greet",
        { json: true, install: true },
        context,
        undefined,
        context.control
      );

      // 启动握手：轮询直到替身子进程实际启动并写出 PID
      let pid = 0;
      for (let i = 0; i < 150; i++) {
        if (existsSync(pidFile)) {
          const raw = readFileSync(pidFile, "utf-8").trim();
          if (raw) {
            pid = parseInt(raw, 10);
            if (!Number.isNaN(pid)) break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(pid > 0, "npm substitute process should have started and written its PID");
      spawnedPids.push(pid);

      // 握手确认替身进程存活中
      let isRunningBeforeAbort = true;
      try {
        process.kill(pid, 0);
      } catch {
        isRunningBeforeAbort = false;
      }
      assert.strictEqual(isRunningBeforeAbort, true, "npm substitute process should be running");

      // 触发超时中止
      abortController.abort(
        new ActionDockError(ACTION_TIMEOUT, "Action execution timed out after 50ms.")
      );

      await assert.rejects(actionPromise, (err: any) => {
        return err?.code === "ACTION_TIMEOUT";
      });

      // handler 绝对未执行
      const counterContent = readFileSync(counterFile, "utf-8");
      assert.strictEqual(counterContent, "");

      // 验证替身进程已被终止
      let isAlive = true;
      for (let i = 0; i < 30; i++) {
        try {
          process.kill(pid, 0);
          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch {
          isAlive = false;
          break;
        }
      }
      assert.strictEqual(isAlive, false, "npm substitute process should be terminated after timeout");
    } finally {
      process.chdir(origCwd);
      for (const k of Object.keys(process.env)) {
        if (!(k in origEnv)) {
          delete process.env[k];
        }
      }
      Object.assign(process.env, origEnv);
    }
  });

  it("建图前预检抛错（--no-install + 未结事务）异常退出时，最外层统一清理 timer 绝不泄漏", async () => {
    const dir = createProjectWithAction({
      actionDependencies: { "some-dep": "^1.0.0" },
    });
    // 创建未结事务
    const tx = await beginTransaction(dir, "recovery-test-pending");
    tx.releaseLock();

    let timerCreated: any = undefined;
    let timerCleared: any = undefined;
    const origSetTimeout = global.setTimeout;
    const origClearTimeout = global.clearTimeout;

    try {
      (global as any).setTimeout = (...args: any[]) => {
        const handle = origSetTimeout(...(args as [any, any]));
        if (args[1] === 30000) {
          timerCreated = handle;
        }
        return handle;
      };
      (global as any).clearTimeout = (handle: any) => {
        if (handle === timerCreated) {
          timerCleared = handle;
        }
        return origClearTimeout(handle);
      };

      const res = await runCliAsync(
        ["run", "greet", "--no-install", "--timeout", "30s", "--json"],
        dir
      );
      assert.strictEqual(res.exitCode, 1);
      const parsed = JSON.parse(res.stdout.toString());
      assert.strictEqual(parsed.error.code, "PROJECT_RECOVERY_REQUIRED");

      assert.ok(timerCreated !== undefined, "应当在进入 local 分支时注册 30s 总预算定时器");
      assert.strictEqual(timerCleared, timerCreated, "前置抛错退出时最外层 finally 必须清理该定时器");
    } finally {
      global.setTimeout = origSetTimeout;
      global.clearTimeout = origClearTimeout;
    }
  });
});
