import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");
const githubToolsDir = resolve(import.meta.dirname, "../../../examples/github-tools");

interface RunCliOptions {
  cwd?: string;
  env?: Record<string, string>;
  input?: string;
}

/**
 * 直接通过 spawnSync 调用 ad 命令行二进制文件。
 * 显式隔离父进程的告警相关环境变量，确保测试在干净环境中运行。
 */
function runCliBinary(
  args: string[],
  options: RunCliOptions = {}
): SpawnSyncReturns<string> {
  const baseEnv = { ...process.env };
  delete baseEnv.ACTIONDOCK_SILENCE_WARNINGS;
  delete baseEnv.NODE_OPTIONS;

  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd ?? githubToolsDir,
    env: {
      ...baseEnv,
      ...options.env,
    },
    input: options.input,
    encoding: "utf-8",
  });
}

/**
 * 模拟外部调度框架或包装脚本通过派生子进程执行 ad 命令行二进制文件。
 */
function runDerivedCli(
  args: string[],
  options: RunCliOptions = {}
): SpawnSyncReturns<string> {
  const baseEnv = { ...process.env };
  delete baseEnv.ACTIONDOCK_SILENCE_WARNINGS;
  delete baseEnv.NODE_OPTIONS;

  const wrapperScript = `
import { spawnSync } from "node:child_process";
const res = spawnSync(process.execPath, [
  ${JSON.stringify(cliPath)},
  ...process.argv.slice(1)
], {
  cwd: ${JSON.stringify(options.cwd ?? githubToolsDir)},
  env: process.env,
  encoding: "utf-8"
});
process.stdout.write(res.stdout || "");
process.stderr.write(res.stderr || "");
process.exit(res.status ?? 0);
`;

  return spawnSync(
    process.execPath,
    ["--input-type=module", "-e", wrapperScript, ...args],
    {
      cwd: options.cwd ?? githubToolsDir,
      env: {
        ...baseEnv,
        ...options.env,
      },
      encoding: "utf-8",
    }
  );
}

