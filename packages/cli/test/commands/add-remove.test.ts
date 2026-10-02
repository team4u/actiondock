import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliProgram } from "../../src/commands";

describe("CLI 依赖管理命令 (ad add / ad remove)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-cli-add-remove-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("支持 ad add 命令选项注册与帮助信息展示", () => {
    const program = createCliProgram();
    const addCmd = program.commands.find((c) => c.name() === "add");
    assert.notStrictEqual(addCmd, undefined);
    assert.ok(addCmd!.description().includes("Install and lock an Action package dependency"));

    const removeCmd = program.commands.find((c) => c.name() === "remove");
    assert.notStrictEqual(removeCmd, undefined);
    assert.ok(removeCmd!.description().includes("Remove an Action package dependency"));
  });

  it("ad remove 拦截被 action uses 反向引用的依赖包移除操作", async () => {
    // 构造包含已声明 uses 的工程
    const manifest = {
      id: "my-app",
      version: "1.0.0",
      dependencies: {
        "pkg.tool": "pkg.tool",
      },
      actions: {
        doSomething: {
          entry: "actions/do.ts",
          uses: ["pkg.tool/some-action"],
        },
      },
    };

    writeFileSync(join(tempDir, "actiondock.json"), JSON.stringify(manifest, null, 2));
    writeFileSync(
      join(tempDir, "actiondock.lock.json"),
      JSON.stringify(
        {
          lockfileVersion: 1,
          packages: {
            "pkg.tool": {
              package: "pkg.tool",
              resolved: "1.0.0",
              manifestDigest: "sha256-mock",
            },
          },
        },
        null,
        2
      )
    );

    const program = createCliProgram();
    await assert.rejects(
      program.parseAsync(["node", "ad", "remove", "pkg.tool", "-P", tempDir])
    , /action 'doSomething' declares dependency on it in 'uses'/);

    // 清单与锁文件保持未被破坏
    const content = JSON.parse(readFileSync(join(tempDir, "actiondock.json"), "utf-8"));
    assert.notStrictEqual(content.dependencies?.["pkg.tool"], undefined);
  });

  it("ad remove 成功移除无反向引用的依赖并更新锁文件，保留该包存储命名空间", async () => {
    const manifest = {
      id: "my-app",
      version: "1.0.0",
      dependencies: {
        "pkg.unused": "pkg.unused",
      },
      actions: {
        doSomething: {
          entry: "actions/do.ts",
          uses: [],
        },
      },
    };

    writeFileSync(join(tempDir, "actiondock.json"), JSON.stringify(manifest, null, 2));
    writeFileSync(
      join(tempDir, "actiondock.lock.json"),
      JSON.stringify(
        {
          lockfileVersion: 1,
          packages: {
            "pkg.unused": {
              package: "pkg.unused",
              resolved: "1.0.0",
              manifestDigest: "sha256-mock",
            },
          },
        },
        null,
        2
      )
    );

    const program = createCliProgram();
    await program.parseAsync(["node", "ad", "remove", "pkg.unused", "-P", tempDir]);

    // 清单中已移除
    const afterManifest = JSON.parse(readFileSync(join(tempDir, "actiondock.json"), "utf-8"));
    assert.strictEqual(afterManifest.dependencies, undefined);

    // 锁文件中已移除
    const afterLock = JSON.parse(readFileSync(join(tempDir, "actiondock.lock.json"), "utf-8"));
    assert.strictEqual(afterLock.packages?.["pkg.unused"], undefined);
  });
});
