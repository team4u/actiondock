import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, describe, it } from 'node:test';

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
  const activeChildren = new Set<ReturnType<typeof spawn>>();

  afterEach(() => {
    for (const child of activeChildren) {
      if (child.pid && child.exitCode === null) {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
      }
    }
    activeChildren.clear();
  });

  function spawnCli(args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; detached?: boolean }): {
    child: ReturnType<typeof spawn>;
    done: Promise<{ code: number | null; out: string; err: string }>;
  } {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd: options.cwd,
      detached: options.detached ?? true,
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env,
    });
    activeChildren.add(child);
    child.once("exit", () => activeChildren.delete(child));
    let out = "";
    let err = "";
    child.stdout?.on("data", (c) => { out += c; });
    child.stderr?.on("data", (c) => { err += c; });
    return {
      child,
      done: once(child, "exit").then(([code]) => ({ code, out, err })),
    };
  }

  async function assertCancelSemantics(command: "add" | "remove"): Promise<void> {
    const { root, bin, marker } = createProject(command);
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const launched = spawnCli(
        [command, "cancel-dep", "-P", root, "--json"],
        {
          cwd: root,
          detached: true,
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            ACTIONDOCK_HOME: join(root, "home"),
          },
        }
      );
      child = launched.child;
      let stderr = "";
      child.stderr!.on("data", (chunk) => { stderr += chunk; });

      await runUntilInstallerStarts(child, marker, stderr);
      const childPid = child.pid;
      assert.notStrictEqual(childPid, undefined, "CLI 子进程必须具有 PID");

      // 单次 SIGINT：CLI 归并为取消并以 130 退出，安装进程被终止
      process.kill(-childPid!, "SIGINT");
      const { code: exitCode } = await launched.done;

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
      if (child && child.exitCode === null && child.pid !== undefined) {
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

  it("取消 ad add dep-a 后再次执行 ad add dep-b，随后的 ad run 不会丢弃已提交的 dep-b 与锁定文件", { skip: process.platform === "win32" }, async () => {
    const root = mkdtempSync(join(tmpdir(), "ad-cancel-add-run-"));
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    mkdirSync(join(root, "actions"), { recursive: true });

    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "cancel-add-run-root", version: "1.0.0", type: "module" })
    );
    writeFileSync(
      join(root, "actiondock.json"),
      JSON.stringify({
        id: "cancel-add-run-root",
        version: "1.0.0",
        actions: { greet: { entry: "actions/greet.js" } },
      })
    );
    writeFileSync(
      join(root, "actions/greet.js"),
      "export default { run() { return { ok: true }; } };\n"
    );

    const npmMock =
      `#!${process.execPath}\n` +
      `import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";\n` +
      `import { join } from "node:path";\n` +
      `const root = ${JSON.stringify(root)};\n` +
      `const args = process.argv.slice(2);\n` +
      `if (args[0] === "--version") {\n` +
      `  console.log("11.17.0");\n` +
      `} else if (args.includes("dep-a")) {\n` +
      `  writeFileSync(join(root, "dep-a-started"), "started");\n` +
      `  setInterval(() => {}, 1000);\n` +
      `} else if (args.includes("dep-b")) {\n` +
      `  mkdirSync(join(root, "node_modules/dep-b"), { recursive: true });\n` +
      `  writeFileSync(join(root, "node_modules/dep-b/package.json"), JSON.stringify({ name: "dep-b", version: "1.0.0" }));\n` +
      `  writeFileSync(join(root, "node_modules/dep-b/actiondock.json"), JSON.stringify({ id: "dep-b", version: "1.0.0", actions: {} }));\n` +
      `  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));\n` +
      `  pkg.dependencies = { ...(pkg.dependencies || {}), "dep-b": "1.0.0" };\n` +
      `  writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2));\n` +
      `} else {\n` +
      `  rmSync(join(root, "node_modules"), { recursive: true, force: true });\n` +
      `}\n`;
    writeFileSync(join(bin, "npm"), npmMock, { mode: 0o755 });

    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ACTIONDOCK_INSTALLER: "npm",
      ACTIONDOCK_HOME: join(root, "home"),
    };

    try {
      // 发起 ad add dep-a 并取消
      const first = spawnCli(["add", "dep-a", "-P", root, "--json"], { cwd: root, env });
      const deadline = Date.now() + 10_000;
      while (!existsSync(join(root, "dep-a-started")) && Date.now() < deadline && first.child.exitCode === null) {
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.equal(existsSync(join(root, "dep-a-started")), true, "dep-a 安装必须已启动");

      process.kill(-first.child.pid!, "SIGINT");
      const firstResult = await first.done;
      assert.equal(firstResult.code, 130, `期望取消退出码 130，实际 ${firstResult.code}`);
      assert.equal(readPendingTransactionStatus(root), "pending", "取消后事务必须处于 pending 状态");

      // 发起 ad add dep-b，应成功恢复 pending 事务并成功写入 dep-b
      const second = spawnCli(["add", "dep-b", "-P", root, "--json"], { cwd: root, env });
      const secondResult = await second.done;
      assert.equal(secondResult.code, 0, `ad add dep-b 必须成功: ${secondResult.err}`);

      const manifestAfterAdd = JSON.parse(readFileSync(join(root, "actiondock.json"), "utf8"));
      assert.ok(manifestAfterAdd.dependencies?.["dep-b"], "add 成功后 actiondock.json 必须包含 dep-b");
      assert.equal(existsSync(join(root, "actiondock.lock.json")), true, "add 成功后 actiondock.lock.json 必须存在");

      // 执行 ad run greet，验证恢复不再抹除 dep-b 与 lockfile
      const runCmd = spawnCli(["run", "greet", "--json"], { cwd: root, env });
      const runResult = await runCmd.done;
      assert.equal(runResult.code, 0, `ad run greet 必须成功: ${runResult.err}`);

      const manifestAfterRun = JSON.parse(readFileSync(join(root, "actiondock.json"), "utf8"));
      assert.ok(manifestAfterRun.dependencies?.["dep-b"], "run 之后 actiondock.json 必须保留 dep-b");

      const pkgAfterRun = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      assert.ok(pkgAfterRun.dependencies?.["dep-b"], "run 之后 package.json 必须保留 dep-b");

      assert.equal(existsSync(join(root, "actiondock.lock.json")), true, "run 之后 actiondock.lock.json 必须完好存在");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("存在 pending 事务时，ad remove 在读取清单前先行恢复 pending 事务", { skip: process.platform === "win32" }, async () => {
    const root = mkdtempSync(join(tmpdir(), "ad-cancel-remove-pending-"));
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });

    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "cancel-remove-pending-root", version: "1.0.0" })
    );
    writeFileSync(
      join(root, "actiondock.json"),
      JSON.stringify({
        id: "cancel-remove-pending-root",
        version: "1.0.0",
        dependencies: { "original-dep": "original-dep" },
      })
    );

    // npm 替身：仅打印版本和空退出
    writeFileSync(
      join(bin, "npm"),
      `#!${process.execPath}\nconsole.log("11.17.0");\n`,
      { mode: 0o755 }
    );

    // 构造模拟未提交的 pending 事务快照（原始状态含 original-dep，工作区被临时篡改）
    const txDir = join(root, ".actiondock", "transactions", "tx-simulated");
    const snapDir = join(txDir, "snapshot");
    mkdirSync(snapDir, { recursive: true });
    writeFileSync(
      join(snapDir, "actiondock.json"),
      JSON.stringify({
        id: "cancel-remove-pending-root",
        version: "1.0.0",
        dependencies: { "original-dep": "original-dep" },
      })
    );
    writeFileSync(
      join(snapDir, "package.json"),
      JSON.stringify({ name: "cancel-remove-pending-root", version: "1.0.0" })
    );
    writeFileSync(
      join(txDir, "transaction.json"),
      JSON.stringify({
        id: "tx-simulated",
        status: "pending",
        createdAt: Date.now(),
        files: [
          { name: "actiondock.json", existed: true },
          { name: "package.json", existed: true },
        ],
      })
    );

    // 模拟磁盘上的脏修改：添加了一个未提交的 phantom-dep
    writeFileSync(
      join(root, "actiondock.json"),
      JSON.stringify({
        id: "cancel-remove-pending-root",
        version: "1.0.0",
        dependencies: { "original-dep": "original-dep", "phantom-dep": "phantom-dep" },
      })
    );

    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ACTIONDOCK_INSTALLER: "npm",
      ACTIONDOCK_HOME: join(root, "home"),
    };

    try {
      // 执行 remove phantom-dep：因为 prepareProjectManifestRoot 先恢复了快照，
      // 恢复后 actiondock.json 中不再有 phantom-dep，因此 remove 会报错依赖未声明，并已清除 pending 状态
      const removePhantom = spawnCli(["remove", "phantom-dep", "-P", root, "--json"], { cwd: root, env });
      const result = await removePhantom.done;
      assert.notEqual(result.code, 0, "移除未在已恢复清单中声明的依赖必须报错退出");

      // 验证 pending 事务已被恢复清理
      assert.equal(readPendingTransactionStatus(root), undefined, "历史 pending 事务必须已被恢复清理");

      // 验证文件内容回滚至快照的干净状态
      const manifest = JSON.parse(readFileSync(join(root, "actiondock.json"), "utf8"));
      assert.equal(manifest.dependencies?.["phantom-dep"], undefined, "未提交的脏修改必须已被快照回滚撤销");
      assert.equal(manifest.dependencies?.["original-dep"], "original-dep", "原始声明依赖必须完整保留");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("存在 pending 事务且在恢复阶段被取消时，不继续修改文件并保留 pending 状态", { skip: process.platform === "win32" }, async () => {
    const root = mkdtempSync(join(tmpdir(), "ad-cancel-recovery-sigint-"));
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });

    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "cancel-recovery-sigint-root", version: "1.0.0" })
    );
    writeFileSync(
      join(root, "actiondock.json"),
      JSON.stringify({
        id: "cancel-recovery-sigint-root",
        version: "1.0.0",
      })
    );

    const marker = join(root, "recovery-installer.pid");
    // npm 替身：在 recovery 阶段（ci/install）挂起并记录 PID
    writeFileSync(
      join(bin, "npm"),
      `#!${process.execPath}\n` +
        `import { writeFileSync } from "node:fs";\n` +
        `const args = process.argv.slice(2);\n` +
        `if (args[0] === "--version") {\n` +
        `  console.log("11.17.0");\n` +
        `} else {\n` +
        `  writeFileSync(${JSON.stringify(marker)}, String(process.pid));\n` +
        `  setInterval(() => {}, 1000);\n` +
        `}\n`,
      { mode: 0o755 }
    );

    // 构造挂起的 pending 事务
    const txDir = join(root, ".actiondock", "transactions", "tx-recovery-cancel");
    const snapDir = join(txDir, "snapshot");
    mkdirSync(snapDir, { recursive: true });
    writeFileSync(
      join(snapDir, "actiondock.json"),
      JSON.stringify({ id: "cancel-recovery-sigint-root", version: "1.0.0" })
    );
    writeFileSync(
      join(snapDir, "package.json"),
      JSON.stringify({ name: "cancel-recovery-sigint-root", version: "1.0.0" })
    );
    writeFileSync(
      join(txDir, "transaction.json"),
      JSON.stringify({
        id: "tx-recovery-cancel",
        status: "pending",
        createdAt: Date.now(),
        files: [
          { name: "actiondock.json", existed: true },
          { name: "package.json", existed: true },
        ],
      })
    );

    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ACTIONDOCK_INSTALLER: "npm",
      ACTIONDOCK_HOME: join(root, "home"),
    };

    try {
      const launched = spawnCli(["add", "should-not-be-added", "-P", root, "--json"], { cwd: root, env });
      await runUntilInstallerStarts(launched.child, marker, "");

      // 向 CLI 发送 SIGINT 取消恢复
      process.kill(-launched.child.pid!, "SIGINT");
      const { code } = await launched.done;
      assert.equal(code, 130, `恢复阶段被取消必须以 130 退出，实际 ${code}`);

      // 验证事务依然保持 pending，没有被清除或破坏
      assert.equal(readPendingTransactionStatus(root), "pending", "恢复取消后事务依然必须保持 pending");

      // 验证新依赖绝对没有被写入
      const manifest = JSON.parse(readFileSync(join(root, "actiondock.json"), "utf8"));
      assert.equal(manifest.dependencies?.["should-not-be-added"], undefined, "取消后绝不得写入新依赖");
    } finally {
      try {
        if (existsSync(marker)) {
          process.kill(Number(readFileSync(marker, "utf8")), "SIGKILL");
        }
      } catch {}
      rmSync(root, { recursive: true, force: true });
    }
  });
});
