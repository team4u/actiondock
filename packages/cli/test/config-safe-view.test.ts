import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { initProject } from "@actiondock/core";
import { runCliAsync } from "./helpers/run-cli";

describe("CLI Config Safe View & Template Management", () => {
  let tempDir: string;
  let tempHome: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-cli-safe-"));
    tempHome = mkdtempSync(join(tmpdir(), "ad-cli-safe-home-"));
    process.env.ACTIONDOCK_HOME = tempHome;

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
    }

    initProject(tempDir, { id: "test.safe-view", name: "Safe View Test" });

    // 配置多种类型的配置声明：
    // 1. TOP_SECRET: 顶层 secret
    // 2. DB_CONFIG: 嵌套 schema 包含 secret 字段 password
    // 3. SECRET_WITH_DEFAULT: 顶层 secret 且带默认值（默认值严禁泄露）
    // 4. NORMAL_WITH_DEFAULT: 普通配置项带默认值
    // 5. UNSET_CONFIG: 普通必填项未配置
    // 6. "provider.*.apiKey": 通配模板项
    const manifestPath = join(tempDir, "actiondock.json");
    const manifest = {
      $schema: "https://actiondock.dev/schema/v2.json",
      schemaVersion: 2,
      id: "test.safe-view",
      name: "Safe View Test",
      version: "0.1.0",
      description: "Test safe config view",
      config: {
        TOP_SECRET: {
          description: "Top level sensitive secret",
          secret: true,
        },
        DB_CONFIG: {
          description: "Database connection parameters",
          schema: {
            type: "object",
            properties: {
              host: { type: "string" },
              port: { type: "integer" },
              password: { type: "string", secret: true },
            },
            required: ["host"],
          },
        },
        SECRET_WITH_DEFAULT: {
          description: "Secret item with default",
          secret: true,
          default: "super_secret_default_val",
        },
        NORMAL_WITH_DEFAULT: {
          description: "Normal item with default",
          default: "safe_default_value",
        },
        UNSET_CONFIG: {
          description: "Unset required config",
          required: true,
        },
        "provider.*.apiKey": {
          description: "Dynamic provider API key template",
          secret: true,
        },
      },
      actions: {
        "sample.greet": {
          entry: "actions/greet.ts",
          description: "Sample",
        },
      },
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  });

  afterEach(async () => {
    delete process.env.ACTIONDOCK_HOME;
    if (existsSync(tempHome)) {
      try {
        rmSync(tempHome, { recursive: true, force: true, maxRetries: 5 });
      } catch {}
    }
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true, maxRetries: 5 });
      } catch {}
    }
  });

  it("已配置整项隐藏显示 <hidden> 而非空白，未配置项显示 <not configured>", async () => {
    // 写入 TOP_SECRET
    await runCliAsync(["config", "set", "TOP_SECRET", "my_top_secret_pwd"], tempDir);

    // 人类可读文本查询 TOP_SECRET
    const getSecretRes = await runCliAsync(["config", "get", "TOP_SECRET"], tempDir);
    assert.strictEqual(getSecretRes.exitCode, 0);
    assert.strictEqual(getSecretRes.stdout.toString().trim(), "<hidden>");

    // 人类可读文本查询未配置的 UNSET_CONFIG
    const getUnsetRes = await runCliAsync(["config", "get", "UNSET_CONFIG"], tempDir);
    assert.strictEqual(getUnsetRes.exitCode, 0);
    assert.strictEqual(getUnsetRes.stdout.toString().trim(), "<not configured>");

    // 含有 secret 默认值的项，未配置时由于根路径被遮蔽，显示为 <hidden>
    const getSecretDefaultRes = await runCliAsync(["config", "get", "SECRET_WITH_DEFAULT"], tempDir);
    assert.strictEqual(getSecretDefaultRes.exitCode, 0);
    assert.strictEqual(getSecretDefaultRes.stdout.toString().trim(), "<hidden>");

    // 含有普通默认值的项，显示默认值
    const getNormalDefaultRes = await runCliAsync(["config", "get", "NORMAL_WITH_DEFAULT"], tempDir);
    assert.strictEqual(getNormalDefaultRes.exitCode, 0);
    assert.strictEqual(getNormalDefaultRes.stdout.toString().trim(), "safe_default_value");
  });

  it("字段对象配置可见 host 但隐藏 password，输出为 JSON 而非 [object Object]", async () => {
    // 写入包含敏感字段的对象
    await runCliAsync(
      [
        "config",
        "set",
        "DB_CONFIG",
        '{"host":"db.internal.net","port":5432,"password":"secret_db_pass"}',
      ],
      tempDir
    );

    const getRes = await runCliAsync(["config", "get", "DB_CONFIG"], tempDir);
    assert.strictEqual(getRes.exitCode, 0);
    const textOut = getRes.stdout.toString().trim();
    assert.strictEqual(textOut.includes("[object Object]"), false);
    assert.ok(textOut.includes('"host":"db.internal.net"'));
    assert.ok(textOut.includes('"password":"********"'));
    assert.strictEqual(textOut.includes("secret_db_pass"), false);

    // JSON 模式检查 safe view
    const getJsonRes = await runCliAsync(["config", "get", "DB_CONFIG", "--json"], tempDir);
    assert.strictEqual(getJsonRes.exitCode, 0);
    const jsonPayload = JSON.parse(getJsonRes.stdout.toString());
    assert.strictEqual(jsonPayload.configured, true);
    assert.deepStrictEqual(jsonPayload.redactedPaths, ["/password"]);
    assert.strictEqual(jsonPayload.value.host, "db.internal.net");
    assert.strictEqual(jsonPayload.value.password, "********");
  });

  it("--reveal 与 --show-secrets 不再是合法参数，敏感项仍严格脱敏", async () => {
    await runCliAsync(["config", "set", "TOP_SECRET", "super_secret_999"], tempDir);

    const getReveal = await runCliAsync(["config", "get", "TOP_SECRET", "--reveal"], tempDir);
    assert.notStrictEqual(getReveal.exitCode, 0, "--reveal 参数应被拒绝");

    const listReveal = await runCliAsync(["config", "list", "--show-secrets"], tempDir);
    assert.notStrictEqual(listReveal.exitCode, 0, "--show-secrets 参数应被拒绝");

    const getSecret = await runCliAsync(["config", "get", "TOP_SECRET"], tempDir);
    assert.strictEqual(getSecret.exitCode, 0);
    assert.strictEqual(getSecret.stdout.toString().trim(), "<hidden>");
    assert.strictEqual(getSecret.stdout.toString().includes("super_secret_999"), false);
  });

  it("config schema 针对模板单独展示 TEMPLATE 状态及 matchCount，且不参与 missing 统计与 default 不泄漏", async () => {
    // 写入一个匹配模板的具体键
    await runCliAsync(["config", "set", "provider.anthropic.apiKey", "sk-ant-test-123"], tempDir);

    const schemaRes = await runCliAsync(["config", "schema", "--json"], tempDir);
    const schemaData = JSON.parse(schemaRes.stdout.toString());

    // 检查模板项：source null，模板语义由 status TEMPLATE 表达
    const tmplItem = schemaData.configs.find((c: any) => c.key === "provider.*.apiKey");
    assert.ok(tmplItem);
    assert.strictEqual(tmplItem.status, "TEMPLATE");
    assert.strictEqual(tmplItem.matchCount, 1);
    assert.strictEqual(tmplItem.source, null);

    // 检查带敏感默认值的项：defaultValue 不得泄露
    const secretDefItem = schemaData.configs.find((c: any) => c.key === "SECRET_WITH_DEFAULT");
    assert.ok(secretDefItem);
    assert.strictEqual(secretDefItem.status, "DEFAULT");
    assert.strictEqual(secretDefItem.defaultValue, undefined);

    // 检查普通带默认值的项
    const normalDefItem = schemaData.configs.find((c: any) => c.key === "NORMAL_WITH_DEFAULT");
    assert.strictEqual(normalDefItem.status, "DEFAULT");
    assert.strictEqual(normalDefItem.defaultValue, "safe_default_value");

    // missingCount 只统计未配置的必填项 UNSET_CONFIG（模板不参与）
    assert.strictEqual(schemaData.missingCount, 1);
    const missingRequiredKeys = schemaData.configs
      .filter((c: any) => c.required && c.status === "MISSING")
      .map((c: any) => c.key);
    assert.deepStrictEqual(missingRequiredKeys, ["UNSET_CONFIG"]);

    // 人类格式检查 renderConfigSchema：MATCHES 列单列呈现模板数量，SOURCE 列不再冒充来源
    const schemaHuman = await runCliAsync(["config", "schema"], tempDir);
    const humanText = schemaHuman.stdout.toString();
    assert.ok(humanText.includes("[TEMPLATE]"));
    assert.ok(humanText.includes("MATCHES"));
    assert.strictEqual(humanText.includes("matches"), false);

    // 缺失项 source null
    const missingItem = schemaData.configs.find((c: any) => c.key === "UNSET_CONFIG");
    assert.strictEqual(missingItem.status, "MISSING");
    assert.strictEqual(missingItem.source, null);
  });

  it("config env 跳过模板且识别嵌套 schema secret", async () => {
    const envRes = await runCliAsync(["config", "env", "--json"], tempDir);
    const envData = JSON.parse(envRes.stdout.toString());

    // 模板项不计入 envChecks
    const hasTemplate = envData.envChecks.some((c: any) => c.key.includes("*"));
    assert.strictEqual(hasTemplate, false);

    // 嵌套 secret (DB_CONFIG) 正确识别为 secret: true
    const dbCheck = envData.envChecks.find((c: any) => c.key === "DB_CONFIG");
    assert.ok(dbCheck);
    assert.strictEqual(dbCheck.secret, true);
  });

  it("config get / set / delete 拒绝通配符模板键", async () => {
    const getTmpl = await runCliAsync(["config", "get", "provider.*.apiKey"], tempDir);
    assert.strictEqual(getTmpl.exitCode, 2);
    assert.ok(getTmpl.stderr.toString().includes("Concrete configuration key expected"));

    const setTmpl = await runCliAsync(["config", "set", "provider.*.apiKey", "test"], tempDir);
    assert.strictEqual(setTmpl.exitCode, 2);
    assert.ok(setTmpl.stderr.toString().includes("Concrete configuration key expected"));

    const delTmpl = await runCliAsync(["config", "delete", "provider.*.apiKey"], tempDir);
    assert.strictEqual(delTmpl.exitCode, 2);
    assert.ok(delTmpl.stderr.toString().includes("Concrete configuration key expected"));
  });

  it("config list 排除模板通配键，但展示匹配模板的具体存储键", async () => {
    await runCliAsync(["config", "set", "provider.gemini.apiKey", "test_gemini_val"], tempDir);

    const listRes = await runCliAsync(["config", "list", "--json"], tempDir);
    assert.strictEqual(listRes.exitCode, 0);
    const listData = JSON.parse(listRes.stdout.toString());

    // 模板本身不出现在 list 中
    assert.strictEqual(listData.some((c: any) => c.key === "provider.*.apiKey"), false);

    // 具体键出现在 list 中，且标记为 secret
    const geminiItem = listData.find((c: any) => c.key === "provider.gemini.apiKey");
    assert.ok(geminiItem);
    assert.strictEqual(geminiItem.secret, true);
  });

  it("CONFIG_VALUE_INVALID 错误被合理转换为参数错误（退出码 2）", async () => {
    const { formatError } = await import("../src/errors");
    const { ActionDockError } = await import("@actiondock/core");

    const err = new ActionDockError(
      "CONFIG_VALUE_INVALID",
      "Configuration value for 'DB_CONFIG' failed schema validation",
      { key: "DB_CONFIG" }
    );
    const formatted = formatError(err);
    assert.strictEqual(formatted.code, "CONFIG_VALUE_INVALID");
    assert.strictEqual(formatted.exitCode, 2);
  });

  it("远端旧协议响应被拒绝，新协议按包标识应用本地声明且不误选默认包", async (t) => {
    const { fetchRemoteConfigSafe } = await import("../src/commands/config/remote-helper");
    let responsePackage = "test.safe-view";
    let legacyMode = false;
    const requests: URL[] = [];
    const server = createServer((req, res) => {
      const requestUrl = new URL(req.url!, "http://localhost");
      requests.push(requestUrl);
      res.setHeader("content-type", "application/json");
      if (legacyMode) {
        // 旧服务端：无 configViewVersion 与 items 元数据，必须被客户端拒绝。
        res.end(JSON.stringify({
          packageId: responsePackage,
          values: { DB_CONFIG: { host: "remote-host", password: "legacy-raw-password" } },
        }));
        return;
      }
      // 单键查询模拟真实服务端契约：返回 item 结构，未命中项 source null。
      const queryKey = requestUrl.searchParams.get("key");
      if (queryKey !== null) {
        res.end(JSON.stringify({
          packageId: responsePackage,
          configViewVersion: 1,
          declared: {},
          item: queryKey === "DB_CONFIG"
            ? {
                key: "DB_CONFIG",
                source: "package",
                configured: true,
                secret: true,
                value: { host: "remote-host", password: "********" },
                redactedPaths: ["/password"],
              }
            : { key: queryKey, source: null, configured: false, secret: false, value: undefined, redactedPaths: [] },
        }));
        return;
      }
      res.end(JSON.stringify({
        packageId: responsePackage,
        configViewVersion: 1,
        declared: {},
        items: [{
          key: "DB_CONFIG",
          source: "package",
          configured: true,
          secret: true,
          value: { host: "remote-host", password: "********" },
          redactedPaths: ["/password"],
        }],
      }));
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    t.after(() => new Promise<void>((done, reject) => server.close((err) => err ? reject(err) : done())));
    const target = { serverUrl: `http://127.0.0.1:${(server.address() as any).port}` };
    const previous = process.cwd();
    try {
      process.chdir(tempDir);
      const safe = await fetchRemoteConfigSafe(target, { package: tempDir });
      assert.equal(requests[0].searchParams.get("package"), "test.safe-view");
      const dbItem = safe.items.find((item) => item.key === "DB_CONFIG")!;
      assert.deepEqual(dbItem.value, { host: "remote-host", password: "********" });
      assert.equal(dbItem.source, "package");
      assert.equal(JSON.stringify(safe).includes("legacy-raw-password"), false);

      // 新协议下无匹配项的单键查询返回 source null 的未命中视图，不伪造 remote/default。
      const single = await fetchRemoteConfigSafe(target, { package: tempDir, key: "MISSING_KEY" });
      assert.equal(single.items.length, 1);
      assert.equal(single.items[0].source, null);
      assert.equal(single.items[0].configured, false);
      assert.equal(single.items[0].value, undefined);

      responsePackage = "unrelated.package";
      const unrelated = await fetchRemoteConfigSafe(target, {});
      assert.equal(requests[2].searchParams.has("package"), false);
      // 包标识不匹配时本地声明不应用，服务端已脱敏视图按原样保留，来源不丢失。
      const unrelatedItem = unrelated.items.find((item) => item.key === "DB_CONFIG")!;
      assert.deepEqual(unrelatedItem.value, { host: "remote-host", password: "********" });
      assert.equal(unrelatedItem.source, "package");
      assert.equal(JSON.stringify(unrelated).includes("legacy-raw-password"), false);

      // 旧协议响应：明确拒绝，不猜测来源，不降级为安全列表。
      legacyMode = true;
      responsePackage = "test.safe-view";
      const requestsBeforeLegacy = requests.length;
      await assert.rejects(
        fetchRemoteConfigSafe(target, { package: tempDir }),
        (err: any) => err.code === "PROTOCOL_UNSUPPORTED"
      );
      assert.equal(requests.length, requestsBeforeLegacy + 1, "旧协议拒绝前不应发出额外回退请求");

      // 清单损坏时不得降级发出不受保护的请求。
      writeFileSync(join(tempDir, "actiondock.json"), "{invalid-json");
      await assert.rejects(fetchRemoteConfigSafe(target, { package: tempDir }));
      assert.equal(requests.length, requestsBeforeLegacy + 1, "清单损坏时不得降级发出不受保护的请求");
    } finally {
      process.chdir(previous);
    }
  });
});
