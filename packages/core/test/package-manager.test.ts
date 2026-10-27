import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ActionDockError,
  DEPENDENCY_INSTALL_FAILED,
} from "../src/errors";
import {
  resolvePackageManagerInvocation,
  runPackageManager,
} from "../src/project/package-manager";
import { MemoryProcessDriver } from "../src/process/driver";
import { executeCommand } from "../src/process/command-executor";
import type { LaunchSpec } from "@actiondock/sdk";

describe("统一包管理器启动解析器 (resolvePackageManagerInvocation)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-pm-resolver-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("POSIX平台下直接返回对应包管理器名称与原样参数数组", () => {
    const rawArgs = ["install", "--omit=dev", "pkg with space", 'quote"inside', "var%VAR%", "amp&ersand"];
    const npmRes = resolvePackageManagerInvocation("npm", rawArgs, {
      platform: "linux",
    });
    assert.strictEqual(npmRes.executable, "npm");
    assert.deepStrictEqual(npmRes.args, rawArgs);

    const bunRes = resolvePackageManagerInvocation("bun", rawArgs, {
      platform: "darwin",
    });
    assert.strictEqual(bunRes.executable, "bun");
    assert.deepStrictEqual(bunRes.args, rawArgs);
  });

  it("Windows平台PATHEXT选exe优先cmd，反向用户顺序选cmd", () => {
    const binDir = join(tempDir, "pathext-order-bin");
    mkdirSync(binDir, { recursive: true });

    const npmExe = join(binDir, "npm.exe");
    writeFileSync(npmExe, "binary npm");
    const npmCmd = join(binDir, "npm.cmd");
    writeFileSync(npmCmd, "@ECHO OFF\r\n");

    const cliDir = join(binDir, "node_modules", "npm", "bin");
    mkdirSync(cliDir, { recursive: true });
    const npmCli = join(cliDir, "npm-cli.js");
    writeFileSync(npmCli, "// npm cli js");

    const fakeNode = join(tempDir, "node.exe");

    // 默认 PATHEXT (.COM;.EXE;.BAT;.CMD)：优先选中 npm.exe，直接返回原生可执行程序
    const resDefault = resolvePackageManagerInvocation("npm", ["install"], {
      platform: "win32",
      execPath: fakeNode,
      env: { PATH: binDir },
    });
    assert.strictEqual(resDefault.executable, npmExe);
    assert.deepStrictEqual(resDefault.args, ["install"]);

    // 用户自定义反向 PATHEXT (.CMD;.EXE)：优先选中 npm.cmd，通过 Node 启动 npm-cli.js
    const resReversed = resolvePackageManagerInvocation("npm", ["install"], {
      platform: "win32",
      execPath: fakeNode,
      env: {
        PATH: binDir,
        PATHEXT: ".cmd;.exe",
      },
    });
    assert.strictEqual(resReversed.executable, fakeNode);
    assert.strictEqual(resReversed.args[0], npmCli);
    assert.deepStrictEqual(resReversed.args.slice(1), ["install"]);
  });

  it("Windows平台npm非原生分支仅支持.cmd与.bat，遇到其他扩展名明确拒绝", () => {
    const binDir = join(tempDir, "ps1-bin");
    mkdirSync(binDir, { recursive: true });
    const ps1Wrapper = join(binDir, "npm.ps1");
    writeFileSync(ps1Wrapper, "# powershell script");

    // 目录下即便放了邻接 npm-cli.js，也绝不能把选中的 npm.ps1 偷换执行
    const cliDir = join(binDir, "node_modules", "npm", "bin");
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(join(cliDir, "npm-cli.js"), "// cli");

    assert.throws(
      () =>
        resolvePackageManagerInvocation("npm", ["install"], {
          platform: "win32",
          execPath: join(tempDir, "node.exe"),
          env: {
            PATH: binDir,
            PATHEXT: ".ps1;.cmd",
          },
        }),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCY_INSTALL_FAILED &&
        err.message.includes("Unsupported npm wrapper extension") &&
        err.details?.path === ps1Wrapper
    );
  });

  it("Windows平台不同PATH目录不越过前面的unsupported wrapper", () => {
    const dir1 = join(tempDir, "unsupported-dir");
    mkdirSync(dir1, { recursive: true });
    const unsupportedWrapper = join(dir1, "npm.cmd");
    writeFileSync(unsupportedWrapper, "@ECHO OFF\r\ncustom-wrapper %*\r\n");

    const dir2 = join(tempDir, "valid-dir");
    const validCliDir = join(dir2, "node_modules", "npm", "bin");
    mkdirSync(validCliDir, { recursive: true });
    writeFileSync(join(dir2, "npm.cmd"), "@ECHO OFF\r\n");
    writeFileSync(join(validCliDir, "npm-cli.js"), "// valid cli");

    // dir1 排在 PATH 前面，必须报错，绝对不能越过前面的 unsupported wrapper 命中 dir2
    const combinedPath = `${dir1};${dir2}`;

    assert.throws(
      () =>
        resolvePackageManagerInvocation("npm", ["install"], {
          platform: "win32",
          execPath: join(tempDir, "node.exe"),
          env: { PATH: combinedPath },
        }),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCY_INSTALL_FAILED &&
        err.message.includes("Unsupported npm wrapper") &&
        err.details?.path === unsupportedWrapper
    );
  });

  it("Windows平台quoted与relative PATH以及大小写env均正确解析与隔离", () => {
    const relativeSubDir = "relative-bin";
    const absoluteBinDir = join(tempDir, relativeSubDir);
    mkdirSync(join(absoluteBinDir, "node_modules", "npm", "bin"), { recursive: true });
    writeFileSync(join(absoluteBinDir, "npm.cmd"), "@ECHO OFF\r\n");
    const cliPath = join(absoluteBinDir, "node_modules", "npm", "bin", "npm-cli.js");
    writeFileSync(cliPath, "// cli");

    const fakeNode = join(tempDir, "node.exe");

    // 1. 引号包裹目录以及大小写不敏感环境变量（例如小写 path 与 pathext）
    const invocationQuoted = resolvePackageManagerInvocation("npm", ["run", "build"], {
      platform: "win32",
      execPath: fakeNode,
      env: {
        path: `"${absoluteBinDir}"`,
        pathext: ".cmd;.exe",
      },
    });
    assert.strictEqual(invocationQuoted.executable, fakeNode);
    assert.strictEqual(invocationQuoted.args[0], cliPath);

    // 2. 相对 PATH 目录以 options.cwd 为基准解析
    const invocationRelative = resolvePackageManagerInvocation("npm", ["test"], {
      platform: "win32",
      cwd: tempDir,
      execPath: fakeNode,
      env: {
        Path: relativeSubDir,
      },
    });
    assert.strictEqual(invocationRelative.executable, fakeNode);
    assert.strictEqual(invocationRelative.args[0], cliPath);

    // 3. 显式传入 env: { PATH: "" } 绝不回退至 process.env
    assert.throws(
      () =>
        resolvePackageManagerInvocation("npm", ["list"], {
          platform: "win32",
          execPath: fakeNode,
          env: { PATH: "" },
        }),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCY_INSTALL_FAILED &&
        err.message.includes("Cannot locate npm on Windows")
    );
  });

  it("Windows平台符号链接真目标优先且link旁反例CLI不被误选", () => {
    const realDir = join(tempDir, "real-npm-dir");
    const realCliDir = join(realDir, "node_modules", "npm", "bin");
    mkdirSync(realCliDir, { recursive: true });
    const realWrapper = join(realDir, "npm.cmd");
    writeFileSync(realWrapper, "@ECHO OFF\r\n");
    const realCliPath = join(realCliDir, "npm-cli.js");
    writeFileSync(realCliPath, "// REAL cli");

    // 构造另一个目录，放置符号链接 npm.cmd 指向 realWrapper
    // 关键反例：在该目录下放置一份伪造的 node_modules/npm/bin/npm-cli.js
    const linkDir = join(tempDir, "link-npm-dir");
    const fakeCliDir = join(linkDir, "node_modules", "npm", "bin");
    mkdirSync(fakeCliDir, { recursive: true });
    writeFileSync(join(fakeCliDir, "npm-cli.js"), "// FAKE link cli");

    const symlinkWrapper = join(linkDir, "npm.cmd");
    symlinkSync(realWrapper, symlinkWrapper, "file");

    const fakeExecPath = join(tempDir, "node.exe");
    const invocation = resolvePackageManagerInvocation("npm", ["ci"], {
      platform: "win32",
      execPath: fakeExecPath,
      env: { PATH: linkDir },
    });

    assert.strictEqual(invocation.executable, fakeExecPath);
    // 必须精准选用真目标所在目录下的 realCliPath，而不是 linkDir 旁边的伪造 CLI
    assert.strictEqual(invocation.args[0], realCliPath);
    assert.deepStrictEqual(invocation.args.slice(1), ["ci"]);
  });

  it("Windows平台符号链接真目标无CLI时即使link旁有CLI也必须坚决拒绝", () => {
    // 真实目标目录：只有 npm.cmd，无标准 npm-cli.js 布局
    const realEmptyDir = join(tempDir, "real-empty-npm-dir");
    mkdirSync(realEmptyDir, { recursive: true });
    const realWrapper = join(realEmptyDir, "npm.cmd");
    writeFileSync(realWrapper, "@ECHO OFF\r\n");

    // 链接目录：符号链接指向 realWrapper，且链接目录旁边放了一份伪造的 npm-cli.js
    const linkDir = join(tempDir, "link-with-rogue-cli");
    const rogueCliDir = join(linkDir, "node_modules", "npm", "bin");
    mkdirSync(rogueCliDir, { recursive: true });
    writeFileSync(join(rogueCliDir, "npm-cli.js"), "// rogue cli adjacent to symlink");

    const symlinkWrapper = join(linkDir, "npm.cmd");
    symlinkSync(realWrapper, symlinkWrapper, "file");

    assert.throws(
      () =>
        resolvePackageManagerInvocation("npm", ["install"], {
          platform: "win32",
          execPath: join(tempDir, "node.exe"),
          env: { PATH: linkDir },
        }),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCY_INSTALL_FAILED &&
        err.message.includes("Unsupported npm wrapper") &&
        err.details?.path === symlinkWrapper
    );
  });

  it("Windows平台符号链接文件直接指向npm-cli.js时可直接选用该CLI", () => {
    const targetCliDir = join(tempDir, "cli-target");
    mkdirSync(targetCliDir, { recursive: true });
    const realCliPath = join(targetCliDir, "npm-cli.js");
    writeFileSync(realCliPath, "// target npm-cli.js");

    const binDir = join(tempDir, "file-symlink-bin");
    mkdirSync(binDir, { recursive: true });
    const symlinkFile = join(binDir, "npm.cmd");
    symlinkSync(realCliPath, symlinkFile, "file");

    const fakeNode = join(tempDir, "node.exe");
    const invocation = resolvePackageManagerInvocation("npm", ["audit"], {
      platform: "win32",
      execPath: fakeNode,
      env: { PATH: binDir },
    });

    assert.strictEqual(invocation.executable, fakeNode);
    assert.strictEqual(invocation.args[0], realCliPath);
    assert.deepStrictEqual(invocation.args.slice(1), ["audit"]);
  });

  it("Windows平台参数中包含空格、&、%、引号及特殊字符原样保留", () => {
    const nodeInstallDir = join(tempDir, "Node install with spaces & 100%");
    const cliDir = join(nodeInstallDir, "node_modules", "npm", "bin");
    mkdirSync(cliDir, { recursive: true });

    writeFileSync(join(nodeInstallDir, "npm.cmd"), "@ECHO OFF\r\nnode.exe npm-cli.js %*\r\n");
    const cliPath = join(cliDir, "npm-cli.js");
    writeFileSync(cliPath, "// mock npm cli");

    const specialArgs = [
      "pack",
      "--pack-destination",
      join(tempDir, "output dir & %TEST%"),
      'quoted"value',
      "^caret",
      "!bang",
      "trailing\\",
      "space inside string",
    ];

    const fakeExecPath = join(tempDir, "fake-node.exe");
    const invocation = resolvePackageManagerInvocation("npm", specialArgs, {
      platform: "win32",
      execPath: fakeExecPath,
      env: {
        PATH: nodeInstallDir,
      },
    });

    assert.strictEqual(invocation.executable, fakeExecPath);
    assert.strictEqual(invocation.args[0], cliPath);
    assert.deepStrictEqual(invocation.args.slice(1), specialArgs);
  });

  it("Windows平台nvm或bin子目录布局正确解析上级npm-cli.js", () => {
    const rootDir = join(tempDir, "nvm-root");
    const binDir = join(rootDir, "bin");
    const cliDir = join(rootDir, "node_modules", "npm", "bin");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(cliDir, { recursive: true });

    writeFileSync(join(binDir, "npm.cmd"), "@ECHO OFF\r\n");
    const cliPath = join(cliDir, "npm-cli.js");
    writeFileSync(cliPath, "// mock npm cli");

    const fakeExecPath = join(tempDir, "node.exe");
    const invocation = resolvePackageManagerInvocation("npm", ["--version"], {
      platform: "win32",
      execPath: fakeExecPath,
      env: { PATH: binDir },
    });

    assert.strictEqual(invocation.executable, fakeExecPath);
    assert.strictEqual(invocation.args[0], cliPath);
    assert.deepStrictEqual(invocation.args.slice(1), ["--version"]);
  });

  it("Windows平台无PATH不偷选execPath旁npm或无关npm_execpath", () => {
    const nodeDir = join(tempDir, "nodejs");
    const cliDir = join(nodeDir, "node_modules", "npm", "bin");
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(join(cliDir, "npm-cli.js"), "// adjacent cli");

    const nodeExe = join(nodeDir, "node.exe");
    writeFileSync(nodeExe, "fake node");

    const foreignCli = join(tempDir, "foreign-npm-cli.js");
    writeFileSync(foreignCli, "// foreign cli");

    // 即使 execPath 旁边存在完整的 npm 安装，即使 env 里带有 npm_execpath
    // 只要 PATH 中没有检索到 npm，就必须明确报错，严禁隐式 fallback 绕过 PATH
    assert.throws(
      () =>
        resolvePackageManagerInvocation("npm", ["list"], {
          platform: "win32",
          execPath: nodeExe,
          env: {
            PATH: "",
            npm_execpath: foreignCli,
          },
        }),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCY_INSTALL_FAILED &&
        err.message.includes("Cannot locate npm on Windows")
    );
  });

  it("Windows平台index.js不能作为npm入口CLI并明确报错", () => {
    const badNpmDir = join(tempDir, "bad-npm-layout");
    const badCliDir = join(badNpmDir, "node_modules", "npm");
    mkdirSync(badCliDir, { recursive: true });
    writeFileSync(join(badNpmDir, "npm.cmd"), "@ECHO OFF\r\n");
    // 故意只创建 index.js，不创建 bin/npm-cli.js
    writeFileSync(join(badCliDir, "index.js"), "// index.js is not cli entry");

    assert.throws(
      () =>
        resolvePackageManagerInvocation("npm", ["install"], {
          platform: "win32",
          execPath: join(tempDir, "node.exe"),
          env: { PATH: badNpmDir },
        }),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCY_INSTALL_FAILED &&
        err.message.includes("Unsupported npm wrapper")
    );
  });

  it("Windows平台Bun原生与batch包装脚本失败分支明确判定", () => {
    const bunDir = join(tempDir, "bun-bin");
    mkdirSync(bunDir, { recursive: true });
    const bunExe = join(bunDir, "bun.exe");
    writeFileSync(bunExe, "fake bun binary");

    // 1. 原生 exe 正常解析
    const res = resolvePackageManagerInvocation("bun", ["test"], {
      platform: "win32",
      env: { PATH: bunDir },
    });
    assert.strictEqual(res.executable, bunExe);
    assert.deepStrictEqual(res.args, ["test"]);

    // 2. 遇到 cmd/bat wrapper 明确不支持并报错，不能偷换或忽略
    const batchBunDir = join(tempDir, "bun-batch-bin");
    mkdirSync(batchBunDir, { recursive: true });
    const bunCmd = join(batchBunDir, "bun.cmd");
    writeFileSync(bunCmd, "@ECHO OFF\r\n");

    assert.throws(
      () =>
        resolvePackageManagerInvocation("bun", ["test"], {
          platform: "win32",
          env: { PATH: batchBunDir },
        }),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCY_INSTALL_FAILED &&
        err.message.includes("Unsupported bun wrapper") &&
        err.details?.path === bunCmd
    );

    // 3. PATH 缺失时明确报错，严禁回退到 bun.exe 字符串
    assert.throws(
      () =>
        resolvePackageManagerInvocation("bun", ["add", "foo"], {
          platform: "win32",
          env: { PATH: "" },
        }),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCY_INSTALL_FAILED &&
        err.message.includes("Cannot locate bun on Windows")
    );
  });

  it("Windows平台isFile检查防止将目录误认为可执行文件", () => {
    const binDir = join(tempDir, "dir-named-npm");
    // 创建一个名为 npm.cmd 的目录，而不是文件
    const dirAsNpm = join(binDir, "npm.cmd");
    mkdirSync(dirAsNpm, { recursive: true });

    assert.throws(
      () =>
        resolvePackageManagerInvocation("npm", ["install"], {
          platform: "win32",
          execPath: join(tempDir, "node.exe"),
          env: { PATH: binDir },
        }),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCY_INSTALL_FAILED &&
        err.message.includes("Cannot locate npm on Windows")
    );
  });

  it("Windows平台isFile遇到ENOTDIR路径段非目录时安全返回false并正确查找", () => {
    // 构造一个文件作为路径段，测试 ENOTDIR 安全返回 false
    const fileAsSegment = join(tempDir, "some-file");
    writeFileSync(fileAsSegment, "file content");
    const invalidSubPath = join(fileAsSegment, "npm.cmd");

    // 将包含无效段的路径放入 PATH，不应导致异常中断，应安全返回 false 并报告未找到
    assert.throws(
      () =>
        resolvePackageManagerInvocation("npm", ["install"], {
          platform: "win32",
          execPath: join(tempDir, "node.exe"),
          env: { PATH: fileAsSegment },
        }),
      (err: any) =>
        err instanceof ActionDockError &&
        err.code === DEPENDENCY_INSTALL_FAILED &&
        err.message.includes("Cannot locate npm on Windows")
    );
  });

  it("runPackageManager作为薄门面正确调用底层命令执行器", async () => {
    let capturedSpec: LaunchSpec | undefined;
    const driver = new MemoryProcessDriver();
    driver.spawnHook = (spec, observer) => {
      capturedSpec = spec;
      queueMicrotask(() => {
        observer.output("stdout", new TextEncoder().encode("ok\n"));
        observer.exited({ code: 0, signal: null });
        observer.outputClosed("natural");
      });
    };

    const res = await runPackageManager("npm", ["--version"], {
      platform: "linux",
      driver,
    });

    assert.strictEqual(res.status, 0);
    assert.strictEqual(res.stdout, "ok\n");
    assert.strictEqual(capturedSpec?.executable, "npm");
    assert.deepStrictEqual(capturedSpec?.args, ["--version"]);
  });

  it("Windows真实环境集成验证：runPackageManager执行npm --version探针无DEP0190告警", {
    skip: process.platform !== "win32" ? "仅在真实Windows环境下执行" : false,
  }, async () => {
    const preloadScript = resolve(process.cwd(), "scripts/test-preload.ts");
    const preloadUrl = pathToFileURL(preloadScript).href;
    const packageManagerScript = resolve(process.cwd(), "packages/core/src/project/package-manager.ts");
    const packageManagerUrl = pathToFileURL(packageManagerScript).href;

    const evalScript = `
      import { runPackageManager } from ${JSON.stringify(packageManagerUrl)};
      const res = await runPackageManager('npm', ['--version'], {
        env: {
          ...process.env,
          npm_config_offline: 'true',
        },
      });
      if (res.status !== 0) {
        process.exit(res.status ?? 1);
      }
      process.stdout.write(res.stdout);
    `;

    const probeEnv: Record<string, string | undefined> = { ...process.env };
    delete probeEnv.NODE_OPTIONS;
    delete probeEnv.NODE_NO_WARNINGS;
    probeEnv.npm_config_offline = "true";

    const probeResult = await executeCommand(process.execPath, [
      "--throw-deprecation",
      "--import",
      preloadUrl,
      "--input-type=module",
      "--eval",
      evalScript,
    ], {
      env: probeEnv,
    });

    assert.strictEqual(probeResult.status, 0, `探针进程退出码应为0，stderr: ${probeResult.stderr}`);
    assert.match(probeResult.stdout.trim(), /^\d+\.\d+\.\d+/, "探针进程应输出有效的npm版本号");
  });
});
