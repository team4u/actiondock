import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "@actiondock/core";
import { parseConfigOverrideAssignment, parseStandaloneArgs } from "../../../packages/core/src/runtime/standalone-help";
import { runCliAsync } from "./helpers/run-cli";

describe("CLI Temporary Config Overrides (-c / --config)", () => {
  let tempDir: string;
  let tempHome: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-cli-ovr-"));
    tempHome = mkdtempSync(join(tmpdir(), "ad-cli-ovr-home-"));
    process.env.ACTIONDOCK_HOME = tempHome;

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
    }

    initProject(tempDir, { id: "test.overrides", name: "Overrides Test" });

    // 重写 actions/greet.ts 用于反射读取任意配置项，同时满足清单默认 outputSchema
    const actionPath = join(tempDir, "actions", "greet.ts");
    const actionCode = `
import { defineAction } from "@actiondock/sdk";

export default defineAction(async (input: { name: string }, ctx) => {
  const val = ctx.config.get(input.name);
  return {
    message: typeof val === "string" ? val : JSON.stringify(val),
    timesGreeted: 1,
    key: input.name,
    value: val,
    type: typeof val,
  };
});
`;
    writeFileSync(actionPath, actionCode, "utf8");
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

  it("KEY=value 保持原始字符串类型", async () => {
    const res = await runCliAsync(
      [
        "run",
        "sample.greet",
        "--input",
        '{"name":"SAMPLE_STRING"}',
        "-c",
        "SAMPLE_STRING=12345",
        "--json",
      ],
      tempDir
    );

    assert.strictEqual(res.exitCode, 0, res.stderr.toString());
    const payload = JSON.parse(res.stdout.toString());
    assert.strictEqual(payload.data.value, "12345");
    assert.strictEqual(payload.data.type, "string");
  });

  it("KEY:=json 严格解析 JSON 对象、数字、布尔值", async () => {
    const resNum = await runCliAsync(
      [
        "run",
        "sample.greet",
        "--input",
        '{"name":"SAMPLE_NUM"}',
        "-c",
        "SAMPLE_NUM:=12345",
        "--json",
      ],
      tempDir
    );
    assert.strictEqual(resNum.exitCode, 0, resNum.stderr.toString());
    const numPayload = JSON.parse(resNum.stdout.toString());
    assert.strictEqual(numPayload.data.value, 12345);
    assert.strictEqual(numPayload.data.type, "number");

    const resBool = await runCliAsync(
      [
        "run",
        "sample.greet",
        "--input",
        '{"name":"SAMPLE_BOOL"}',
        "-c",
        "SAMPLE_BOOL:=true",
        "--json",
      ],
      tempDir
    );
    assert.strictEqual(resBool.exitCode, 0, resBool.stderr.toString());
    const boolPayload = JSON.parse(resBool.stdout.toString());
    assert.strictEqual(boolPayload.data.value, true);
    assert.strictEqual(boolPayload.data.type, "boolean");

    const resObj = await runCliAsync(
      [
        "run",
        "sample.greet",
        "--input",
        '{"name":"DB_CONFIG"}',
        "-c",
        'DB_CONFIG:={"host":"127.0.0.1","port":5432}',
        "--json",
      ],
      tempDir
    );
    assert.strictEqual(resObj.exitCode, 0, resObj.stderr.toString());
    const objPayload = JSON.parse(resObj.stdout.toString());
    assert.deepStrictEqual(objPayload.data.value, { host: "127.0.0.1", port: 5432 });
  });

  it("配置名中包含点号时不转换为嵌套对象，保持字面键名", async () => {
    const res = await runCliAsync(
      [
        "run",
        "sample.greet",
        "--input",
        '{"name":"database.service.host"}',
        "-c",
        "database.service.host:=9999",
        "--json",
      ],
      tempDir
    );

    assert.strictEqual(res.exitCode, 0, res.stderr.toString());
    const payload = JSON.parse(res.stdout.toString());
    assert.strictEqual(payload.data.key, "database.service.host");
    assert.strictEqual(payload.data.value, 9999);
  });

  it("配置键按字面保留原型名称，不改变覆盖字典原型，独立入口缺值立即报错", () => {
    const parsed = parseStandaloneArgs(["--config", '__proto__:={"x":1}']);
    assert.equal(Object.getPrototypeOf(parsed.configOverrides), Object.prototype);
    assert.equal(Object.hasOwn(parsed.configOverrides, "__proto__"), true);
    assert.deepEqual(parsed.configOverrides["__proto__"], { x: 1 });
    assert.throws(() => parseStandaloneArgs(["--config"]), { code: "INVALID_ARGUMENT" });
    assert.throws(() => parseConfigOverrideAssignment('KEY:={"n":1e999}'), { code: "INVALID_ARGUMENT" });
  });

  it("重复指定同一键名时遵循 last-wins 语义", async () => {
    const res = await runCliAsync(
      [
        "run",
        "sample.greet",
        "--input",
        '{"name":"MY_KEY"}',
        "-c",
        "MY_KEY=first_str",
        "-c",
        "MY_KEY:=888",
        "--json",
      ],
      tempDir
    );

    assert.strictEqual(res.exitCode, 0, res.stderr.toString());
    const payload = JSON.parse(res.stdout.toString());
    assert.strictEqual(payload.data.value, 888);
  });

  it("KEY:=json 语法非法或非有限数时以退出码 2 报错，且不泄露敏感文本与不执行 Action", async () => {
    const sensitiveSecret = "p@ssword_SECRET_TOKEN_999";
    const resSyntax = await runCliAsync(
      [
        "run",
        "sample.greet",
        "--input",
        '{"name":"INVALID_CFG"}',
        "-c",
        `SECRET_CFG:=${sensitiveSecret}`,
      ],
      tempDir
    );

    assert.strictEqual(resSyntax.exitCode, 2);
    const stderrSyntax = resSyntax.stderr.toString();
    // 严禁包含密码原文
    assert.strictEqual(stderrSyntax.includes(sensitiveSecret), false);
    assert.ok(stderrSyntax.includes("SECRET_CFG"));

    // 非有限数 NaN 检测
    const resNan = await runCliAsync(
      [
        "run",
        "sample.greet",
        "--input",
        '{"name":"NAN_CFG"}',
        "-c",
        "NAN_CFG:=NaN",
      ],
      tempDir
    );
    assert.strictEqual(resNan.exitCode, 2);

    // 非有限数 Infinity 检测
    const resInf = await runCliAsync(
      [
        "run",
        "sample.greet",
        "--input",
        '{"name":"INF_CFG"}',
        "-c",
        "INF_CFG:=Infinity",
      ],
      tempDir
    );
    assert.strictEqual(resInf.exitCode, 2);
  });

  it("-c 指定模板通配键时被 assertConcreteConfigKey 拒绝，以参数错误 2 退出", async () => {
    const res = await runCliAsync(
      [
        "run",
        "sample.greet",
        "--input",
        '{"name":"tmpl"}',
        "-c",
        "provider.*.apiKey:=123",
      ],
      tempDir
    );

    assert.strictEqual(res.exitCode, 2);
    assert.ok(res.stderr.toString().includes("Concrete configuration key expected"));
  });

  it("独立运行解析器 standalone-help 同样支持 KEY=val 与 KEY:=json", () => {
    const parsed = parseStandaloneArgs([
      "--config",
      "STR_VAL=hello",
      "--config",
      'JSON_OBJ:={"nested":true}',
      "--config=NUM_VAL:=42",
      "run",
      "my.action",
    ]);

    assert.strictEqual(parsed.configOverrides.STR_VAL, "hello");
    assert.deepStrictEqual(parsed.configOverrides.JSON_OBJ, { nested: true });
    assert.strictEqual(parsed.configOverrides.NUM_VAL, 42);

    // 拒绝模板通配
    assert.throws(
      () => parseConfigOverrideAssignment("provider.*.token:=123"),
      /Concrete configuration key expected/
    );

    // 错误不携带敏感明文
    const secret = "SUPER_SECRET_123";
    try {
      parseConfigOverrideAssignment(`PASSWORD:=${secret}`);
      assert.fail("Should have thrown");
    } catch (err: any) {
      assert.strictEqual(err.message.includes(secret), false);
    }
  });
});
