import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeProcessDriver } from "@actiondock/testing";
import {
  ActionDockError,
  ACTION_CANCELLED,
  DEPENDENCIES_NOT_READY,
  DEPENDENCY_INSTALL_FAILED,
} from "../src/errors.ts";
import { createPackageIdentity as createIdentity } from "../src/invocation/types.ts";

function createPackageIdentity(id: string, instanceId: string, generation: string) {
  return createIdentity({ id, instanceId, generation });
}
import { createLocalPackagePreparer } from "../src/project/preparation.ts";
import { acquireProjectLock } from "../src/project/transactions.ts";

describe("本地包准备协调器测试 (local-package-preparation)", () => {
  let tempDir: string;
  const originalEnvAutoInstall = process.env.ACTIONDOCK_AUTO_INSTALL;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-local-prep-test-"));
    delete process.env.ACTIONDOCK_AUTO_INSTALL;
  });

  afterEach(() => {
    if (originalEnvAutoInstall !== undefined) {
      process.env.ACTIONDOCK_AUTO_INSTALL = originalEnvAutoInstall;
    } else {
      delete process.env.ACTIONDOCK_AUTO_INSTALL;
    }
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("已就绪包成功准备后进入 Ready 缓存，后续调用直接命中缓存", async () => {
    const pkgDir = join(tempDir, "pkg-ready");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "pkg-ready",
        version: "1.0.0",
      })
    );

    let spawnCount = 0;
    const fakeDriver = new FakeProcessDriver();
    fakeDriver.onSpawn = () => {
      spawnCount++;
    };

    const preparer = createLocalPackagePreparer({ processDriver: fakeDriver });
    const identity = createPackageIdentity("pkg-ready", "inst-1", "gen-1");
    const target = { identity, packageRoot: pkgDir };
    const context = { signal: new AbortController().signal, rootRunId: "run-root-1" };

    await preparer(target, context);
    await preparer(target, context);

    assert.strictEqual(spawnCount, 0, "无需安装的就绪包不应触发任何子进程");
  });

  it("同一包在同一 rootRunId 下并发调用合并为单次在途安装", async () => {
    const pkgDir = join(tempDir, "pkg-concurrent");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "pkg-concurrent",
        version: "1.0.0",
        dependencies: { "mock-dep": "1.0.0" },
      })
    );

    let spawnCount = 0;
    const fakeDriver = new FakeProcessDriver();
    fakeDriver.onSpawn = (_handle, _spec, observer) => {
      spawnCount++;
      // 模拟安装物化
      mkdirSync(join(pkgDir, "node_modules", "mock-dep"), { recursive: true });
      writeFileSync(
        join(pkgDir, "node_modules", "mock-dep", "package.json"),
        JSON.stringify({ name: "mock-dep", version: "1.0.0" })
      );
      observer.output("stdout", new TextEncoder().encode("installed\n"));
      observer.exited({ code: 0, signal: null });
      observer.outputClosed("natural");
    };

    const preparer = createLocalPackagePreparer({ processDriver: fakeDriver });
    const identity = createPackageIdentity("pkg-concurrent", "inst-c", "gen-1");
    const target = { identity, packageRoot: pkgDir };
    const context1 = { signal: new AbortController().signal, rootRunId: "run-root-concurrent" };
    const context2 = { signal: new AbortController().signal, rootRunId: "run-root-concurrent" };

    await Promise.all([preparer(target, context1), preparer(target, context2)]);

    assert.strictEqual(spawnCount, 1, "同一包并发调用应合并在途任务，仅触发一次安装");
  });

  it("同一 workspace 下不同子包 B 与 C 并发合并在途根安装，且 C 仍独立执行依赖验证", async () => {
    // 构造 workspace 根与子包 B、C
    const rootPkgJson = {
      name: "ws-root",
      version: "1.0.0",
      workspaces: ["packages/*"],
    };
    writeFileSync(join(tempDir, "package.json"), JSON.stringify(rootPkgJson, null, 2));

    const pkgBDir = join(tempDir, "packages", "pkg-b");
    const pkgCDir = join(tempDir, "packages", "pkg-c");
    mkdirSync(pkgBDir, { recursive: true });
    mkdirSync(pkgCDir, { recursive: true });

    writeFileSync(
      join(pkgBDir, "package.json"),
      JSON.stringify({
        name: "pkg-b",
        version: "1.0.0",
        dependencies: { "dep-b": "1.0.0" },
      })
    );
    writeFileSync(
      join(pkgCDir, "package.json"),
      JSON.stringify({
        name: "pkg-c",
        version: "1.0.0",
        dependencies: { "dep-c": "1.0.0" },
      })
    );

    let spawnCount = 0;
    const fakeDriver = new FakeProcessDriver();
    fakeDriver.onSpawn = (_handle, _spec, observer) => {
      spawnCount++;
      // 安装时物化 dep-b 与 dep-c 到 workspace 根目录的 node_modules
      mkdirSync(join(tempDir, "node_modules", "dep-b"), { recursive: true });
      writeFileSync(
        join(tempDir, "node_modules", "dep-b", "package.json"),
        JSON.stringify({ name: "dep-b", version: "1.0.0" })
      );
      mkdirSync(join(tempDir, "node_modules", "dep-c"), { recursive: true });
      writeFileSync(
        join(tempDir, "node_modules", "dep-c", "package.json"),
        JSON.stringify({ name: "dep-c", version: "1.0.0" })
      );
      observer.output("stdout", new TextEncoder().encode("ws installed\n"));
      observer.exited({ code: 0, signal: null });
      observer.outputClosed("natural");
    };

    const preparer = createLocalPackagePreparer({ processDriver: fakeDriver });
    const targetB = {
      identity: createPackageIdentity("pkg-b", "inst-b", "gen-1"),
      packageRoot: pkgBDir,
    };
    const targetC = {
      identity: createPackageIdentity("pkg-c", "inst-c", "gen-1"),
      packageRoot: pkgCDir,
    };
    const rootRunId = "run-root-workspace";

    await Promise.all([
      preparer(targetB, { signal: new AbortController().signal, rootRunId }),
      preparer(targetC, { signal: new AbortController().signal, rootRunId }),
    ]);

    assert.strictEqual(spawnCount, 1, "同一工作区并发只触发一次根目录安装");
  });

  it("子包 B 为已就绪 no-op 时，并发等待的同工作区 C 能继续执行自身首装", async () => {
    const rootPkgJson = {
      name: "ws-root-noop",
      version: "1.0.0",
      workspaces: ["packages/*"],
    };
    writeFileSync(join(tempDir, "package.json"), JSON.stringify(rootPkgJson, null, 2));

    const pkgBDir = join(tempDir, "packages", "pkg-b");
    const pkgCDir = join(tempDir, "packages", "pkg-c");
    mkdirSync(pkgBDir, { recursive: true });
    mkdirSync(pkgCDir, { recursive: true });

    // B 无任何依赖（首检即就绪 no-op）
    writeFileSync(
      join(pkgBDir, "package.json"),
      JSON.stringify({ name: "pkg-b", version: "1.0.0" })
    );
    // C 缺失依赖
    writeFileSync(
      join(pkgCDir, "package.json"),
      JSON.stringify({
        name: "pkg-c",
        version: "1.0.0",
        dependencies: { "dep-c-needed": "1.0.0" },
      })
    );

    let spawnCount = 0;
    const fakeDriver = new FakeProcessDriver();
    fakeDriver.onSpawn = (_handle, _spec, observer) => {
      spawnCount++;
      mkdirSync(join(tempDir, "node_modules", "dep-c-needed"), { recursive: true });
      writeFileSync(
        join(tempDir, "node_modules", "dep-c-needed", "package.json"),
        JSON.stringify({ name: "dep-c-needed", version: "1.0.0" })
      );
      observer.output("stdout", new TextEncoder().encode("installed for c\n"));
      observer.exited({ code: 0, signal: null });
      observer.outputClosed("natural");
    };

    const preparer = createLocalPackagePreparer({ processDriver: fakeDriver });
    const targetB = {
      identity: createPackageIdentity("pkg-b", "inst-b", "gen-1"),
      packageRoot: pkgBDir,
    };
    const targetC = {
      identity: createPackageIdentity("pkg-c", "inst-c", "gen-1"),
      packageRoot: pkgCDir,
    };
    const rootRunId = "run-root-noop-test";

    // B 与 C 并发
    await Promise.all([
      preparer(targetB, { signal: new AbortController().signal, rootRunId }),
      preparer(targetC, { signal: new AbortController().signal, rootRunId }),
    ]);

    assert.strictEqual(spawnCount, 1, "C 必须执行自身所需首装，不可因 B no-op 误判就绪或报错");
  });

  it("B 失败，C 同 root 等待时只有一次 installer 调用且两者均告失败", async () => {
    const rootPkgJson = {
      name: "ws-root-fail-propagate",
      version: "1.0.0",
      workspaces: ["packages/*"],
    };
    writeFileSync(join(tempDir, "package.json"), JSON.stringify(rootPkgJson, null, 2));

    const pkgBDir = join(tempDir, "packages", "pkg-b");
    const pkgCDir = join(tempDir, "packages", "pkg-c");
    mkdirSync(pkgBDir, { recursive: true });
    mkdirSync(pkgCDir, { recursive: true });

    writeFileSync(
      join(pkgBDir, "package.json"),
      JSON.stringify({
        name: "pkg-b",
        version: "1.0.0",
        dependencies: { "shared-dep-fail": "1.0.0" },
      })
    );
    writeFileSync(
      join(pkgCDir, "package.json"),
      JSON.stringify({
        name: "pkg-c",
        version: "1.0.0",
        dependencies: { "shared-dep-fail": "1.0.0" },
      })
    );

    let spawnCount = 0;
    const fakeDriver = new FakeProcessDriver();
    fakeDriver.onSpawn = (_handle, _spec, observer) => {
      spawnCount++;
      observer.output("stderr", new TextEncoder().encode("npm ERR! installation failed\n"));
      observer.exited({ code: 1, signal: null });
      observer.outputClosed("natural");
    };

    const preparer = createLocalPackagePreparer({ processDriver: fakeDriver });
    const targetB = {
      identity: createPackageIdentity("pkg-b", "inst-b", "gen-1"),
      packageRoot: pkgBDir,
    };
    const targetC = {
      identity: createPackageIdentity("pkg-c", "inst-c", "gen-1"),
      packageRoot: pkgCDir,
    };
    const rootRunId = "run-root-fail-propagate";

    const results = await Promise.allSettled([
      preparer(targetB, { signal: new AbortController().signal, rootRunId }),
      preparer(targetC, { signal: new AbortController().signal, rootRunId }),
    ]);

    assert.strictEqual(results[0].status, "rejected", "B 必须失败");
    assert.strictEqual(results[1].status, "rejected", "同 root 等待的 C 必须随之失败，不得自动重试");
    assert.strictEqual(spawnCount, 1, "共享安装失败时只能调用一次 installer，不得替 C 重启安装");

    const errB = (results[0] as PromiseRejectedResult).reason;
    const errC = (results[1] as PromiseRejectedResult).reason;
    assert.strictEqual(errB.code, DEPENDENCY_INSTALL_FAILED);
    assert.strictEqual(errC.code, DEPENDENCY_INSTALL_FAILED);
  });

  it("首次路径解析失败抛出 DEPENDENCIES_NOT_READY 且不静默 fallback", async () => {
    const preparer = createLocalPackagePreparer();
    const nonExistentPath = join(tempDir, "does-not-exist-at-all");
    const target = {
      identity: createPackageIdentity("pkg-missing", "inst-m", "gen-1"),
      packageRoot: nonExistentPath,
    };
    const context = { signal: new AbortController().signal, rootRunId: "run-root-err" };

    await assert.rejects(preparer(target, context), (err: any) => {
      assert.strictEqual(err.code, DEPENDENCIES_NOT_READY);
      assert.ok(err.message.includes("Cannot resolve project directory"));
      return true;
    });
  });

  it("并发等待者取消不影响其余等待者，其余等待者能顺利完成", async () => {
    const pkgDir = join(tempDir, "pkg-cancel-isolation");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "pkg-cancel-isolation",
        version: "1.0.0",
        dependencies: { "slow-dep": "1.0.0" },
      })
    );

    let finishSpawn!: () => void;
    const spawnStarted = new Promise<void>((r) => {
      finishSpawn = r;
    });

    const fakeDriver = new FakeProcessDriver();
    fakeDriver.onSpawn = (_handle, _spec, observer) => {
      finishSpawn();
      setTimeout(() => {
        mkdirSync(join(pkgDir, "node_modules", "slow-dep"), { recursive: true });
        writeFileSync(
          join(pkgDir, "node_modules", "slow-dep", "package.json"),
          JSON.stringify({ name: "slow-dep", version: "1.0.0" })
        );
        observer.output("stdout", new TextEncoder().encode("slow installed\n"));
        observer.exited({ code: 0, signal: null });
        observer.outputClosed("natural");
      }, 50);
    };

    const preparer = createLocalPackagePreparer({ processDriver: fakeDriver });
    const target = {
      identity: createPackageIdentity("pkg-cancel-isolation", "inst-ci", "gen-1"),
      packageRoot: pkgDir,
    };
    const rootRunId = "run-root-cancel-iso";

    const controller1 = new AbortController();
    const controller2 = new AbortController();

    const p1 = preparer(target, { signal: controller1.signal, rootRunId });
    const p2 = preparer(target, { signal: controller2.signal, rootRunId });

    await spawnStarted;
    // 取消等待者 1
    controller1.abort("cancel waiter 1");

    // p1 应当被拒绝取消
    await assert.rejects(p1, (err: any) => {
      return err.name === "AbortError" || err.code === ACTION_CANCELLED;
    });

    // p2 仍应成功完成
    await p2;
  });

  it("最后等待者取消时中止安装，并等待底层清理完成后释放工程锁", async () => {
    const pkgDir = join(tempDir, "pkg-last-cancel");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "pkg-last-cancel",
        version: "1.0.0",
        dependencies: { "cancel-dep": "1.0.0" },
      })
    );

    let finishTerminate!: () => void;
    let terminateStartedResolve!: () => void;
    const terminateStarted = new Promise<void>((r) => {
      terminateStartedResolve = r;
    });

    const fakeDriver = new FakeProcessDriver();
    const originalTerminate = fakeDriver.terminate.bind(fakeDriver);
    let spawnStartedResolve!: () => void;
    const spawnStarted = new Promise<void>((resolve) => { spawnStartedResolve = resolve; });
    fakeDriver.onSpawn = () => {
      spawnStartedResolve();
    };
    fakeDriver.terminate = async (handle, graceMs) => {
      terminateStartedResolve();
      await new Promise<void>((resolve) => {
        finishTerminate = resolve;
      });
      await originalTerminate(handle, graceMs);
    };

    const preparer = createLocalPackagePreparer({ processDriver: fakeDriver });
    const target = {
      identity: createPackageIdentity("pkg-last-cancel", "inst-last", "gen-1"),
      packageRoot: pkgDir,
    };
    const controller = new AbortController();

    const prepPromise = preparer(target, { signal: controller.signal, rootRunId: "run-root-last-cancel" });

    // 安装进程确已启动后再触发取消，验证清理而非启动前拒绝。
    await spawnStarted;
    controller.abort("stop install");

    await terminateStarted;
    // 此时底层仍在清理中，prepPromise 必须仍在等待，不可过早返回
    let finishedEarly = false;
    prepPromise.then(() => { finishedEarly = true; }, () => { finishedEarly = true; });
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(finishedEarly, false, "未等待底层清理完毕前不可提前返回");

    // 放行 terminate 清理
    finishTerminate();

    await assert.rejects(prepPromise, (err: any) => {
      return err.name === "AbortError" || err.code === ACTION_CANCELLED;
    });

    // 验证底层清理完成后工程排他锁已正常释放
    const releaseLock = acquireProjectLock(pkgDir);
    releaseLock();
  });

  it("安装失败不永久缓存，后续调用可重新尝试", async () => {
    const pkgDir = join(tempDir, "pkg-fail-retry");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "pkg-fail-retry",
        version: "1.0.0",
        dependencies: { "fail-dep": "1.0.0" },
      })
    );

    let attempt = 0;
    const fakeDriver = new FakeProcessDriver();
    fakeDriver.onSpawn = (_handle, _spec, observer) => {
      attempt++;
      if (attempt === 1) {
        observer.output("stderr", new TextEncoder().encode("npm ERR! mock error\n"));
        observer.exited({ code: 1, signal: null });
        observer.outputClosed("natural");
      } else {
        mkdirSync(join(pkgDir, "node_modules", "fail-dep"), { recursive: true });
        writeFileSync(
          join(pkgDir, "node_modules", "fail-dep", "package.json"),
          JSON.stringify({ name: "fail-dep", version: "1.0.0" })
        );
        observer.output("stdout", new TextEncoder().encode("retry success\n"));
        observer.exited({ code: 0, signal: null });
        observer.outputClosed("natural");
      }
    };

    const preparer = createLocalPackagePreparer({ processDriver: fakeDriver });
    const target = {
      identity: createPackageIdentity("pkg-fail-retry", "inst-fail", "gen-1"),
      packageRoot: pkgDir,
    };
    const context = { signal: new AbortController().signal, rootRunId: "run-root-fail" };

    // 第一次调用应当失败
    await assert.rejects(preparer(target, context), (err: any) => {
      assert.strictEqual(err.code, DEPENDENCY_INSTALL_FAILED);
      return true;
    });

    // 第二次调用应当重试并成功（失败未被永久缓存）
    await preparer(target, context);
    assert.strictEqual(attempt, 2);
  });

  it("传入 install: false 时缺失依赖直接抛出 DEPENDENCIES_NOT_READY 并提供 hint", async () => {
    const pkgDir = join(tempDir, "pkg-no-install");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "pkg-no-install",
        version: "1.0.0",
        dependencies: { "missing-dep": "1.0.0" },
      })
    );

    const fakeDriver = new FakeProcessDriver();
    const preparer = createLocalPackagePreparer({
      install: false,
      processDriver: fakeDriver,
    });

    const target = {
      identity: createPackageIdentity("pkg-no-install", "inst-no", "gen-1"),
      packageRoot: pkgDir,
    };
    const context = { signal: new AbortController().signal, rootRunId: "run-root-no-install" };

    await assert.rejects(preparer(target, context), (err: any) => {
      assert.strictEqual(err.code, DEPENDENCIES_NOT_READY);
      assert.ok(err.message.includes("missing-dep"));
      assert.ok(err.details?.hint || err.hint);
      return true;
    });
  });

  it("node_modules中符号链接指向外部源码时，preparer安全跳过且不触发安装与禁装误报", async () => {
    const consumerDir = join(tempDir, "consumer");
    const sourceDir = join(tempDir, "linked-source");
    mkdirSync(join(consumerDir, "node_modules"), { recursive: true });
    mkdirSync(sourceDir, { recursive: true });

    writeFileSync(
      join(sourceDir, "package.json"),
      JSON.stringify({
        name: "linked-source",
        version: "1.0.0",
        dependencies: { "missing-child-dep": "1.0.0" },
      })
    );

    const linkPath = join(consumerDir, "node_modules", "linked-source");
    symlinkSync(sourceDir, linkPath, process.platform === "win32" ? "junction" : "dir");

    let spawnCount = 0;
    const fakeDriver = new FakeProcessDriver();
    fakeDriver.onSpawn = () => {
      spawnCount++;
    };

    // 同时测试 install: false 模式，确保跳过不会误报依赖未物化
    const preparer = createLocalPackagePreparer({
      install: false,
      processDriver: fakeDriver,
    });
    const target = {
      identity: createPackageIdentity("linked-source", "inst-link", "gen-1"),
      packageRoot: linkPath,
    };
    const context = { signal: new AbortController().signal, rootRunId: "run-root-link" };

    await preparer(target, context);

    assert.strictEqual(spawnCount, 0, "preparer遇node_modules内链接包不得调用安装器");
  });

  it("外部符号链接指向node_modules内部包时，preparer安全跳过且不触发安装与禁装误报", async () => {
    const internalDir = join(tempDir, "app", "node_modules", "internal-pkg");
    mkdirSync(internalDir, { recursive: true });
    writeFileSync(
      join(internalDir, "package.json"),
      JSON.stringify({
        name: "internal-pkg",
        version: "1.0.0",
        dependencies: { "unmet-dep": "1.0.0" },
      })
    );

    const extLink = join(tempDir, "external-link-to-nm");
    symlinkSync(internalDir, extLink, process.platform === "win32" ? "junction" : "dir");

    let spawnCount = 0;
    const fakeDriver = new FakeProcessDriver();
    fakeDriver.onSpawn = () => {
      spawnCount++;
    };

    const preparer = createLocalPackagePreparer({
      install: false,
      processDriver: fakeDriver,
    });
    const target = {
      identity: createPackageIdentity("internal-pkg", "inst-ext", "gen-1"),
      packageRoot: extLink,
    };
    const context = { signal: new AbortController().signal, rootRunId: "run-root-ext" };

    await preparer(target, context);

    assert.strictEqual(spawnCount, 0, "preparer遇指向node_modules的符号链接不得调用安装器");
  });

  it("普通独立源码首次准备时正确协调并完成首装", async () => {
    const standaloneDir = join(tempDir, "standalone-app");
    mkdirSync(standaloneDir, { recursive: true });
    writeFileSync(
      join(standaloneDir, "package.json"),
      JSON.stringify({
        name: "standalone-app",
        version: "1.0.0",
        dependencies: { "needed-dep": "1.0.0" },
      })
    );

    let spawnCount = 0;
    const fakeDriver = new FakeProcessDriver();
    fakeDriver.onSpawn = (_handle, _spec, observer) => {
      spawnCount++;
      const depDir = join(standaloneDir, "node_modules", "needed-dep");
      mkdirSync(depDir, { recursive: true });
      writeFileSync(
        join(depDir, "package.json"),
        JSON.stringify({ name: "needed-dep", version: "1.0.0" })
      );
      observer.output("stdout", new TextEncoder().encode("installed\n"));
      observer.exited({ code: 0, signal: null });
      observer.outputClosed("natural");
    };

    const preparer = createLocalPackagePreparer({ processDriver: fakeDriver });
    const target = {
      identity: createPackageIdentity("standalone-app", "inst-sa", "gen-1"),
      packageRoot: standaloneDir,
    };
    const context = { signal: new AbortController().signal, rootRunId: "run-root-sa" };

    await preparer(target, context);
    assert.strictEqual(spawnCount, 1, "普通独立源码首装时应触发一次安装");

    // 再次调用命中缓存
    await preparer(target, context);
    assert.strictEqual(spawnCount, 1, "命中准备缓存后不应再次触发安装");
  });
});
