import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { beginTransaction } from "@actiondock/core/project";
import { linkPackage } from "@actiondock/core/registry";
import { runCliAsync } from "./helpers/run-cli";

describe("CLI ad run - 依赖自动准备与边界控制", () => {
  function createTestProject(options?: {
    id?: string;
    hasNodeModules?: boolean;
    dependencies?: Record<string, string>;
    actionCode?: string;
  }): string {
    const dir = mkdtempSync(join(tmpdir(), "ad-run-install-test-"));
    const id = options?.id || "demo-pkg";

    const manifest = {
      id,
      name: id,
      version: "1.0.0",
      actions: {
        greet: {
          entry: "actions/greet.ts",
          description: "Sample greet action",
        },
      },
    };
    writeFileSync(join(dir, "actiondock.json"), JSON.stringify(manifest, null, 2));

    const pkgJson: Record<string, any> = {
      name: id,
      version: "1.0.0",
      type: "module",
    };
    if (options?.dependencies) {
      pkgJson.dependencies = options.dependencies;
    }
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkgJson, null, 2));

    mkdirSync(join(dir, "actions"), { recursive: true });
    const actionSrc =
      options?.actionCode ||
      `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  run(input) {
    return { message: "hello " + (input?.name || "world") };
  }
});
`;
    writeFileSync(join(dir, "actions", "greet.ts"), actionSrc);

    if (options?.hasNodeModules) {
      mkdirSync(join(dir, "node_modules"), { recursive: true });
    }

    return dir;
  }

  it("当未安装生产依赖且指定 --no-install 时，拒绝自动安装并返回 DEPENDENCIES_NOT_READY 结构化错误", async () => {
    const dir = createTestProject({
      dependencies: {
        "non-existent-pkg-abc": "^1.0.0",
      },
    });

    try {
      // 机器模式验证结构化错误码与退出码
      const jsonRes = await runCliAsync(["run", "greet", "--no-install", "--json", "--", "name=Alice"], dir);
      assert.strictEqual(jsonRes.exitCode, 1);
      const parsed = JSON.parse(jsonRes.stdout.toString());
      assert.strictEqual(parsed.ok, false);
      assert.strictEqual(parsed.error.code, "DEPENDENCIES_NOT_READY");

      // 人类可读模式验证提示与目录副作用
      const res = await runCliAsync(["run", "greet", "--no-install", "--", "name=Alice"], dir);
      assert.strictEqual(res.exitCode, 1);
      const stderr = res.stderr.toString();
      assert.match(stderr, /Dependencies in .* are not ready/);
      assert.match(stderr, /Automatic installation is disabled/);
      // node_modules 目录不应被意外创建
      assert.strictEqual(existsSync(join(dir, "node_modules")), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("当环境变量 ACTIONDOCK_AUTO_INSTALL=false 时，即使未传 --no-install 也禁止自动安装", async () => {
    const dir = createTestProject({
      dependencies: {
        "non-existent-pkg-xyz": "^2.0.0",
      },
    });

    try {
      const res = await runCliAsync(
        ["run", "greet", "--json", "--", "name=Bob"],
        dir,
        { ACTIONDOCK_AUTO_INSTALL: "false" }
      );
      assert.strictEqual(res.exitCode, 1);
      const parsed = JSON.parse(res.stdout.toString());
      assert.strictEqual(parsed.ok, false);
      assert.strictEqual(parsed.error.code, "DEPENDENCIES_NOT_READY");
      assert.strictEqual(existsSync(join(dir, "node_modules")), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("当已有 node_modules 但必需生产依赖缺失时，严禁自动重建并返回结构化 DEPENDENCIES_NOT_READY", async () => {
    const dir = createTestProject({
      hasNodeModules: true,
      dependencies: {
        "broken-dep-pkg": "^1.0.0",
      },
    });

    try {
      const res = await runCliAsync(["run", "greet", "--json", "--", "name=Carol"], dir);
      assert.strictEqual(res.exitCode, 1);
      const parsed = JSON.parse(res.stdout.toString());
      assert.strictEqual(parsed.ok, false);
      assert.strictEqual(parsed.error.code, "DEPENDENCIES_NOT_READY");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("当工程存在未恢复的悬空事务且禁止安装时，直接报告 PROJECT_RECOVERY_REQUIRED，且不修改快照或文件", async () => {
    const dir = createTestProject({
      hasNodeModules: true, // 依赖已就绪，绕过未首装检查，触发事务恢复
    });

    try {
      // 开启一个事务并做破坏性修改后释放锁模拟崩溃残留（留下 pending 状态）
      const tx = await beginTransaction(dir, "simulated crash");
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "modified-crash", version: "9.9.9" }));
      tx.releaseLock();

      const txMetaDir = join(dir, ".actiondock", "transactions", tx.id);
      const metaBefore = readFileSync(join(txMetaDir, "transaction.json"), "utf-8");

      const res = await runCliAsync(["run", "greet", "--no-install", "--json"], dir);
      assert.strictEqual(res.exitCode, 1);
      const parsed = JSON.parse(res.stdout.toString());
      assert.strictEqual(parsed.ok, false);
      assert.strictEqual(parsed.error.code, "PROJECT_RECOVERY_REQUIRED");

      // 验证未发生文件回退或快照清除，所有状态保持原样
      const pkgAfter = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
      assert.strictEqual(pkgAfter.version, "9.9.9");
      const metaAfter = readFileSync(join(txMetaDir, "transaction.json"), "utf-8");
      assert.strictEqual(metaBefore, metaAfter);
      assert.strictEqual(JSON.parse(metaAfter).status, "pending");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("当目标动作为未知动作时，前置解析容错并由正式管线返回标准 ACTION_NOT_FOUND", async () => {
    const dir = createTestProject();

    try {
      const res = await runCliAsync(["run", "unknownAction", "--json"], dir);
      assert.strictEqual(res.exitCode, 1);
      const parsed = JSON.parse(res.stdout.toString());
      assert.strictEqual(parsed.ok, false);
      assert.strictEqual(parsed.error.code, "ACTION_NOT_FOUND");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("remote 目标且传 -P 仅远端存在的包时，不受本地损坏 CWD 或本地包寻址影响", async () => {
    const dir = createTestProject({
      dependencies: {
        "broken-local-dep": "1.0.0",
      },
    });

    try {
      // -P remote-only-pkg 本地绝对不存在，本地 CWD 依赖亦未就绪
      // 远端分支应当完全旁路本地包寻址与本地依赖准备，直接向远端发起连接并报告网络连接失败
      const res = await runCliAsync(
        ["run", "remoteAction", "-P", "remote-only-pkg", "--server", "http://127.0.0.1:59999", "--json"],
        dir
      );
      assert.strictEqual(res.exitCode, 1);
      const parsed = JSON.parse(res.stdout.toString());
      assert.strictEqual(parsed.ok, false);
      // 绝不能是本地 PACKAGE_NOT_FOUND（如 "Package 'remote-only-pkg' not found in linked packages"）
      // 也绝不能是本地 DEPENDENCIES_NOT_READY
      assert.notStrictEqual(parsed.error.code, "DEPENDENCIES_NOT_READY");
      assert.notStrictEqual(parsed.error.message, "Package 'remote-only-pkg' not found in linked packages or path");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("当本地已装依赖包与链接包存在同名动作歧义时，预解析不错误选中并准备无关链接包", async () => {
    const customHome = mkdtempSync(join(tmpdir(), "ad-ambiguity-home-"));
    const mainDir = createTestProject({
      id: "main-app",
      hasNodeModules: true,
    });
    // main-app 声明依赖 npm-dep
    const mainManifest = JSON.parse(readFileSync(join(mainDir, "actiondock.json"), "utf-8"));
    mainManifest.dependencies = { "npm-dep": "^1.0.0" };
    writeFileSync(join(mainDir, "actiondock.json"), JSON.stringify(mainManifest, null, 2));

    // 构造当前工程 node_modules 下已安装的 npm Action 包
    const npmDepDir = join(mainDir, "node_modules", "npm-dep");
    mkdirSync(join(npmDepDir, "actions"), { recursive: true });
    writeFileSync(
      join(npmDepDir, "actiondock.json"),
      JSON.stringify({
        id: "npm-dep",
        name: "npm-dep",
        version: "1.0.0",
        actions: { duplicateAction: { entry: "actions/dup.ts" } },
      })
    );
    writeFileSync(
      join(npmDepDir, "actions", "dup.ts"),
      `import { defineAction } from "@actiondock/sdk"; export default defineAction({ run() { return { from: "npm" }; } });`
    );

    // 构造另一个链接包，声明了缺失依赖且包含同名 duplicateAction
    const linkedDir = createTestProject({
      id: "linked-dep",
      dependencies: { "uninstalled-dep": "1.0.0" },
    });
    const dupManifest = JSON.parse(readFileSync(join(linkedDir, "actiondock.json"), "utf-8"));
    dupManifest.actions = { duplicateAction: { entry: "actions/greet.ts" } };
    writeFileSync(join(linkedDir, "actiondock.json"), JSON.stringify(dupManifest, null, 2));

    try {
      await linkPackage(linkedDir, customHome);

      // 调用裸动作名 duplicateAction，在已安装的 npm-dep 与 linked-dep 之间产生歧义
      // 若预阶段发生错误唯一命中并准备 linked-dep，在 --no-install 下会抛出 DEPENDENCIES_NOT_READY；
      // 正确行为：预解析识别完整元数据图，发现歧义跳过预准备，由正式管线报告 INVALID_ACTION_REF
      const res = await runCliAsync(
        ["run", "duplicateAction", "--no-install", "--json"],
        mainDir,
        { ACTIONDOCK_HOME: customHome }
      );
      assert.strictEqual(res.exitCode, 1);
      const parsed = JSON.parse(res.stdout.toString());
      assert.strictEqual(parsed.ok, false);
      assert.strictEqual(parsed.error.code, "INVALID_ACTION_REF");
      assert.match(parsed.error.message, /duplicateAction/);
      // linked-dep 不应被错误准备并创建 node_modules
      assert.strictEqual(existsSync(join(linkedDir, "node_modules")), false);
    } finally {
      rmSync(customHome, { recursive: true, force: true });
      rmSync(mainDir, { recursive: true, force: true });
      rmSync(linkedDir, { recursive: true, force: true });
    }
  });

  it("Action 开始执行后若抛出缺包错误，执行计数恰好为一次，严禁触发依赖安装并重跑", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ad-run-install-test-"));
    const counterFile = join(dir, "exec-counter.txt");
    writeFileSync(counterFile, "");

    const manifest = {
      id: "counter-pkg",
      name: "counter-pkg",
      version: "1.0.0",
      actions: {
        faulty: {
          entry: "actions/faulty.ts",
          description: "Action that fails dynamically on missing package",
        },
      },
    };
    writeFileSync(join(dir, "actiondock.json"), JSON.stringify(manifest, null, 2));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "counter-pkg", version: "1.0.0", type: "module" }, null, 2));
    mkdirSync(join(dir, "actions"), { recursive: true });

    // 动态 import 缺失包前向 counter 文件追加计数
    const actionSrc = `
import { appendFileSync } from "node:fs";
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  async run() {
    appendFileSync(${JSON.stringify(counterFile)}, "started\\n");
    await import("definitely-not-installed-pkg-8888");
    return { ok: true };
  }
});
`;
    writeFileSync(join(dir, "actions", "faulty.ts"), actionSrc);

    try {
      const res = await runCliAsync(["run", "faulty"], dir);
      assert.strictEqual(res.exitCode, 1);
      const stderr = res.stderr.toString();
      assert.match(stderr, /Cannot find package|MODULE_NOT_FOUND/);

      // 关键断言：业务执行计数必须恰好为 1，杜绝失败后自动重试重跑
      const counterContent = readFileSync(counterFile, "utf-8").trim();
      const invocations = counterContent.split("\n").filter(Boolean);
      assert.strictEqual(invocations.length, 1);
      assert.strictEqual(invocations[0], "started");

      // 绝未自动创建 node_modules 或重跑
      assert.strictEqual(existsSync(join(dir, "node_modules")), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