describe("CLI 端到端实验性告警拦截自动化测试防护网", () => {
  it("前置断言：CLI 入口二进制文件与示例工程目录均存在", () => {
    assert.ok(existsSync(cliPath), `CLI 二进制入口文件不存在: ${cliPath}`);
    assert.ok(existsSync(githubToolsDir), `示例工程目录不存在: ${githubToolsDir}`);
  });

  describe("默认执行环境下的实验性告警静默断言", () => {
    it("执行 ad info 时标准错误流不包含 ExperimentalWarning 且命令成功退出", () => {
      const res = runCliBinary(["info"]);

      assert.strictEqual(res.status, 0, `命令执行失败，stderr: ${res.stderr}`);
      assert.ok(
        !res.stderr.includes("ExperimentalWarning"),
        `stderr 中不应包含 ExperimentalWarning，实际输出: ${res.stderr}`
      );
      assert.ok(
        !res.stderr.includes("SQLite is an experimental feature"),
        `stderr 中不应包含 SQLite 实验性告警，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stdout.includes("team4u.github-tools"),
        `stdout 应包含工程标识，实际输出: ${res.stdout}`
      );
    });

    it("执行 ad run list-prs 时标准错误流不包含 ExperimentalWarning 且命令成功退出", () => {
      const res = runCliBinary([
        "run",
        "list-prs",
        "--input",
        JSON.stringify({ repo: "actiondock" }),
      ]);

      assert.strictEqual(res.status, 0, `命令执行失败，stderr: ${res.stderr}`);
      assert.ok(
        !res.stderr.includes("ExperimentalWarning"),
        `stderr 中不应包含 ExperimentalWarning，实际输出: ${res.stderr}`
      );
      assert.ok(
        !res.stderr.includes("SQLite is an experimental feature"),
        `stderr 中不应包含 SQLite 实验性告警，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stdout.includes("feat(core): support bun native compilation"),
        `stdout 应包含动作执行结果，实际输出: ${res.stdout}`
      );
    });

    it("执行 ad list 时标准错误流不包含 ExperimentalWarning 且命令成功退出", () => {
      const res = runCliBinary(["list"]);

      assert.strictEqual(res.status, 0, `命令执行失败，stderr: ${res.stderr}`);
      assert.ok(
        !res.stderr.includes("ExperimentalWarning"),
        `stderr 中不应包含 ExperimentalWarning，实际输出: ${res.stderr}`
      );
      assert.ok(
        !res.stderr.includes("SQLite is an experimental feature"),
        `stderr 中不应包含 SQLite 实验性告警，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stdout.includes("list-prs"),
        `stdout 应包含动作列表，实际输出: ${res.stdout}`
      );
    });

    it("执行 ad describe list-prs 时标准错误流不包含 ExperimentalWarning 且命令成功退出", () => {
      const res = runCliBinary(["describe", "list-prs"]);

      assert.strictEqual(res.status, 0, `命令执行失败，stderr: ${res.stderr}`);
      assert.ok(
        !res.stderr.includes("ExperimentalWarning"),
        `stderr 中不应包含 ExperimentalWarning，实际输出: ${res.stderr}`
      );
      assert.ok(
        !res.stderr.includes("SQLite is an experimental feature"),
        `stderr 中不应包含 SQLite 实验性告警，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stdout.includes("list-prs"),
        `stdout 应包含动作详情，实际输出: ${res.stdout}`
      );
    });

    it("执行涉及 SQLite 状态写入的 ad run review-pr 时标准错误流同样不输出实验性告警", () => {
      const res = runCliBinary([
        "run",
        "review-pr",
        "--input",
        JSON.stringify({ repo: "actiondock/test-repo", pullNumber: 101 }),
      ]);

      assert.strictEqual(res.status, 0, `命令执行失败，stderr: ${res.stderr}`);
      assert.ok(
        !res.stderr.includes("ExperimentalWarning"),
        `stderr 中不应包含 ExperimentalWarning，实际输出: ${res.stderr}`
      );
      assert.ok(
        !res.stderr.includes("SQLite is an experimental feature"),
        `stderr 中不应包含 SQLite 实验性告警，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stdout.includes("APPROVE"),
        `stdout 应包含审阅裁决，实际输出: ${res.stdout}`
      );
    });
  });

  describe("逃生通道断言 (ACTIONDOCK_SILENCE_WARNINGS=0)", () => {
    it("显式注入 ACTIONDOCK_SILENCE_WARNINGS=0 时 ad info 标准错误流能够正常捕获 SQLite 实验性告警", () => {
      const res = runCliBinary(["info"], {
        env: { ACTIONDOCK_SILENCE_WARNINGS: "0" },
      });

      assert.strictEqual(res.status, 0, `逃生通道下命令仍应成功执行，stderr: ${res.stderr}`);
      assert.ok(
        res.stderr.includes("ExperimentalWarning"),
        `逃生通道开启时 stderr 应包含 ExperimentalWarning，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stderr.includes("SQLite is an experimental feature"),
        `逃生通道开启时 stderr 应包含 SQLite 实验性告警详情，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stdout.includes("team4u.github-tools"),
        `逃生通道开启时 stdout 业务输出应保持正常，实际输出: ${res.stdout}`
      );
    });

    it("显式注入 ACTIONDOCK_SILENCE_WARNINGS=0 时 ad run list-prs 标准错误流能够正常捕获 SQLite 实验性告警", () => {
      const res = runCliBinary(
        [
          "run",
          "list-prs",
          "--input",
          JSON.stringify({ repo: "actiondock" }),
        ],
        {
          env: { ACTIONDOCK_SILENCE_WARNINGS: "0" },
        }
      );

      assert.strictEqual(res.status, 0, `逃生通道下命令仍应成功执行，stderr: ${res.stderr}`);
      assert.ok(
        res.stderr.includes("ExperimentalWarning"),
        `逃生通道开启时 stderr 应包含 ExperimentalWarning，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stderr.includes("SQLite is an experimental feature"),
        `逃生通道开启时 stderr 应包含 SQLite 实验性告警详情，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stdout.includes("feat(core): support bun native compilation"),
        `逃生通道开启时 stdout 业务输出应保持正常，实际输出: ${res.stdout}`
      );
    });
  });

  describe("派生子进程执行链路下的告警抑制断言", () => {
    it("通过外部派生子进程执行 ad info 时标准错误流不输出实验性告警", () => {
      const res = runDerivedCli(["info"]);

      assert.strictEqual(res.status, 0, `派生进程执行失败，stderr: ${res.stderr}`);
      assert.ok(
        !res.stderr.includes("ExperimentalWarning"),
        `派生进程 stderr 不应包含 ExperimentalWarning，实际输出: ${res.stderr}`
      );
      assert.ok(
        !res.stderr.includes("SQLite is an experimental feature"),
        `派生进程 stderr 不应包含 SQLite 实验性告警，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stdout.includes("team4u.github-tools"),
        `派生进程 stdout 应正确透传输出，实际输出: ${res.stdout}`
      );
    });

    it("通过外部派生子进程执行 ad run list-prs 时标准错误流不输出实验性告警", () => {
      const res = runDerivedCli([
        "run",
        "list-prs",
        "--input",
        JSON.stringify({ repo: "actiondock" }),
      ]);

      assert.strictEqual(res.status, 0, `派生进程执行失败，stderr: ${res.stderr}`);
      assert.ok(
        !res.stderr.includes("ExperimentalWarning"),
        `派生进程 stderr 不应包含 ExperimentalWarning，实际输出: ${res.stderr}`
      );
      assert.ok(
        !res.stderr.includes("SQLite is an experimental feature"),
        `派生进程 stderr 不应包含 SQLite 实验性告警，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stdout.includes("feat(core): support bun native compilation"),
        `派生进程 stdout 应正确透传输出，实际输出: ${res.stdout}`
      );
    });

    it("外部派生子进程显式注入 ACTIONDOCK_SILENCE_WARNINGS=0 时逃生通道穿透子进程边界正常生效", () => {
      const res = runDerivedCli(["info"], {
        env: { ACTIONDOCK_SILENCE_WARNINGS: "0" },
      });

      assert.strictEqual(res.status, 0, `派生进程逃生通道执行失败，stderr: ${res.stderr}`);
      assert.ok(
        res.stderr.includes("ExperimentalWarning"),
        `派生进程在逃生通道开启时 stderr 应包含 ExperimentalWarning，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stderr.includes("SQLite is an experimental feature"),
        `派生进程在逃生通道开启时 stderr 应包含 SQLite 实验性告警，实际输出: ${res.stderr}`
      );
    });

    it("通过 tsx 加载器派生执行 ad info 时标准错误流不输出实验性告警", () => {
      const cleanEnv = { ...process.env };
      delete cleanEnv.ACTIONDOCK_SILENCE_WARNINGS;
      delete cleanEnv.NODE_OPTIONS;

      const res = spawnSync(
        process.execPath,
        ["--import", "tsx", cliPath, "info"],
        {
          cwd: githubToolsDir,
          env: cleanEnv,
          encoding: "utf-8",
        }
      );

      assert.strictEqual(res.status, 0, `tsx 派生执行失败，stderr: ${res.stderr}`);
      assert.ok(
        !res.stderr.includes("ExperimentalWarning"),
        `tsx 派生执行 stderr 不应包含 ExperimentalWarning，实际输出: ${res.stderr}`
      );
      assert.ok(
        !res.stderr.includes("SQLite is an experimental feature"),
        `tsx 派生执行 stderr 不应包含 SQLite 实验性告警，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stdout.includes("team4u.github-tools"),
        `tsx 派生执行 stdout 应包含工程信息，实际输出: ${res.stdout}`
      );
    });

    it("通过 tsx 加载器派生执行 ad info 且注入 ACTIONDOCK_SILENCE_WARNINGS=0 时正常输出实验性告警", () => {
      const cleanEnv = { ...process.env };
      delete cleanEnv.NODE_OPTIONS;

      const res = spawnSync(
        process.execPath,
        ["--import", "tsx", cliPath, "info"],
        {
          cwd: githubToolsDir,
          env: {
            ...cleanEnv,
            ACTIONDOCK_SILENCE_WARNINGS: "0",
          },
          encoding: "utf-8",
        }
      );

      assert.strictEqual(res.status, 0, `tsx 派生执行失败，stderr: ${res.stderr}`);
      assert.ok(
        res.stderr.includes("ExperimentalWarning"),
        `tsx 逃生通道开启时 stderr 应包含 ExperimentalWarning，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stderr.includes("SQLite is an experimental feature"),
        `tsx 逃生通道开启时 stderr 应包含 SQLite 实验性告警，实际输出: ${res.stderr}`
      );
    });

    it("派生子进程直接引入 @actiondock/core 模块并在运行时操作 SQLite 数据库，默认环境下告警完全抑制", () => {
      const childScript = `
await import("@actiondock/core");
const { DatabaseSync } = await import("node:sqlite");
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE test (id INT);");
console.log("SQLITE_OK");
`;

      const cleanEnv = { ...process.env };
      delete cleanEnv.ACTIONDOCK_SILENCE_WARNINGS;
      delete cleanEnv.NODE_OPTIONS;

      const res = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", childScript],
        {
          cwd: githubToolsDir,
          env: cleanEnv,
          encoding: "utf-8",
        }
      );

      assert.strictEqual(res.status, 0, `子进程执行失败，stderr: ${res.stderr}`);
      assert.ok(
        !res.stderr.includes("ExperimentalWarning"),
        `子进程 stderr 不应包含 ExperimentalWarning，实际输出: ${res.stderr}`
      );
      assert.ok(
        !res.stderr.includes("SQLite is an experimental feature"),
        `子进程 stderr 不应包含 SQLite 实验性告警，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stdout.includes("SQLITE_OK"),
        `子进程 stdout 应正常输出，实际输出: ${res.stdout}`
      );
    });

    it("派生子进程直接引入 @actiondock/core 且注入 ACTIONDOCK_SILENCE_WARNINGS=0 时正常输出实验性告警", () => {
      const childScript = `
await import("@actiondock/core");
const { DatabaseSync } = await import("node:sqlite");
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE test (id INT);");
console.log("SQLITE_OK");
`;

      const cleanEnv = { ...process.env };
      delete cleanEnv.NODE_OPTIONS;

      const res = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", childScript],
        {
          cwd: githubToolsDir,
          env: {
            ...cleanEnv,
            ACTIONDOCK_SILENCE_WARNINGS: "0",
          },
          encoding: "utf-8",
        }
      );

      assert.strictEqual(res.status, 0, `子进程执行失败，stderr: ${res.stderr}`);
      assert.ok(
        res.stderr.includes("ExperimentalWarning"),
        `子进程在逃生通道开启时 stderr 应包含 ExperimentalWarning，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stderr.includes("SQLite is an experimental feature"),
        `子进程在逃生通道开启时 stderr 应包含 SQLite 实验性告警，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stdout.includes("SQLITE_OK"),
        `子进程 stdout 应正常输出，实际输出: ${res.stdout}`
      );
    });
  });

  describe("告警精准度与非实验性告警保留断言", () => {
    it("子进程加载警告拦截逻辑后非 ExperimentalWarning 告警（如废弃警告与自定义警告）应正常透传保留", () => {
      const testWarningScript = `
import "@actiondock/core";
process.emitWarning("This is a test deprecation warning", "DeprecationWarning");
process.emitWarning("This is a custom warning message", "CustomWarning");
process.emitWarning("This experimental warning must be silenced", "ExperimentalWarning");
console.log("WARNING_TEST_DONE");
`;

      const cleanEnv = { ...process.env };
      delete cleanEnv.ACTIONDOCK_SILENCE_WARNINGS;
      delete cleanEnv.NODE_OPTIONS;

      const res = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", testWarningScript],
        {
          cwd: githubToolsDir,
          env: cleanEnv,
          encoding: "utf-8",
        }
      );

      assert.strictEqual(res.status, 0, `子进程执行失败，stderr: ${res.stderr}`);
      assert.ok(
        res.stderr.includes("DeprecationWarning"),
        `非实验性废弃告警应保留输出，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stderr.includes("CustomWarning"),
        `非实验性自定义告警应保留输出，实际输出: ${res.stderr}`
      );
      assert.ok(
        !res.stderr.includes("This experimental warning must be silenced"),
        `实验性告警必须被拦截，实际输出: ${res.stderr}`
      );
      assert.ok(
        res.stdout.includes("WARNING_TEST_DONE"),
        `子进程 stdout 应正常输出，实际输出: ${res.stdout}`
      );
    });
  });
});
