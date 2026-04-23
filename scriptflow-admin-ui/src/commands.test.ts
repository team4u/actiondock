import { describe, expect, it } from "vitest";
import {
  buildExecuteCliCommand,
  buildExecuteCmdCliCommand,
  buildPluginInvokeCliCommand,
  buildPluginInvokeCmdCliCommand,
  buildScriptDetailCliCommand,
  buildScriptDetailCmdCliCommand,
  buildToolDetailCliCommand,
  buildToolDetailCmdCliCommand
} from "./commands";

describe("CLI command builders", () => {
  it("builds script detail and schema commands with connection flags", () => {
    expect(
      buildScriptDetailCliCommand({
        apiKey: "local-dev-key",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(`java -jar scriptflow-cli.jar \\
  --base-url 'http://localhost:8080' \\
  --token 'local-dev-key' \\
  scripts get 'hello-groovy'`);

    expect(
      buildToolDetailCliCommand({
        apiKey: "local-dev-key",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(`java -jar scriptflow-cli.jar \\
  --base-url 'http://localhost:8080' \\
  --token 'local-dev-key' \\
  scripts schema 'hello-groovy'`);

    expect(
      buildToolDetailCmdCliCommand({
        apiKey: "local-dev-key",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(
      'java -jar scriptflow-cli.jar --base-url "http://localhost:8080" --token "local-dev-key" scripts schema "hello-groovy"'
    );

    expect(
      buildScriptDetailCmdCliCommand({
        apiKey: "local-dev-key",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(
      'java -jar scriptflow-cli.jar --base-url "http://localhost:8080" --token "local-dev-key" scripts get "hello-groovy"'
    );
  });

  it("builds execution command with inline input", () => {
    expect(
      buildExecuteCliCommand({
        apiKey: "secret-token",
        input: { name: "Alice" },
        mode: "ASYNC",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(`java -jar scriptflow-cli.jar \\
  --base-url 'http://localhost:8080' \\
  --token 'secret-token' \\
  executions submit \\
  --script-id 'hello-groovy' \\
  --input '{"name":"Alice"}' \\
  --mode ASYNC`);

    expect(
      buildExecuteCmdCliCommand({
        apiKey: "secret-token",
        input: { name: 'Alice "Ops"' },
        mode: "ASYNC",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(
      'java -jar scriptflow-cli.jar --base-url "http://localhost:8080" --token "secret-token" executions submit --script-id "hello-groovy" --input "{\\"name\\":\\"Alice \\\\\\"Ops\\\\\\"\\"}" --mode ASYNC'
    );
  });

  it("builds plugin invoke command with args and script input", () => {
    expect(
      buildPluginInvokeCliCommand({
        action: "summarize",
        args: { topic: "ops" },
        origin: "http://localhost:8080",
        pluginId: "plugin-a",
        responseView: "RESULT",
        scriptInput: { locale: "zh-CN" }
      })
    ).toBe(`java -jar scriptflow-cli.jar \\
  --base-url 'http://localhost:8080' \\
  plugins invoke 'plugin-a' 'summarize' \\
  --args '{"topic":"ops"}' \\
  --script-input '{"locale":"zh-CN"}' \\
  --response-view RESULT`);

    expect(
      buildPluginInvokeCmdCliCommand({
        action: "summarize",
        args: { topic: 'ops "night"' },
        origin: "http://localhost:8080",
        pluginId: "plugin-a",
        responseView: "RESULT",
        scriptInput: { locale: "zh-CN" }
      })
    ).toBe(
      'java -jar scriptflow-cli.jar --base-url "http://localhost:8080" plugins invoke "plugin-a" "summarize" --args "{\\"topic\\":\\"ops \\\\\\"night\\\\\\"\\"}" --script-input "{\\"locale\\":\\"zh-CN\\"}" --response-view RESULT'
    );
  });
});
