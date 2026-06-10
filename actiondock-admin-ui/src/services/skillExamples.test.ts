import { describe, expect, it } from "vitest";
import type { CommandPreset } from "../components/execution/CommandPanel";
import { buildPluginSkillExample, buildScriptSkillExample, sanitizeCommandForSkill } from "./skillExamples";

function preset(family: string, command: string): CommandPreset {
  return {
    key: `${family}-${command}`,
    family,
    environment: "bash/zsh",
    command
  };
}

describe("skillExamples", () => {
  it("builds script skill content from current commands and masks the token", () => {
    const executePresets = [
      preset("CLI", "actiondock script run 'hello-groovy' --token 'secret-token' --mode 'async' --name 'Alice'"),
      preset("HTTP", "curl -X POST \\\n  -H 'Content-Type: application/json' \\\n  -H 'Authorization: Bearer secret-token' \\\n  -d '{\"input\":{\"name\":\"Alice\"},\"mode\":\"ASYNC\"}' \\\n  'http://localhost:8080/api/scripts/hello-groovy/execute'")
    ];

    const result = buildScriptSkillExample({
      scriptId: "hello-groovy",
      executionMode: "ASYNC",
      input: { name: "Alice" },
      inputSource: "current-json",
      inputSchema: [{ name: "name", kind: "string", required: true }],
      outputSchema: [{ name: "message", kind: "string", required: true }],
      executeCommandPresets: executePresets
    });

    expect(result).toContain("name: actiondock-script-hello-groovy");
    expect(result).toContain("`inputSource`: 当前 JSON 输入");
    expect(result).toContain("输入 Schema");
    expect(result).toContain("\"name\": \"name\"");
    expect(result).toContain("输出 Schema");
    expect(result).toContain("\"name\": \"message\"");
    expect(result).toContain("--token '<token>'");
    expect(result).toContain("Authorization: Bearer <token>");
    expect(result).toContain("http://localhost:8080/api/scripts/hello-groovy/execute");
    expect(result).toContain('"name": "Alice"');
    expect(result).toContain("## 调用注意事项");
    expect(result).toContain("简单类型（`string` / `number` / `integer` / `boolean` / `enum`）的顶层字段直接展开成 flag 即可。");
    expect(result).toContain("遇到对象或数组字段时，再退回 `--input-file` 或 `--input-json`。");
    expect(result).toContain("`--input-json` 和 `--input-file` 不能同时使用；传入内容顶层必须是 JSON 对象。");
    expect(result).toContain("后面的简单 flag 会继续合并进去，并覆盖同名字段。");
    expect(result).toContain("/tmp/hello-groovy-input.json");
    expect(result).toContain("--input-file '/tmp/hello-groovy-input.json'");
    expect(result).toContain("--data '@/tmp/hello-groovy-request.json'");
    expect(result).not.toContain("查看详情");
    expect(result).not.toContain("查看 Schema");
  });

  it("falls back to a minimal execute-only description when the script has no description", () => {
    const result = buildScriptSkillExample({
      scriptId: "hello-groovy",
      executionMode: "SYNC",
      input: {},
      inputSource: "empty",
      executeCommandPresets: [
        preset("CLI", "actiondock script run 'hello-groovy'"),
        preset("HTTP", "curl -X POST 'http://localhost:8080/api/scripts/hello-groovy/execute'")
      ]
    });

    expect(result).toContain('description: "执行 hello-groovy"');
    expect(result).not.toContain("查看并执行脚本");
    expect(result).not.toContain("复用 ActionDock 调用命令");
  });

  it("builds plugin skill content from current commands and current inputs", () => {
    const invokePresets = [
      preset("CLI", "actiondock plugin invoke 'plugin-a' 'summarize' --token 'secret-token' --topic 'ops' --script-input-json '{\"locale\":\"zh-CN\"}'"),
      preset("HTTP", "curl -X POST \\\n  -H 'Content-Type: application/json' \\\n  -H 'Authorization: Bearer secret-token' \\\n  -d '{\"args\":{\"topic\":\"ops\"},\"scriptInput\":{\"locale\":\"zh-CN\"},\"responseView\":\"RESULT\"}' \\\n  'http://localhost:8080/api/plugins/plugin-a/actions/summarize/invoke'")
    ];

    const result = buildPluginSkillExample({
      pluginId: "plugin-a",
      action: "summarize",
      args: { topic: "ops" },
      argsSource: "sample",
      scriptInput: { locale: "zh-CN" },
      scriptInputSource: "current-json",
      inputSchema: { type: "object", properties: { topic: { type: "string" } } },
      outputSchema: { type: "object", properties: { summary: { type: "string" } } },
      invokeCommandPresets: invokePresets
    });

    expect(result).toContain("name: actiondock-plugin-plugin-a-summarize");
    expect(result).toContain("`argsSource`: 示例请求体");
    expect(result).toContain("`scriptInputSource`: 当前 JSON 输入");
    expect(result).toContain("输入 Schema");
    expect(result).toContain("\"topic\"");
    expect(result).toContain("输出 Schema");
    expect(result).toContain("\"summary\"");
    expect(result).toContain("--token '<token>'");
    expect(result).toContain("http://localhost:8080/api/plugins/plugin-a/actions/summarize/invoke");
    expect(result).toContain('"locale": "zh-CN"');
    expect(result).toContain("## 调用注意事项");
    expect(result).toContain("简单类型（`string` / `number` / `integer` / `boolean` / `enum`）的顶层字段直接展开成 flag 即可。");
    expect(result).toContain("`scriptInput` 也是 JSON 对象；优先用 `--script-input-file`，简单场景再用 `--script-input-json`。");
    expect(result).toContain("这些 JSON 输入的顶层都必须是对象。");
    expect(result).toContain("--args-file '/tmp/plugin-a-summarize-args.json'");
    expect(result).toContain("--script-input-file '/tmp/plugin-a-summarize-script-input.json'");
    expect(result).toContain("--data '@/tmp/plugin-a-summarize-request.json'");
  });

  it("sanitizes CLI and curl token values without changing the origin", () => {
    expect(sanitizeCommandForSkill("actiondock script run 'hello' --token 'secret-token'")).toBe(
      "actiondock script run 'hello' --token '<token>'"
    );
    expect(
      sanitizeCommandForSkill("curl -X GET \\\n  -H 'Authorization: Bearer secret-token' \\\n  'http://localhost:8080/api/schema/hello'")
    ).toBe(
      "curl -X GET \\\n  -H 'Authorization: Bearer <token>' \\\n  'http://localhost:8080/api/schema/hello'"
    );
  });
});
