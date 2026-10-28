import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { Command } from "commander";
import { createConfigKeyProvider, initProject } from "@actiondock/core";
import { resolveDatabasePath, SqliteRuntimeStorage } from "@actiondock/core/package";
import { linkPackage } from "@actiondock/core/registry";
import { registerConfigSetCommand } from "../src/commands/config/set";
import { promptBrowserSecret, type PromptBrowserSecretOptions } from "../src/services/browser-secret-input";
import { runCliAsync } from "./helpers/run-cli";
import type { CliContext } from "../src/types";

function assertEncryptedSecret(
  raw: string,
  scope: string,
  key: string,
  customHome: string,
  expected: string,
  dbPath?: string
): void {
  assert.match(raw, /^adenc:v1:/);
  assert.strictEqual(raw.includes(expected), false);
  // 以真实存储重开验证透明解密：不依赖公开加解密原语
  const storage = new SqliteRuntimeStorage({
    dbPath: dbPath ?? resolveDatabasePath(scope, { customHome }),
    packageId: scope,
    configKeyProvider: createConfigKeyProvider({ customHome }),
  });
  try {
    assert.strictEqual(storage.getConfig(key), expected);
  } finally {
    void storage.close();
  }
}

function makeRawHttpRequest(
  port: number,
  path: string,
  headers: Record<string, string>,
  body?: string
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: body !== undefined ? "POST" : "GET",
        headers,
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode || 0, text });
        });
      }
    );
    req.on("error", reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

function createInjectableConfigRunner(tempHome: string, injectValue: string) {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let pageHtml = "";

  const context: CliContext = {
    customHome: tempHome,
    stdout: (msg: string) => stdoutChunks.push(msg),
    stderr: (msg: string) => stderrChunks.push(msg),
  };

  const customPrompt = (opts: PromptBrowserSecretOptions) => {
    return promptBrowserSecret({
      ...opts,
      timeoutMs: 3000,
      openBrowser: async (url) => {
        const [base, hash] = url.split("#");
        const origin = base.replace(/\/$/, "");
        const host = origin.replace(/^http:\/\//, "");
        const port = Number(host.split(":")[1]);
        const ticket = new URLSearchParams(hash).get("ticket") || "";

        const getRes = await makeRawHttpRequest(port, "/", { Host: host });
        pageHtml = getRes.text;

        const res = await makeRawHttpRequest(
          port,
          "/submit",
          {
            Host: host,
            Origin: origin,
            "Content-Type": "application/json",
          },
          JSON.stringify({ ticket, value: injectValue })
        );
        return res.status === 200;
      },
    });
  };

  const execute = async (argv: string[], cwd?: string) => {
    pageHtml = "";
    stdoutChunks.length = 0;
    stderrChunks.length = 0;
    const origCwd = process.cwd();
    if (cwd) process.chdir(cwd);
    try {
      const program = new Command();
      program.exitOverride();
      const configCmd = program.command("config");
      registerConfigSetCommand(configCmd, context, customPrompt);
      await program.parseAsync(["node", "ad", "config", ...argv]);
      return {
        exitCode: 0,
        stdout: stdoutChunks.join("\n"),
        stderr: stderrChunks.join("\n"),
        pageHtml,
      };
    } finally {
      if (cwd) process.chdir(origCwd);
    }
  };

  return { execute, stdoutChunks, stderrChunks };
}

describe("CLI ad config set --browser 参数、目标、声明与端到端测试", () => {
  let tempDir: string;
  let tempHome: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-browser-cli-"));
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-browser-home-"));

    initProject(tempDir, { id: "test.browser.pkg", name: "浏览器敏感配置测试" });

    const manifestPath = join(tempDir, "actiondock.json");
    const manifest = {
      specVersion: 2,
      id: "test.browser.pkg",
      name: "浏览器敏感配置测试",
      version: "1.0.0",
      description: "Test package",
      config: {
        GITHUB_TOKEN: {
          type: "string",
          secret: true,
          description: "GitHub access token",
        },
        UNTYPED_SECRET: {
          secret: true,
          description: "Secret without explicit type",
        },
        SCHEMA_STRING_SECRET: {
          schema: { type: "string" },
          secret: true,
          description: "Secret with schema.type string",
        },
        PUBLIC_CONFIG: {
          type: "string",
          secret: false,
          description: "Non-secret configuration",
        },
        NESTED_ONLY_SECRET: {
          type: "object",
          schema: {
            type: "object",
            properties: {
              password: { type: "string", secret: true },
            },
          },
          description: "Only nested property is secret",
        },
        NUMBER_SECRET: {
          type: "number",
          secret: true,
          description: "Secret with number type",
        },
        OBJECT_SCHEMA_SECRET: {
          schema: { type: "object" },
          secret: true,
          description: "Secret with object schema type",
        },
        "API_*": {
          type: "string",
          secret: true,
          description: "Dynamic secret template",
        },
      },
      actions: {},
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  });

  afterEach(() => {
    for (const dir of [tempDir, tempHome]) {
      if (dir) {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  });

  it("选项互斥：--browser 与位置值互斥，报参数错误并以退出码 2 退出", async () => {
    const res = await runCliAsync(
      ["config", "set", "GITHUB_TOKEN", "my-token-val", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(res.exitCode, 2);
    assert.ok(res.stderr.toString().includes("mutually exclusive"));
  });

  it("选项互斥：--browser 与 --stdin 互斥，报参数错误并以退出码 2 退出", async () => {
    const res = await runCliAsync(
      ["config", "set", "GITHUB_TOKEN", "--stdin", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(res.exitCode, 2);
    assert.ok(res.stderr.toString().includes("mutually exclusive"));
  });

  it("选项互斥：--browser 与 --stdin-field 互斥，报参数错误并以退出码 2 退出", async () => {
    const res = await runCliAsync(
      ["config", "set", "GITHUB_TOKEN", "--stdin-field", "tok", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(res.exitCode, 2);
    assert.ok(res.stderr.toString().includes("mutually exclusive"));
  });

  it("选项互斥：--browser 与 '--' 后结构化输入（含显式空 '--'）互斥", async () => {
    const res1 = await runCliAsync(
      ["config", "set", "GITHUB_TOKEN", "--browser", "--", "key=val"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(res1.exitCode, 2);
    assert.ok(res1.stderr.toString().includes("mutually exclusive"));

    const res2 = await runCliAsync(
      ["config", "set", "GITHUB_TOKEN", "--browser", "--"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(res2.exitCode, 2);
    assert.ok(res2.stderr.toString().includes("mutually exclusive"));
  });

  it("端到端成功：--browser 支持 --global 录入敏感配置，落库全局 SQLite 且页面展示全局提示", async () => {
    const rawSecret = "  global-secret-raw-string-123!@#  ";
    const runner = createInjectableConfigRunner(tempHome, rawSecret);

    const res = await runner.execute(
      ["set", "GITHUB_TOKEN", "--global", "--browser"],
      tempDir
    );

    assert.strictEqual(res.exitCode, 0);
    assert.ok(res.stdout.includes("[OK] Configuration 'GITHUB_TOKEN' updated for global scope"));
    assert.ok(res.stderr.includes("Open the following URL in your browser"));
    assert.ok(res.pageHtml.includes("保存范围："));
    assert.ok(res.pageHtml.includes("全局配置（可能影响多个包，同名包级配置优先）"));
    assert.ok(res.pageHtml.includes("GITHUB_TOKEN"));

    // 查验全局数据库 global.db
    const globalDbPath = join(tempHome, ".actiondock", "global.db");
    const db = new DatabaseSync(globalDbPath);
    const row = db
      .prepare("SELECT value_json FROM config WHERE package_id = ? AND key = ?")
      .get("__global__", "GITHUB_TOKEN") as { value_json: string };
    assertEncryptedSecret(row.value_json, "__global__", "GITHUB_TOKEN", tempHome, rawSecret, globalDbPath);
    db.close();

    // 查验包库未被写入该敏感值
    const pkgDbPath = join(tempHome, ".actiondock", "data", "test.browser.pkg", "runtime.db");
    if (existsSync(pkgDbPath)) {
      const pkgDb = new DatabaseSync(pkgDbPath);
      const pkgRow = pkgDb
        .prepare("SELECT value_json FROM config WHERE package_id = ? AND key = ?")
        .get("test.browser.pkg", "GITHUB_TOKEN");
      assert.strictEqual(pkgRow, undefined);
      pkgDb.close();
    }

    // 安全读取全局配置仍严格脱敏
    const getRes = await runCliAsync(
      ["config", "get", "GITHUB_TOKEN", "--global", "--json"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(getRes.exitCode, 0);
    const parsed = JSON.parse(getRes.stdout.toString());
    assert.strictEqual(parsed.configured, true);
    assert.strictEqual(parsed.secret, true);
    assert.strictEqual(parsed.source, "global");
    assert.deepStrictEqual(parsed.redactedPaths, [""]);

    // 包级已有值优先级高于全局
    await runCliAsync(
      ["config", "set", "GITHUB_TOKEN", "-P", "test.browser.pkg", "package-local-token"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    const pkgGetRes = await runCliAsync(
      ["config", "get", "GITHUB_TOKEN", "--json"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(pkgGetRes.exitCode, 0);
    const pkgParsed = JSON.parse(pkgGetRes.stdout.toString());
    assert.strictEqual(pkgParsed.source, "package");

    // 全局库中的原值保持不变
    const db2 = new DatabaseSync(globalDbPath);
    const row2 = db2
      .prepare("SELECT value_json FROM config WHERE package_id = ? AND key = ?")
      .get("__global__", "GITHUB_TOKEN") as { value_json: string };
    assertEncryptedSecret(row2.value_json, "__global__", "GITHUB_TOKEN", tempHome, rawSecret, globalDbPath);
    db2.close();
  });

  it("声明资格：--global 下无匹配声明、无顶层 secret、非字符串均在启动页面前拒绝", async () => {
    // 1. 无匹配声明
    const resNoDecl = await runCliAsync(
      ["config", "set", "COMPLETELY_UNKNOWN_KEY", "--global", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(resNoDecl.exitCode, 2);
    assert.ok(resNoDecl.stderr.toString().includes("not declared as a secret in any loaded package"));

    // 2. 存在声明但不是 secret
    const resPublic = await runCliAsync(
      ["config", "set", "PUBLIC_CONFIG", "--global", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(resPublic.exitCode, 2);
    assert.ok(resPublic.stderr.toString().includes("not declared as a secret in any loaded package"));

    // 3. 仅嵌套字段 secret（顶层不是 secret）
    const resNested = await runCliAsync(
      ["config", "set", "NESTED_ONLY_SECRET", "--global", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(resNested.exitCode, 2);
    assert.ok(resNested.stderr.toString().includes("not declared as a secret in any loaded package"));

    // 4. 顶层 secret 但类型为 number
    const resNumber = await runCliAsync(
      ["config", "set", "NUMBER_SECRET", "--global", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(resNumber.exitCode, 2);
    assert.ok(resNumber.stderr.toString().includes("declared as a non-string type in loaded package(s)"));

    // 5. 顶层 secret 但 schema.type 为 object
    const resObject = await runCliAsync(
      ["config", "set", "OBJECT_SCHEMA_SECRET", "--global", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(resObject.exitCode, 2);
    assert.ok(resObject.stderr.toString().includes("declared as a non-string type in loaded package(s)"));
  });

  it("声明资格：--global 下多个包同键声明类型冲突时拒绝，顶层 secret 标记可合并 (union)", async () => {
    // 创建并链接第二个包
    const pkg2Dir = mkdtempSync(join(tmpdir(), "actiondock-pkg2-"));
    try {
      initProject(pkg2Dir, { id: "test.pkg2", name: "test-pkg2" });
      const pkg2ManifestPath = join(pkg2Dir, "actiondock.json");
      writeFileSync(
        pkg2ManifestPath,
        JSON.stringify(
          {
            id: "test.pkg2",
            name: "test-pkg2",
            version: "1.0.0",
            config: {
              // 与包 1 的 GITHUB_TOKEN 同名但声明为 number，构成跨包类型冲突
              GITHUB_TOKEN: {
                type: "number",
              },
              // 与包 1 的 UNION_KEY 同名：包 2 声明普通 string（无 secret），包 1 声明 string 且 secret: true
              UNION_KEY: {
                type: "string",
              },
            },
            actions: {},
          },
          null,
          2
        ),
        "utf-8"
      );

      // 在包 1 中补充 UNION_KEY 声明
      const pkg1ManifestPath = join(tempDir, "actiondock.json");
      const pkg1Manifest = JSON.parse(readFileSync(pkg1ManifestPath, "utf-8"));
      pkg1Manifest.config.UNION_KEY = {
        type: "string",
        secret: true,
      };
      writeFileSync(pkg1ManifestPath, JSON.stringify(pkg1Manifest, null, 2), "utf-8");

      await linkPackage(pkg2Dir, tempHome);

      // 验证跨包类型冲突（包 1 string vs 包 2 number）：启动页面前拒绝
      const resConflict = await runCliAsync(
        ["config", "set", "GITHUB_TOKEN", "--global", "--browser"],
        tempDir,
        { ACTIONDOCK_HOME: tempHome }
      );
      assert.strictEqual(resConflict.exitCode, 2);
      assert.ok(resConflict.stderr.toString().includes("declared as a non-string type in loaded package(s)"));

      // 包级录入只参考目标包，不受其他已加载包同名声明的类型冲突影响。
      const packageRunner = createInjectableConfigRunner(tempHome, "package-only-token");
      const packageResult = await packageRunner.execute(
        ["set", "GITHUB_TOKEN", "-P", "test.browser.pkg", "--browser"],
        tempDir
      );
      assert.strictEqual(packageResult.exitCode, 0);
      assert.ok(packageResult.pageHtml.includes("包：test.browser.pkg"));
      assert.ok(packageResult.stdout.includes("updated for package 'test.browser.pkg'"));

      // 验证跨包敏感标记合并（包 1 secret: true + 包 2 secret 未声明，且两包均为 string）：允许录入
      const rawSecret = "union-token-val";
      const runner = createInjectableConfigRunner(tempHome, rawSecret);
      const resUnion = await runner.execute(
        ["set", "UNION_KEY", "--global", "--browser"],
        tempDir
      );
      assert.strictEqual(resUnion.exitCode, 0);
      assert.ok(resUnion.stdout.includes("[OK] Configuration 'UNION_KEY' updated for global scope"));

      const globalDbPath = join(tempHome, ".actiondock", "global.db");
      const db = new DatabaseSync(globalDbPath);
      const row = db
        .prepare("SELECT value_json FROM config WHERE package_id = ? AND key = ?")
        .get("__global__", "UNION_KEY") as { value_json: string };
      assertEncryptedSecret(row.value_json, "__global__", "UNION_KEY", tempHome, rawSecret, globalDbPath);
      db.close();
    } finally {
      rmSync(pkg2Dir, { recursive: true, force: true });
    }
  });

  it("声明资格：--global 匹配动态模板声明 (API_*) 可成功录入", async () => {
    const rawSecret = "global-openai-api-key";
    const runner = createInjectableConfigRunner(tempHome, rawSecret);

    const res = await runner.execute(
      ["set", "API_OPENAI_TOKEN", "--global", "--browser"],
      tempDir
    );
    assert.strictEqual(res.exitCode, 0);
    assert.ok(res.stdout.includes("[OK] Configuration 'API_OPENAI_TOKEN' updated for global scope"));

    const globalDbPath = join(tempHome, ".actiondock", "global.db");
    const db = new DatabaseSync(globalDbPath);
    const row = db
      .prepare("SELECT value_json FROM config WHERE package_id = ? AND key = ?")
      .get("__global__", "API_OPENAI_TOKEN") as { value_json: string };
    assertEncryptedSecret(row.value_json, "__global__", "API_OPENAI_TOKEN", tempHome, rawSecret, globalDbPath);
    db.close();
  });

  it("目标限制：--browser 拒绝显式远端目标 (--server / --profile)，含 --global 组合", async () => {
    const resServerPkg = await runCliAsync(
      ["config", "set", "GITHUB_TOKEN", "--server", "http://127.0.0.1:8080", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(resServerPkg.exitCode, 2);
    assert.ok(resServerPkg.stderr.toString().includes("only supported for local targets"));

    const resServerGlobal = await runCliAsync(
      ["config", "set", "GITHUB_TOKEN", "--global", "--server", "http://127.0.0.1:8080", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(resServerGlobal.exitCode, 2);
    assert.ok(resServerGlobal.stderr.toString().includes("only supported for local targets"));

    const resProfilePkg = await runCliAsync(
      ["config", "set", "GITHUB_TOKEN", "--profile", "remote-dev", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(resProfilePkg.exitCode, 2);
    assert.ok(resProfilePkg.stderr.toString().includes("only supported for local targets"));

    const resProfileGlobal = await runCliAsync(
      ["config", "set", "GITHUB_TOKEN", "--global", "--profile", "remote-dev", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(resProfileGlobal.exitCode, 2);
    assert.ok(resProfileGlobal.stderr.toString().includes("only supported for local targets"));
  });

  it("目标限制：--browser 拒绝默认激活 Profile 造成的隐式远端目标", async () => {
    const profilesDir = join(tempHome, ".actiondock");
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(
      join(profilesDir, "profiles.json"),
      JSON.stringify(
        {
          currentProfile: "default-remote",
          profiles: {
            "default-remote": {
              serverUrl: "http://127.0.0.1:9099",
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    const resPkg = await runCliAsync(
      ["config", "set", "GITHUB_TOKEN", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(resPkg.exitCode, 2);
    assert.ok(resPkg.stderr.toString().includes("only supported for local targets"));

    const resGlobal = await runCliAsync(
      ["config", "set", "GITHUB_TOKEN", "--global", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(resGlobal.exitCode, 2);
    assert.ok(resGlobal.stderr.toString().includes("only supported for local targets"));
  });

  it("选项互斥：--global 下 --browser 与位置值、--stdin 等互斥在读流前以退出码 2 退出", async () => {
    const res1 = await runCliAsync(
      ["config", "set", "GITHUB_TOKEN", "raw-val", "--global", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(res1.exitCode, 2);
    assert.ok(res1.stderr.toString().includes("mutually exclusive"));

    const res2 = await runCliAsync(
      ["config", "set", "GITHUB_TOKEN", "--stdin", "--global", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(res2.exitCode, 2);
    assert.ok(res2.stderr.toString().includes("mutually exclusive"));

    const res3 = await runCliAsync(
      ["config", "set", "GITHUB_TOKEN", "--global", "--browser", "--", "key=val"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(res3.exitCode, 2);
    assert.ok(res3.stderr.toString().includes("mutually exclusive"));
  });

  it("无项目目录场景：全局链接包提供合格声明时成功，无声明时报资格错误而非 Not in project", async () => {
    const linkedPkgDir = mkdtempSync(join(tmpdir(), "actiondock-linked-"));
    const emptyDir = mkdtempSync(join(tmpdir(), "actiondock-outside-"));
    try {
      initProject(linkedPkgDir, { id: "test.linked", name: "test-linked" });
      const manifestPath = join(linkedPkgDir, "actiondock.json");
      writeFileSync(
        manifestPath,
        JSON.stringify(
          {
            id: "test.linked",
            name: "test-linked",
            version: "1.0.0",
            config: {
              LINKED_SECRET: {
                type: "string",
                secret: true,
              },
            },
            actions: {},
          },
          null,
          2
        ),
        "utf-8"
      );

      await linkPackage(linkedPkgDir, tempHome);

      // 1. 在无项目目录执行 --global --browser：命中已链接包合格声明，成功录入
      const rawSecret = "linked-package-secret-val";
      const runner = createInjectableConfigRunner(tempHome, rawSecret);
      const resOk = await runner.execute(
        ["set", "LINKED_SECRET", "--global", "--browser"],
        emptyDir
      );
      assert.strictEqual(resOk.exitCode, 0);
      assert.ok(resOk.stdout.includes("[OK] Configuration 'LINKED_SECRET' updated for global scope"));

      const globalDbPath = join(tempHome, ".actiondock", "global.db");
      const db = new DatabaseSync(globalDbPath);
      const row = db
        .prepare("SELECT value_json FROM config WHERE package_id = ? AND key = ?")
        .get("__global__", "LINKED_SECRET") as { value_json: string };
      assertEncryptedSecret(row.value_json, "__global__", "LINKED_SECRET", tempHome, rawSecret, globalDbPath);
      db.close();

      // 2. 在无项目目录执行未声明配置：报资格错误，绝不报 Not in project
      const resUnknown = await runCliAsync(
        ["config", "set", "UNREGISTERED_SECRET", "--global", "--browser"],
        emptyDir,
        { ACTIONDOCK_HOME: tempHome }
      );
      assert.strictEqual(resUnknown.exitCode, 2);
      assert.ok(resUnknown.stderr.toString().includes("not declared as a secret in any loaded package"));
      assert.ok(!resUnknown.stderr.toString().includes("Not in an ActionDock project"));

      // 3. 不带 --global 时在无项目目录执行：明确报 Not in project
      const resNoGlobal = await runCliAsync(
        ["config", "set", "LINKED_SECRET", "--browser"],
        emptyDir,
        { ACTIONDOCK_HOME: tempHome }
      );
      assert.strictEqual(resNoGlobal.exitCode, 2);
      assert.ok(resNoGlobal.stderr.toString().includes("Not in an ActionDock project"));
    } finally {
      rmSync(linkedPkgDir, { recursive: true, force: true });
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("目标限制：找不到包 (-P 不存在) 明确报错，绝不退回 global", async () => {
    const res = await runCliAsync(
      ["config", "set", "GITHUB_TOKEN", "-P", "non-existent-package", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(res.exitCode, 2);
    assert.ok(res.stderr.toString().includes("non-existent-package"));
  });

  it("目标限制：非工程目录且未指定 -P 时明确报错，绝不退回 global", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "actiondock-empty-"));
    try {
      const res = await runCliAsync(
        ["config", "set", "GITHUB_TOKEN", "--browser"],
        emptyDir,
        { ACTIONDOCK_HOME: tempHome }
      );
      assert.strictEqual(res.exitCode, 2);
      assert.ok(res.stderr.toString().toLowerCase().includes("not in an actiondock project"));
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("声明校验：未声明配置被拒绝，退出码 2", async () => {
    const res = await runCliAsync(
      ["config", "set", "UNDECLARED_KEY", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(res.exitCode, 2);
    assert.ok(res.stderr.toString().includes("not declared as a secret"));
  });

  it("声明校验：已声明但 secret: false 配置被拒绝，退出码 2", async () => {
    const res = await runCliAsync(
      ["config", "set", "PUBLIC_CONFIG", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(res.exitCode, 2);
    assert.ok(res.stderr.toString().includes("not declared as a secret"));
  });

  it("声明校验：仅嵌套字段 secret 的对象配置被拒绝，退出码 2", async () => {
    const res = await runCliAsync(
      ["config", "set", "NESTED_ONLY_SECRET", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(res.exitCode, 2);
    assert.ok(res.stderr.toString().includes("not declared as a secret"));
  });

  it("声明校验：非字符串类型声明 (type: number) 被拒绝，退出码 2", async () => {
    const res = await runCliAsync(
      ["config", "set", "NUMBER_SECRET", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(res.exitCode, 2);
    assert.ok(res.stderr.toString().includes("declared as a non-string type"));
  });

  it("声明校验：非字符串模式声明 (schema.type: object) 被拒绝，退出码 2", async () => {
    const res = await runCliAsync(
      ["config", "set", "OBJECT_SCHEMA_SECRET", "--browser"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(res.exitCode, 2);
    assert.ok(res.stderr.toString().includes("declared as a non-string type"));
  });

  it("端到端成功：GITHUB_TOKEN 成功通过浏览器录入并完整保留原始字符串", async () => {
    const rawSecret = "  my-secret-pat-12345!@#  ";
    const runner = createInjectableConfigRunner(tempHome, rawSecret);

    const res = await runner.execute(
      ["set", "GITHUB_TOKEN", "-P", "test.browser.pkg", "--browser"],
      tempDir
    );

    assert.strictEqual(res.exitCode, 0);
    assert.ok(res.stdout.includes("[OK] Configuration 'GITHUB_TOKEN' updated for package 'test.browser.pkg'"));
    assert.ok(res.stderr.includes("Open the following URL in your browser"));
    assert.ok(res.stderr.includes("http://127.0.0.1:"));

    // 验证配置已成功保存至持久化存储，且读取视图为安全脱敏
    const getRes = await runCliAsync(
      ["config", "get", "GITHUB_TOKEN", "--json"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(getRes.exitCode, 0);
    const parsed = JSON.parse(getRes.stdout.toString());
    assert.strictEqual(parsed.configured, true);
    assert.strictEqual(parsed.secret, true);
    assert.deepStrictEqual(parsed.redactedPaths, [""]);

    // 直接查验底层 SQLite 确切落库了原始敏感字符串（未截断、未 trim、未 json decode）
    const dbPath = join(tempHome, ".actiondock", "data", "test.browser.pkg", "runtime.db");
    const db = new DatabaseSync(dbPath);
    const row = db.prepare("SELECT value_json FROM config WHERE package_id = ? AND key = ?").get("test.browser.pkg", "GITHUB_TOKEN") as { value_json: string };
    assertEncryptedSecret(row.value_json, "test.browser.pkg", "GITHUB_TOKEN", tempHome, rawSecret);
    db.close();
  });

  it("端到端成功：无显式 type/schema.type 的顶层 secret 项允许按字符串录入", async () => {
    const rawSecret = "untyped-raw-token";
    const runner = createInjectableConfigRunner(tempHome, rawSecret);

    const res = await runner.execute(
      ["set", "UNTYPED_SECRET", "--browser"],
      tempDir
    );
    assert.strictEqual(res.exitCode, 0);
    assert.ok(res.stdout.includes("UNTYPED_SECRET"));
  });

  it("端到端成功：schema.type 为 string 的配置项允许录入", async () => {
    const rawSecret = "schema-string-val";
    const runner = createInjectableConfigRunner(tempHome, rawSecret);

    const res = await runner.execute(
      ["set", "SCHEMA_STRING_SECRET", "--browser"],
      tempDir
    );
    assert.strictEqual(res.exitCode, 0);
    assert.ok(res.stdout.includes("SCHEMA_STRING_SECRET"));
  });

  it("端到端成功：动态模板声明 (API_*) 的合法具体键命中并允许输入", async () => {
    const rawSecret = "api-key-for-service";
    const runner = createInjectableConfigRunner(tempHome, rawSecret);

    const res = await runner.execute(
      ["set", "API_WEATHER_KEY", "--browser"],
      tempDir
    );
    assert.strictEqual(res.exitCode, 0);
    assert.ok(res.stdout.includes("API_WEATHER_KEY"));
  });

  it("原有非 browser 配置写入行为不回归", async () => {
    const resLiteral = await runCliAsync(
      ["config", "set", "PUBLIC_CONFIG", "my-public-val"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(resLiteral.exitCode, 0);

    const getRes = await runCliAsync(
      ["config", "get", "PUBLIC_CONFIG", "--json"],
      tempDir,
      { ACTIONDOCK_HOME: tempHome }
    );
    assert.strictEqual(getRes.exitCode, 0);
    assert.strictEqual(JSON.parse(getRes.stdout.toString()).value, "my-public-val");
  });
});
