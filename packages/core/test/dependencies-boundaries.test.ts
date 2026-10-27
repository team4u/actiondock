import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ActionDockError,
  ACTION_CANCELLED,
  DEPENDENCIES_NOT_READY,
  DEPENDENCY_INSTALL_FAILED,
} from "../src/errors.ts";
import {
  checkDependenciesMaterialized,
  ensureProjectDependencies,
  resolveInstallRoot,
} from "../src/project/dependencies.ts";
import { acquireProjectLock } from "../src/project/transactions.ts";
import { FakeProcessDriver } from "@actiondock/testing";

describe("依赖准备边界与安全约束体系", () => {
  let tempDir: string;
  const originalEnvInstaller = process.env.ACTIONDOCK_INSTALLER;
  const originalEnvAutoInstall = process.env.ACTIONDOCK_AUTO_INSTALL;
  const originalPath = process.env.PATH;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-dep-boundaries-test-"));
    delete process.env.ACTIONDOCK_INSTALLER;
    delete process.env.ACTIONDOCK_AUTO_INSTALL;
  });

  afterEach(() => {
    if (originalEnvInstaller !== undefined) {
      process.env.ACTIONDOCK_INSTALLER = originalEnvInstaller;
    } else {
      delete process.env.ACTIONDOCK_INSTALLER;
    }
    if (originalEnvAutoInstall !== undefined) {
      process.env.ACTIONDOCK_AUTO_INSTALL = originalEnvAutoInstall;
    } else {
      delete process.env.ACTIONDOCK_AUTO_INSTALL;
    }
    process.env.PATH = originalPath;

    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("workspace子包tool-*与嵌套glob正确解析安装根与排除规则", () => {
    const rootPkgJson = {
      name: "monorepo-root",
      version: "1.0.0",
      workspaces: [
        "packages/tool-*",
        "nested/**",
        "!packages/tool-excluded",
      ],
    };
    writeFileSync(join(tempDir, "package.json"), JSON.stringify(rootPkgJson, null, 2));

    const toolAlphaDir = join(tempDir, "packages", "tool-alpha");
    mkdirSync(toolAlphaDir, { recursive: true });
    writeFileSync(join(toolAlphaDir, "package.json"), JSON.stringify({ name: "tool-alpha" }));

    const deepPkgDir = join(tempDir, "nested", "level1", "level2", "deep-tool");
    mkdirSync(deepPkgDir, { recursive: true });
    writeFileSync(join(deepPkgDir, "package.json"), JSON.stringify({ name: "deep-tool" }));

    const excludedDir = join(tempDir, "packages", "tool-excluded");
    mkdirSync(excludedDir, { recursive: true });
    writeFileSync(join(excludedDir, "package.json"), JSON.stringify({ name: "tool-excluded" }));

    const otherAppDir = join(tempDir, "packages", "other-app");
    mkdirSync(otherAppDir, { recursive: true });
    writeFileSync(join(otherAppDir, "package.json"), JSON.stringify({ name: "other-app" }));

    const resAlpha = resolveInstallRoot(toolAlphaDir);
    assert.strictEqual(resAlpha.isWorkspace, true);
    assert.strictEqual(resAlpha.installRoot, tempDir);
    assert.strictEqual(resAlpha.skip, false);

    const resDeep = resolveInstallRoot(deepPkgDir);
    assert.strictEqual(resDeep.isWorkspace, true);
    assert.strictEqual(resDeep.installRoot, tempDir);
    assert.strictEqual(resDeep.skip, false);

    const resExcluded = resolveInstallRoot(excludedDir);
    assert.strictEqual(resExcluded.isWorkspace, false);
    assert.strictEqual(resExcluded.installRoot, excludedDir);

    const resOther = resolveInstallRoot(otherAppDir);
    assert.strictEqual(resOther.isWorkspace, false);
    assert.strictEqual(resOther.installRoot, otherAppDir);
  });

  it("目录符号链接与node_modules内部边界安全跳过", () => {
    const internalNmDir = join(tempDir, "node_modules", "internal-pkg");
    mkdirSync(internalNmDir, { recursive: true });
    writeFileSync(join(internalNmDir, "package.json"), JSON.stringify({ name: "internal-pkg" }));

    const resInternal = resolveInstallRoot(internalNmDir);
    assert.strictEqual(resInternal.skip, true);
    assert.strictEqual(resInternal.reason, "Inside node_modules");

    const symlinkTarget = join(tempDir, "external-link");
    try {
      symlinkSync(internalNmDir, symlinkTarget, "junction");
    } catch (error: any) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return;
      throw error;
    }
    const resSymlink = resolveInstallRoot(symlinkTarget);
    assert.strictEqual(resSymlink.skip, true);
    assert.strictEqual(resSymlink.reason, "Inside node_modules");
  });

  it("损坏或非法的package.json抛出明确的ActionDockError", () => {
    const brokenJsonDir = join(tempDir, "broken-json");
    mkdirSync(brokenJsonDir, { recursive: true });
    writeFileSync(join(brokenJsonDir, "package.json"), "{ invalid: json content ");

    assert.throws(
      () => checkDependenciesMaterialized(brokenJsonDir),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCIES_NOT_READY &&
        err.message.includes("package.json")
    );

    assert.throws(
      () => resolveInstallRoot(brokenJsonDir),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCIES_NOT_READY &&
        err.message.includes("package.json")
    );

    const invalidDepsDir = join(tempDir, "invalid-deps");
    mkdirSync(invalidDepsDir, { recursive: true });
    writeFileSync(
      join(invalidDepsDir, "package.json"),
      JSON.stringify({ name: "invalid-deps", dependencies: ["not", "an", "object"] })
    );

    assert.throws(
      () => checkDependenciesMaterialized(invalidDepsDir),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCIES_NOT_READY &&
        err.message.includes("dependencies")
    );

    const invalidOptionalDir = join(tempDir, "invalid-optional");
    mkdirSync(invalidOptionalDir, { recursive: true });
    writeFileSync(
      join(invalidOptionalDir, "package.json"),
      JSON.stringify({ name: "invalid-optional", optionalDependencies: "string-invalid" })
    );

    assert.throws(
      () => checkDependenciesMaterialized(invalidOptionalDir),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCIES_NOT_READY &&
        err.message.includes("optionalDependencies")
    );

    writeFileSync(join(invalidDepsDir, "package.json"), JSON.stringify({ dependencies: { broken: 42 } }));
    assert.throws(() => checkDependenciesMaterialized(invalidDepsDir), { code: DEPENDENCIES_NOT_READY });
  });

  it("对仅有import导出（无main）的ES模块依赖不误判为缺失", () => {
    const projectDir = join(tempDir, "esm-project");
    mkdirSync(join(projectDir, "node_modules", "esm-dep"), { recursive: true });

    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({
        name: "esm-project",
        type: "module",
        dependencies: {
          "esm-dep": "^1.0.0",
        },
      })
    );

    writeFileSync(
      join(projectDir, "node_modules", "esm-dep", "package.json"),
      JSON.stringify({
        name: "esm-dep",
        version: "1.0.0",
        type: "module",
        exports: {
          import: "./index.js",
        },
      })
    );

    const status = checkDependenciesMaterialized(projectDir);
    assert.strictEqual(status.ready, true);
    assert.strictEqual(status.missing.length, 0);
    assert.strictEqual(status.requiredCount, 1);
  });

  it("optionalDependencies覆盖同名必需声明，且Object.hasOwn避免原型属性误判", () => {
    const optDir = join(tempDir, "opt-project");
    mkdirSync(optDir, { recursive: true });

    // 同名条目同时在 dependencies 与 optionalDependencies 中声明，且未物化
    writeFileSync(
      join(optDir, "package.json"),
      JSON.stringify({
        name: "opt-project",
        dependencies: {
          "missing-optional-pkg": "^1.0.0",
        },
        optionalDependencies: {
          "missing-optional-pkg": "^1.0.0",
        },
      })
    );

    const optStatus = checkDependenciesMaterialized(optDir);
    assert.strictEqual(optStatus.ready, true);
    assert.strictEqual(optStatus.missing.length, 0);
    assert.strictEqual(optStatus.requiredCount, 0);

    // 原型属性（如 toString）声明在 dependencies 中，且未显式在 optionalDependencies 覆盖
    const protoDir = join(tempDir, "proto-project");
    mkdirSync(protoDir, { recursive: true });
    writeFileSync(
      join(protoDir, "package.json"),
      JSON.stringify({
        name: "proto-project",
        dependencies: {
          toString: "^1.0.0",
        },
        optionalDependencies: {},
      })
    );

    const protoStatus = checkDependenciesMaterialized(protoDir);
    assert.strictEqual(protoStatus.ready, false);
    assert.deepStrictEqual(protoStatus.missing, ["toString"]);
    assert.strictEqual(protoStatus.requiredCount, 1);
  });

  it("声明packageManager为pnpm或yarn时无锁不启动npm并要求手动准备", async () => {
    const pnpmDir = join(tempDir, "pnpm-project");
    mkdirSync(pnpmDir, { recursive: true });
    writeFileSync(
      join(pnpmDir, "package.json"),
      JSON.stringify({
        name: "pnpm-project",
        packageManager: "pnpm@9.5.0",
        dependencies: {
          "dummy-pkg": "^1.0.0",
        },
      })
    );

    await assert.rejects(
      ensureProjectDependencies(pnpmDir),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCIES_NOT_READY &&
        err.message.includes("pnpm")
    );

    const yarnDir = join(tempDir, "yarn-project");
    mkdirSync(yarnDir, { recursive: true });
    writeFileSync(
      join(yarnDir, "package.json"),
      JSON.stringify({
        name: "yarn-project",
        packageManager: "yarn@4.1.0",
        dependencies: {
          "dummy-pkg": "^1.0.0",
        },
      })
    );

    await assert.rejects(
      ensureProjectDependencies(yarnDir),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCIES_NOT_READY &&
        err.message.includes("yarn")
    );
  });

  it("多锁冲突或显式配置与锁冲突时禁止启动安装", async () => {
    const multiLockDir = join(tempDir, "multi-lock-project");
    mkdirSync(multiLockDir, { recursive: true });
    writeFileSync(
      join(multiLockDir, "package.json"),
      JSON.stringify({
        name: "multi-lock-project",
        dependencies: { "dummy-dep": "^1.0.0" },
      })
    );
    writeFileSync(join(multiLockDir, "package-lock.json"), "{}");
    writeFileSync(join(multiLockDir, "bun.lock"), "");

    // 即使指定 ACTIONDOCK_INSTALLER=npm，多锁冲突也不能被忽略
    process.env.ACTIONDOCK_INSTALLER = "npm";
    await assert.rejects(
      ensureProjectDependencies(multiLockDir),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCY_INSTALL_FAILED &&
        err.message.includes("Conflicting lockfiles")
    );

    delete process.env.ACTIONDOCK_INSTALLER;

    // 单一锁文件与显式 ACTIONDOCK_INSTALLER 冲突
    const mismatchDir = join(tempDir, "mismatch-lock-project");
    mkdirSync(mismatchDir, { recursive: true });
    writeFileSync(
      join(mismatchDir, "package.json"),
      JSON.stringify({
        name: "mismatch-lock-project",
        dependencies: { "dummy-dep": "^1.0.0" },
      })
    );
    writeFileSync(join(mismatchDir, "bun.lock"), "");

    process.env.ACTIONDOCK_INSTALLER = "npm";
    await assert.rejects(
      ensureProjectDependencies(mismatchDir),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCY_INSTALL_FAILED &&
        err.message.includes("conflicts with existing bun lockfile")
    );
  });

  it("当目标子包或同工作区其他成员已有node_modules时严禁冷首装重建", async () => {
    const monorepoRoot = join(tempDir, "existing-sub-monorepo");
    mkdirSync(monorepoRoot, { recursive: true });
    writeFileSync(
      join(monorepoRoot, "package.json"),
      JSON.stringify({
        name: "existing-sub-monorepo",
        workspaces: ["packages/*"],
      })
    );

    const subToolA = join(monorepoRoot, "packages", "tool-a");
    mkdirSync(subToolA, { recursive: true });
    writeFileSync(
      join(subToolA, "package.json"),
      JSON.stringify({
        name: "tool-a",
        dependencies: { "uninstalled-dep": "^1.0.0" },
      })
    );

    // 子包 tool-a 自身已有 node_modules，根目录为空
    mkdirSync(join(subToolA, "node_modules"), { recursive: true });

    await assert.rejects(
      ensureProjectDependencies(subToolA),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCIES_NOT_READY &&
        err.message.includes("Existing node_modules found")
    );

    // 另一个子包 tool-b 自身没有 node_modules，但同工作区 tool-a 已有
    const subToolB = join(monorepoRoot, "packages", "tool-b");
    mkdirSync(subToolB, { recursive: true });
    writeFileSync(
      join(subToolB, "package.json"),
      JSON.stringify({
        name: "tool-b",
        dependencies: { "uninstalled-dep": "^1.0.0" },
      })
    );

    await assert.rejects(
      ensureProjectDependencies(subToolB),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCIES_NOT_READY &&
        err.message.includes("Existing node_modules found")
    );

    writeFileSync(join(monorepoRoot, "package.json"), JSON.stringify({
      name: "existing-sub-monorepo", workspaces: ["packages/*"], dependencies: { "uninstalled-dep": "1.0.0" },
    }));
    await assert.rejects(ensureProjectDependencies(monorepoRoot), { code: DEPENDENCIES_NOT_READY });
  });

  it("传入已取消信号时不启动安装并返回ACTION_CANCELLED", async () => {
    const cancelledDir = join(tempDir, "cancelled-project");
    mkdirSync(cancelledDir, { recursive: true });
    writeFileSync(
      join(cancelledDir, "package.json"),
      JSON.stringify({
        name: "cancelled-project",
        dependencies: { "missing-dep": "^1.0.0" },
      })
    );

    const controller = new AbortController();
    controller.abort();

    const fakeDriver = new FakeProcessDriver();
    let customCalled = false;
    fakeDriver.onSpawn = () => {
      customCalled = true;
    };

    await assert.rejects(
      ensureProjectDependencies(cancelledDir, {
        signal: controller.signal,
        processDriver: fakeDriver,
      }),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === ACTION_CANCELLED
    );

    assert.strictEqual(customCalled, false);
    // 验证锁已释放且可正常获取
    const release = acquireProjectLock(cancelledDir);
    release();
  });

  it("取消与超时时彻底终止清理，并可靠释放工程排他锁（确定性fake与postverify）", async () => {
    const lockTestDir = join(tempDir, "lock-cleanup-project");
    mkdirSync(lockTestDir, { recursive: true });
    writeFileSync(
      join(lockTestDir, "package.json"),
      JSON.stringify({
        name: "lock-cleanup-project",
        dependencies: { "my-test-dep": "^1.0.0" },
      })
    );

    // 取消之后，执行器清理完成之前仍须持有工程锁。
    const abortCtrl = new AbortController();
    let terminateCalledResolve!: () => void;
    const terminateCalled = new Promise<void>((r) => {
      terminateCalledResolve = r;
    });
    let finishTerminate!: () => void;
    const fakeDriver = new FakeProcessDriver();
    const originalTerminate = fakeDriver.terminate.bind(fakeDriver);
    fakeDriver.terminate = async (handle, graceMs) => {
      const waitPromise = new Promise<void>((resolve) => {
        finishTerminate = resolve;
      });
      terminateCalledResolve();
      await waitPromise;
      return originalTerminate(handle, graceMs);
    };

    const abortPromise = ensureProjectDependencies(lockTestDir, {
      signal: abortCtrl.signal,
      processDriver: fakeDriver,
    });
    const rejection = assert.rejects(abortPromise, { code: ACTION_CANCELLED });
    // 等待启动后中止
    await new Promise((r) => setTimeout(r, 10));
    abortCtrl.abort();
    // 等待 terminate 已被调度执行但尚未完成
    await terminateCalled;
    // 在 terminate 结算完成之前，工程锁仍被占用
    assert.throws(() => acquireProjectLock(lockTestDir), { code: "PROJECT_BUSY" });
    finishTerminate();
    await rejection;

    // 确认工程锁已释放，可以立即重新加锁
    const releaseAfterAbort = acquireProjectLock(lockTestDir);
    releaseAfterAbort();

    // 2. 超时触发，工程锁被释放
    const timeoutDriver = new FakeProcessDriver();
    const timeoutPromise = ensureProjectDependencies(lockTestDir, {
      timeoutMs: 30,
      processDriver: timeoutDriver,
    });

    await assert.rejects(
      timeoutPromise,
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCY_INSTALL_FAILED &&
        err.message.includes("timed out")
    );

    const releaseAfterTimeout = acquireProjectLock(lockTestDir);
    releaseAfterTimeout();

    // 3. fakeDriver 假装成功且写入依赖元数据，安装后检验顺利通过
    const successDriver = new FakeProcessDriver();
    successDriver.onSpawn = (_handle, _spec, observer) => {
      mkdirSync(join(lockTestDir, "node_modules", "my-test-dep"), { recursive: true });
      writeFileSync(
        join(lockTestDir, "node_modules", "my-test-dep", "package.json"),
        JSON.stringify({ name: "my-test-dep", version: "1.0.0" })
      );
      observer.output("stdout", new TextEncoder().encode("installed successfully\n"));
      observer.exited({ code: 0, signal: null });
      observer.outputClosed("natural");
    };

    const successResult = await ensureProjectDependencies(lockTestDir, {
      processDriver: successDriver,
    });

    assert.strictEqual(successResult.installed, true);
    assert.strictEqual(successResult.installRoot, lockTestDir);
    assert.strictEqual(successResult.packageManager, "npm");

    // 再次检验工程锁处于空闲状态
    const releaseFinal = acquireProjectLock(lockTestDir);
    releaseFinal();
  });

  it("自定义安装器执行成功但未写入必需依赖元数据时后置校验失败并拒绝标记成功", async () => {
    const postVerifyDir = join(tempDir, "post-verify-failed-project");
    mkdirSync(postVerifyDir, { recursive: true });
    writeFileSync(
      join(postVerifyDir, "package.json"),
      JSON.stringify({
        name: "post-verify-failed-project",
        dependencies: { "unresolved-after-install": "^1.0.0" },
      })
    );

    const failVerifyDriver = new FakeProcessDriver();
    failVerifyDriver.onSpawn = (_handle, _spec, observer) => {
      // 返回 0 但故意不写入依赖 package.json
      observer.output("stdout", new TextEncoder().encode("mock ok\n"));
      observer.exited({ code: 0, signal: null });
      observer.outputClosed("natural");
    };

    await assert.rejects(
      ensureProjectDependencies(postVerifyDir, {
        processDriver: failVerifyDriver,
      }),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCY_INSTALL_FAILED &&
        err.message.includes("still not resolvable after installation")
    );

    // 锁被释放
    const release = acquireProjectLock(postVerifyDir);
    release();
  });

  it("进度输出失败时收敛真实安装进程并释放工程锁", { skip: process.platform === "win32" }, async () => {
    const realProcDir = join(tempDir, "real-proc-project");
    mkdirSync(realProcDir, { recursive: true });
    writeFileSync(
      join(realProcDir, "package.json"),
      JSON.stringify({
        name: "real-proc-project",
        dependencies: { "missing-child-dep": "^1.0.0" },
      })
    );

    // 创建模拟的 npm 可执行文件，注入到局部 PATH
    const mockBinDir = join(tempDir, "bin");
    mkdirSync(mockBinDir, { recursive: true });
    const mockNpmScript = join(mockBinDir, "npm");
    writeFileSync(
      mockNpmScript,
      `#!/usr/bin/env node
process.stderr.write("mock npm child started\\n");
// 持续挂起等待系统信号
setInterval(() => {}, 1000);
`,
      { mode: 0o755 }
    );

    process.env.PATH = `${mockBinDir}:${process.env.PATH}`;

    let progressCallCount = 0;

    const installPromise = ensureProjectDependencies(realProcDir, {
      timeoutMs: 10_000,
      onProgress: (msg) => {
        progressCallCount++;
        if (msg.includes("mock npm child started")) {
          throw new Error("Progress callback test error");
        }
      },
    });

    await assert.rejects(
      installPromise,
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCY_INSTALL_FAILED &&
        err.details?.stage === "progress"
    );

    assert.ok(progressCallCount > 0, "onProgress 回调应当被至少触发一次");

    // 验证真实子进程收敛后，工程排他锁已被可靠释放
    const release = acquireProjectLock(realProcDir);
    release();
  });
});
