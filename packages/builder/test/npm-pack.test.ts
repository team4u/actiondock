import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { runNpmPack } from "../src/npm-pack";
import { BuilderError } from "../src/errors";
import { MemoryProcessDriver } from "../../core/src/process/driver";
import type { LaunchSpec } from "@actiondock/sdk";
import type { ProcessObserver } from "@actiondock/core/package";

describe("npm pack 运行器 (runNpmPack)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-npm-pack-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("普通小包打包成功返回正确 tgz 路径且不受用户 npm_config_json 环境变量干扰", async () => {
    const pkgDir = join(tempDir, "small-pkg");
    const outDir = join(tempDir, "out");
    mkdirSync(pkgDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });

    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "test-small-pkg", version: "1.0.0" }, null, 2),
      "utf-8"
    );

    const tarball = await runNpmPack(pkgDir, outDir, "fallback.tgz", {
      env: {
        ...process.env,
        npm_config_json: "true",
      },
    });

    assert.strictEqual(existsSync(tarball), true);
    assert.strictEqual(basename(tarball), "test-small-pkg-1.0.0.tgz");
  });

  it("特殊字符路径与包含特殊字符包名打包成功并返回正确 tgz 路径", async () => {
    const specialPkgDir = join(tempDir, "special pkg & 100%");
    const specialOutDir = join(tempDir, "dest space & !#");
    mkdirSync(specialPkgDir, { recursive: true });
    mkdirSync(specialOutDir, { recursive: true });

    writeFileSync(
      join(specialPkgDir, "package.json"),
      JSON.stringify({ name: "@special-scope/special-pkg", version: "2.1.0-beta.1" }, null, 2),
      "utf-8"
    );

    const tarball = await runNpmPack(specialPkgDir, specialOutDir, "fallback.tgz");
    assert.strictEqual(existsSync(tarball), true);
    assert.strictEqual(basename(tarball), "special-scope-special-pkg-2.1.0-beta.1.tgz");
  });

  it("多文件资产场景下即使底层输出流截断标志生效仍成功返回正确 tgz 路径", async () => {
    const pkgDir = join(tempDir, "multi-asset-pkg");
    const outDir = join(tempDir, "out");
    mkdirSync(pkgDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });

    const expectedName = "multi-asset-1.0.0.tgz";
    const expectedTarball = join(outDir, expectedName);
    writeFileSync(expectedTarball, "fake tarball content", "utf-8");

    let capturedArgs: readonly string[] | undefined;
    const driver = new MemoryProcessDriver();
    driver.spawnHook = (spec: LaunchSpec, observer: ProcessObserver) => {
      capturedArgs = spec.args;
      queueMicrotask(() => {
        observer.output("stdout", new TextEncoder().encode(`${expectedName}\n`));
        // 模拟 6500 资产输出产生的大量 stderr 日志
        observer.output("stderr", new TextEncoder().encode("npm notice ... large logs\n"));
        observer.exited({ code: 0, signal: null });
        observer.outputClosed("natural");
      });
    };

    const res = await runNpmPack(pkgDir, outDir, "fallback.tgz", {
      driver,
    });

    assert.strictEqual(res, expectedTarball);
    assert.ok(capturedArgs?.includes("--json=false"), "参数必须包含 --json=false");
  });

  it("畸形输出报错：stdout 为空时明确报错拒绝且不回退至 fallback 名称", async () => {
    const pkgDir = join(tempDir, "empty-stdout-pkg");
    const outDir = join(tempDir, "out");
    mkdirSync(pkgDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });

    const driver = new MemoryProcessDriver();
    driver.spawnHook = (_spec: LaunchSpec, observer: ProcessObserver) => {
      queueMicrotask(() => {
        observer.output("stdout", new TextEncoder().encode("   \n\n"));
        observer.exited({ code: 0, signal: null });
        observer.outputClosed("natural");
      });
    };

    await assert.rejects(
      async () => {
        await runNpmPack(pkgDir, outDir, "fallback.tgz", { driver });
      },
      (err: any) =>
        err instanceof BuilderError &&
        err.message.includes("npm pack produced empty stdout")
    );
  });

  it("畸形输出报错：stdout 包含多行输出时明确报错拒绝", async () => {
    const pkgDir = join(tempDir, "multi-line-pkg");
    const outDir = join(tempDir, "out");
    mkdirSync(pkgDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });

    const driver = new MemoryProcessDriver();
    driver.spawnHook = (_spec: LaunchSpec, observer: ProcessObserver) => {
      queueMicrotask(() => {
        observer.output("stdout", new TextEncoder().encode("pkg-a-1.0.0.tgz\npkg-b-1.0.0.tgz\n"));
        observer.exited({ code: 0, signal: null });
        observer.outputClosed("natural");
      });
    };

    await assert.rejects(
      async () => {
        await runNpmPack(pkgDir, outDir, "fallback.tgz", { driver });
      },
      (err: any) =>
        err instanceof BuilderError &&
        err.message.includes("npm pack produced unexpected multi-line output")
    );
  });

  it("畸形输出报错：stdout 输出非 .tgz 文件名时明确报错拒绝", async () => {
    const pkgDir = join(tempDir, "bad-ext-pkg");
    const outDir = join(tempDir, "out");
    mkdirSync(pkgDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });

    const driver = new MemoryProcessDriver();
    driver.spawnHook = (_spec: LaunchSpec, observer: ProcessObserver) => {
      queueMicrotask(() => {
        observer.output("stdout", new TextEncoder().encode("bad-output.txt\n"));
        observer.exited({ code: 0, signal: null });
        observer.outputClosed("natural");
      });
    };

    await assert.rejects(
      async () => {
        await runNpmPack(pkgDir, outDir, "fallback.tgz", { driver });
      },
      (err: any) =>
        err instanceof BuilderError &&
        err.message.includes("expected .tgz filename")
    );
  });

  it("畸形输出报错：stdout 指定的产物文件在磁盘上不存在时明确报错拒绝", async () => {
    const pkgDir = join(tempDir, "missing-file-pkg");
    const outDir = join(tempDir, "out");
    mkdirSync(pkgDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });

    const driver = new MemoryProcessDriver();
    driver.spawnHook = (_spec: LaunchSpec, observer: ProcessObserver) => {
      queueMicrotask(() => {
        observer.output("stdout", new TextEncoder().encode("nonexistent-1.0.0.tgz\n"));
        observer.exited({ code: 0, signal: null });
        observer.outputClosed("natural");
      });
    };

    await assert.rejects(
      async () => {
        await runNpmPack(pkgDir, outDir, "fallback.tgz", { driver });
      },
      (err: any) =>
        err instanceof BuilderError &&
        err.message.includes("npm pack did not produce expected tarball")
    );
  });

  it("畸形输出报错：遇到被截断的 JSON 输出时坚决拒绝，绝不将花括号作为文件名且不静默使用 fallback", async () => {
    const pkgDir = join(tempDir, "truncated-json-pkg");
    const outDir = join(tempDir, "out");
    mkdirSync(pkgDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });

    const driver = new MemoryProcessDriver();
    driver.spawnHook = (_spec: LaunchSpec, observer: ProcessObserver) => {
      queueMicrotask(() => {
        // 模拟原本被截断的 JSON 输出前缀
        observer.output("stdout", new TextEncoder().encode('[\n  {\n    "id": "sample",\n'));
        observer.exited({ code: 0, signal: null });
        observer.outputClosed("natural");
      });
    };

    await assert.rejects(
      async () => {
        await runNpmPack(pkgDir, outDir, "fallback.tgz", { driver });
      },
      (err: any) =>
        err instanceof BuilderError &&
        (err.message.includes("expected single tarball filename") ||
          err.message.includes("expected .tgz filename"))
    );
  });
});
