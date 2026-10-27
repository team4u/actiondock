import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, it } from 'node:test';

/**
 * ad add / ad remove 取消链路回归测试。
 *
 * 验证统一进程底座（POSIX 独立进程组）下，Ctrl-C 取消会终止安装进程、
 * 释放工程锁并保留 pending 事务供下一次允许安装的 owner 命令恢复，
 * 不得伪装回滚一致或遗留孤儿安装进程。
 */
describe("CLI 依赖命令取消链路 (ad add / ad remove SIGINT)", () => {
  function createProject(command: "add" | "remove"): { root: string; bin: string; marker: string } {
    const root = mkdtempSync(join(tmpdir(), `ad-${command}-cancel-`));
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: `cancel-${command}`, version: "1.0.0" })
    );
    const manifest: Record<string, unknown> = {
      id: `cancel-${command}`,
      version: "1.0.0",
      actions: {},
    };
    if (command === "remove") {
      manifest.dependencies = { "cancel-dep": "cancel-dep" };
    }
    writeFileSync(join(root, "actiondock.json"), JSON.stringify(manifest));
    const marker = join(root, "installer.pid");
    // npm 替身：记录 PID 后挂起，模拟耗时安装，绝不访问网络
    writeFileSync(
      join(bin, "npm"),
      `#!${process.execPath}\n` +
        `import { writeFileSync } from "node:fs";\n` +
        `writeFileSync(${JSON.stringify(marker)}, String(process.pid));\n` +
        `setInterval(() => {}, 1000);\n`,
      { mode: 0o755 }
    );
    return { root, bin, marker };
  }

  async function runUntilInstallerStarts(child: ReturnType<typeof spawn>, marker: string, stderr: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!existsSync(marker) && Date.now() < deadline && child.exitCode === null) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(existsSync(marker), true, `安装进程未启动: ${stderr}`);
  }

  function isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  function readPendingTransactionStatus(root: string): string | undefined {
    const txDir = join(root, ".actiondock", "transactions");
    if (!existsSync(txDir)) return undefined;
    const entries = readdirSync(txDir);
    if (entries.length === 0) return undefined;
    const meta = JSON.parse(readFileSync(join(txDir, entries[0], "transaction.json"), "utf8"));
    return meta.status;
  }

  const cliEntry = resolve(import.meta.dirname, "../../dist/index.js");

  async function assertCancelSemantics(command: "add" | "remove"): Promise<void> {
    const { root, bin, marker } = createProject(command);
    let child: ReturnType<typeof spawn> | undefined;
    try {
      child = spawn(
        process.execPath,
        [cliEntry, command, "cancel-dep", "-P", root, "--json"],
        {
          cwd: root,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            ACTIONDOCK_HOME: join(root, "home"),
          },
        }
      );
      let stderr = "";
      child.stderr!.on("data", (chunk) => { stderr += chunk; });
      child.stdout!.resume();

      await runUntilInstallerStarts(child, marker, stderr);

      // 单次 SIGINT：CLI 归并为取消并以 130 退出，安装进程被终止
      process.kill(-child.pid, "SIGINT");
      const [exitCode] = await once(child, "exit");

      assert.equal(exitCode, 130, `期望退出码 130，实际 ${exitCode}；stderr: ${stderr}`);

      const installerPid = Number(readFileSync(marker, "utf8"));
      assert.equal(isProcessAlive(installerPid), false, "取消后安装进程必须被彻底终止");

      assert.equal(
        existsSync(join(root, ".actiondock", "project.lock")),
        false,
        "取消后必须释放工程排他锁"
      );

      const txStatus = readPendingTransactionStatus(root);
      assert.equal(txStatus, "pending", `取消后事务必须保留 pending 供恢复，实际 ${txStatus}`);
    } finally {
      if (child && child.exitCode === null) {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
      }
      try {
        if (existsSync(marker)) {
          process.kill(Number(readFileSync(marker, "utf8")), 0);
          process.kill(Number(readFileSync(marker, "utf8")), "SIGKILL");
        }
      } catch {}
      rmSync(root, { recursive: true, force: true });
    }
  }

  it("ad add 首次 SIGINT 以 130 退出，安装进程终止、工程锁释放且事务保留 pending", { skip: process.platform === "win32" }, async () => {
    await assertCancelSemantics("add");
  });

  it("ad remove 首次 SIGINT 以 130 退出，安装进程终止、工程锁释放且事务保留 pending", { skip: process.platform === "win32" }, async () => {
    await assertCancelSemantics("remove");
  });
});
