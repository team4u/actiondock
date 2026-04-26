import { describe, expect, it } from "vitest";
import {
  buildExecuteCliCommand,
  buildExecuteCmdCliCommand,
  buildExecutePowerShellCliCommand,
  buildExecutePowerShellCommand,
  buildPluginInvokeCliCommand,
  buildPluginInvokeCmdCliCommand,
  buildPluginInvokePowerShellCliCommand,
  buildPluginInvokePowerShellCommand,
  buildExecutionInputExample,
  resolveExecutionCommandInput,
  buildScriptDetailCliCommand,
  buildScriptDetailCmdCliCommand,
  buildScriptDetailPowerShellCliCommand,
  buildScriptDetailPowerShellCommand,
  buildToolDetailCliCommand,
  buildToolDetailCmdCliCommand,
  buildToolDetailPowerShellCliCommand,
  buildToolDetailPowerShellCommand
} from "./commands";
import type { SchemaFieldDefinition } from "./schema";

describe("CLI command builders", () => {
  it("builds script detail and schema commands with connection flags", () => {
    expect(
      buildScriptDetailCliCommand({
        apiKey: "local-dev-key",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(`java -jar actiondock-cli.jar \\
  --base-url 'http://localhost:8080' \\
  --token 'local-dev-key' \\
  scripts get 'hello-groovy'`);

    expect(
      buildToolDetailCliCommand({
        apiKey: "local-dev-key",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(`java -jar actiondock-cli.jar \\
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
      'java -jar actiondock-cli.jar --base-url "http://localhost:8080" --token "local-dev-key" scripts schema "hello-groovy"'
    );

    expect(
      buildScriptDetailCmdCliCommand({
        apiKey: "local-dev-key",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(
      'java -jar actiondock-cli.jar --base-url "http://localhost:8080" --token "local-dev-key" scripts get "hello-groovy"'
    );

    expect(
      buildScriptDetailPowerShellCliCommand({
        apiKey: "local-dev-key",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(`java -jar actiondock-cli.jar \`
  --base-url 'http://localhost:8080' \`
  --token 'local-dev-key' \`
  scripts get 'hello-groovy'`);

    expect(
      buildToolDetailPowerShellCliCommand({
        apiKey: "local-dev-key",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(`java -jar actiondock-cli.jar \`
  --base-url 'http://localhost:8080' \`
  --token 'local-dev-key' \`
  scripts schema 'hello-groovy'`);
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
    ).toBe(`java -jar actiondock-cli.jar \\
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
      'java -jar actiondock-cli.jar --base-url "http://localhost:8080" --token "secret-token" executions submit --script-id "hello-groovy" --input "{\\"name\\":\\"Alice \\\\\\"Ops\\\\\\"\\"}" --mode ASYNC'
    );

    expect(
      buildExecutePowerShellCliCommand({
        apiKey: "secret-token",
        input: { name: 'Alice "Ops"' },
        mode: "ASYNC",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(`@'
{
  "name": "Alice \\"Ops\\""
}
'@ | java -jar actiondock-cli.jar \`
  --base-url 'http://localhost:8080' \`
  --token 'secret-token' \`
  executions submit \`
  --script-id 'hello-groovy' \`
  --input-file - \`
  --mode ASYNC \`
  --response-view RESULT`);
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
    ).toBe(`java -jar actiondock-cli.jar \\
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
      'java -jar actiondock-cli.jar --base-url "http://localhost:8080" plugins invoke "plugin-a" "summarize" --args "{\\"topic\\":\\"ops \\\\\\"night\\\\\\"\\"}" --script-input "{\\"locale\\":\\"zh-CN\\"}" --response-view RESULT'
    );

    expect(
      buildPluginInvokePowerShellCliCommand({
        action: "summarize",
        args: { topic: 'ops "night"' },
        origin: "http://localhost:8080",
        pluginId: "plugin-a",
        responseView: "RESULT",
        scriptInput: { locale: "zh-CN" }
      })
    ).toBe(`$argsJson = @'
{
  "topic": "ops \\"night\\""
}
'@

$scriptInputJson = @'
{
  "locale": "zh-CN"
}
'@

$argsPath = Join-Path $env:TEMP ("actiondock-args-{0}.json" -f [guid]::NewGuid())

$scriptInputPath = Join-Path $env:TEMP ("actiondock-script-input-{0}.json" -f [guid]::NewGuid())

[System.IO.File]::WriteAllText($argsPath, $argsJson, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($scriptInputPath, $scriptInputJson, [System.Text.UTF8Encoding]::new($false))

try {
  java -jar actiondock-cli.jar \`
    --base-url 'http://localhost:8080' \`
    plugins invoke 'plugin-a' 'summarize' \`
    --args-file $argsPath \`
    --script-input-file $scriptInputPath \`
    --response-view RESULT
} finally {
  Remove-Item $argsPath -ErrorAction SilentlyContinue
  Remove-Item $scriptInputPath -ErrorAction SilentlyContinue
}`);
  });
});

describe("PowerShell HTTP command builders", () => {
  it("builds script detail and schema commands with authorization headers", () => {
    expect(
      buildScriptDetailPowerShellCommand({
        apiKey: "local-dev-key",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(`$headers = @{
  Authorization = 'Bearer local-dev-key'
}

$response = Invoke-WebRequest \`
  -Uri 'http://localhost:8080/api/scripts/hello-groovy' \`
  -Method Get \`
  -UseBasicParsing \`
  -Headers $headers

$stream = $response.RawContentStream
if ($stream.CanSeek) {
  $stream.Position = 0
}
$reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true)
try {
  $json = $reader.ReadToEnd()
} finally {
  $reader.Dispose()
}
$json | ConvertFrom-Json | ConvertTo-Json -Depth 100`);

    expect(
      buildToolDetailPowerShellCommand({
        apiKey: "local-dev-key",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(`$headers = @{
  Authorization = 'Bearer local-dev-key'
}

$response = Invoke-WebRequest \`
  -Uri 'http://localhost:8080/api/schema/hello-groovy' \`
  -Method Get \`
  -UseBasicParsing \`
  -Headers $headers

$stream = $response.RawContentStream
if ($stream.CanSeek) {
  $stream.Position = 0
}
$reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true)
try {
  $json = $reader.ReadToEnd()
} finally {
  $reader.Dispose()
}
$json | ConvertFrom-Json | ConvertTo-Json -Depth 100`);
  });

  it("builds execution command without authorization headers when no token is set", () => {
    expect(
      buildExecutePowerShellCommand({
        input: { name: 'Alice "Ops"', team: "O'Brien" },
        mode: "ASYNC",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(`$body = @'
{
  "scriptId": "hello-groovy",
  "input": {
    "name": "Alice \\"Ops\\"",
    "team": "O'Brien"
  },
  "mode": "ASYNC"
}
'@

$response = Invoke-WebRequest \`
  -Uri 'http://localhost:8080/api/executions' \`
  -Method Post \`
  -UseBasicParsing \`
  -ContentType 'application/json; charset=utf-8' \`
  -Body $body

$stream = $response.RawContentStream
if ($stream.CanSeek) {
  $stream.Position = 0
}
$reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true)
try {
  $json = $reader.ReadToEnd()
} finally {
  $reader.Dispose()
}
$json | ConvertFrom-Json | ConvertTo-Json -Depth 100`);
  });

  it("builds plugin invoke command with token-safe PowerShell quoting", () => {
    expect(
      buildPluginInvokePowerShellCommand({
        action: "summarize",
        apiKey: "secret'token",
        args: { topic: 'ops "night"', owner: "O'Brien" },
        origin: "http://localhost:8080",
        pluginId: "plugin-a",
        responseView: "RESULT",
        scriptInput: { locale: "zh-CN" }
      })
    ).toBe(`$headers = @{
  Authorization = 'Bearer secret''token'
}

$body = @'
{
  "args": {
    "topic": "ops \\"night\\"",
    "owner": "O'Brien"
  },
  "scriptInput": {
    "locale": "zh-CN"
  },
  "responseView": "RESULT"
}
'@

$response = Invoke-WebRequest \`
  -Uri 'http://localhost:8080/api/plugins/plugin-a/actions/summarize/invoke' \`
  -Method Post \`
  -UseBasicParsing \`
  -ContentType 'application/json; charset=utf-8' \`
  -Headers $headers \`
  -Body $body

$stream = $response.RawContentStream
if ($stream.CanSeek) {
  $stream.Position = 0
}
$reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true)
try {
  $json = $reader.ReadToEnd()
} finally {
  $reader.Dispose()
}
$json | ConvertFrom-Json | ConvertTo-Json -Depth 100`);
  });
});

describe("execution input examples", () => {
  it("prefers schema examples and defaults over placeholders", () => {
    const fields: SchemaFieldDefinition[] = [
      {
        name: "message",
        label: "Message",
        kind: "string",
        required: true,
        examples: ["from-example"],
        defaultValue: "from-default"
      },
      {
        name: "enabled",
        label: "Enabled",
        kind: "boolean",
        required: false,
        defaultValue: false
      },
      {
        name: "count",
        label: "Count",
        kind: "integer",
        required: false
      }
    ];

    expect(buildExecutionInputExample(fields)).toEqual({
      message: "from-example",
      enabled: false,
      count: 1
    });
  });

  it("uses the shared example generator for command fallback input", () => {
    const fields: SchemaFieldDefinition[] = [
      {
        name: "message",
        label: "Message",
        kind: "string",
        required: true,
        examples: ["hello"]
      },
      {
        name: "status",
        label: "Status",
        kind: "enum",
        required: false,
        enumValues: ["ready", "draft"],
        examples: ["ready"],
        defaultValue: "draft"
      },
      {
        name: "count",
        label: "Count",
        kind: "integer",
        required: false,
        defaultValue: 2
      }
    ];

    expect(
      resolveExecutionCommandInput({
        fields,
        formValues: undefined,
        inputMode: "JSON",
        jsonInput: "{}"
      })
    ).toEqual({
      note: "当前未填写执行入参，已回退到示例请求体。",
      source: "sample",
      value: {
        message: "hello",
        status: "ready",
        count: 2
      }
    });
  });
});
