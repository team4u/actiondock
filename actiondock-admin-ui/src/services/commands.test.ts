import { describe, expect, it } from "vitest";
import {
  buildCliCommandPresets,
  buildHttpCommandPresets,
  buildExecuteCliCommand,
  buildExecutePowerShellCommand,
  buildPluginInvokeCliCommand,
  buildPluginInvokePowerShellCommand,
  buildExecutionInputExample,
  resolveExecutionCommandInput,
  buildScriptDetailCliCommand,
  buildScriptDetailCurlCommand,
  buildScriptDetailPowerShellCommand,
  buildExecuteCurlCommand,
  buildPluginInvokeCurlCommand,
  buildToolDetailCurlCommand,
  buildToolDetailPowerShellCommand,
  buildToolSchemaCliCommand
} from "../services/commands";
import type { SchemaFieldDefinition } from "../services/schema";

describe("HTTP command helpers", () => {
  it("builds script detail and schema curl commands with authorization headers", () => {
    expect(
      buildScriptDetailCurlCommand({
        apiKey: "local-dev-key",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(`curl -X GET \\
  -H 'Authorization: Bearer local-dev-key' \\
  'http://localhost:8080/api/scripts/hello-groovy/published'`);

    expect(
      buildToolDetailCurlCommand({
        apiKey: "local-dev-key",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(`curl -X GET \\
  -H 'Authorization: Bearer local-dev-key' \\
  'http://localhost:8080/api/schema/hello-groovy'`);
  });

  it("builds execution curl commands with inline input", () => {
    expect(
      buildExecuteCurlCommand({
        apiKey: "secret-token",
        input: { name: "Alice" },
        mode: "ASYNC",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(`curl -X POST \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer secret-token' \\
  -d '{"input":{"name":"Alice"},"mode":"ASYNC"}' \\
  'http://localhost:8080/api/scripts/hello-groovy/execute'`);
  });

  it("omits sync mode in HTTP execute commands because it is the server default", () => {
    expect(
      buildExecuteCurlCommand({
        input: { message: "hi" },
        mode: "SYNC",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(`curl -X POST \\
  -H 'Content-Type: application/json' \\
  -d '{"input":{"message":"hi"}}' \\
  'http://localhost:8080/api/scripts/hello-groovy/execute'`);

    expect(
      buildExecutePowerShellCommand({
        input: { message: "hi" },
        mode: "SYNC",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe(`$body = @'
{
  "input": {
    "message": "hi"
  }
}
'@

$response = Invoke-WebRequest \`
  -Uri 'http://localhost:8080/api/scripts/hello-groovy/execute' \`
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

  it("builds plugin invoke curl commands with args and script input", () => {
    expect(
      buildPluginInvokeCurlCommand({
        action: "summarize",
        args: { topic: "ops" },
        origin: "http://localhost:8080",
        pluginId: "plugin-a",
        responseView: "RESULT",
        scriptInput: { locale: "zh-CN" }
      })
    ).toBe(`curl -X POST \\
  -H 'Content-Type: application/json' \\
  -d '{"args":{"topic":"ops"},"scriptInput":{"locale":"zh-CN"},"responseView":"RESULT"}' \\
  'http://localhost:8080/api/plugins/plugin-a/actions/summarize/invoke'`);
  });

  it("only returns HTTP presets", () => {
    expect(
      buildHttpCommandPresets({
        keyPrefix: "detail",
        httpBash: "curl -X GET 'http://localhost:8080/api/scripts/hello-groovy/published'",
        httpPowerShell: "Invoke-WebRequest -Uri 'http://localhost:8080/api/scripts/hello-groovy/published'"
      })
    ).toEqual([
      {
        key: "detail-http-bash",
        family: "HTTP",
        environment: "bash/zsh",
        command: "curl -X GET 'http://localhost:8080/api/scripts/hello-groovy/published'"
      },
      {
        key: "detail-http-powershell",
        family: "HTTP",
        environment: "PowerShell",
        command: "Invoke-WebRequest -Uri 'http://localhost:8080/api/scripts/hello-groovy/published'"
      }
    ]);
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
  -Uri 'http://localhost:8080/api/scripts/hello-groovy/published' \`
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
  "input": {
    "name": "Alice \\"Ops\\"",
    "team": "O'Brien"
  },
  "mode": "ASYNC"
}
'@

$response = Invoke-WebRequest \`
  -Uri 'http://localhost:8080/api/scripts/hello-groovy/execute' \`
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

describe("CLI command helpers", () => {
  it("builds draft detail and schema commands when explicitly requested", () => {
    expect(
      buildScriptDetailCliCommand({
        apiKey: "local-dev-key",
        draft: true,
        environment: "bash/zsh",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe("actiondock script get 'hello-groovy' --draft --token 'local-dev-key'");

    expect(
      buildToolSchemaCliCommand({
        apiKey: "local-dev-key",
        draft: true,
        environment: "PowerShell",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe("actiondock script schema 'hello-groovy' --draft --token 'local-dev-key'");
  });

  it("flattens scalar execute args and preserves nested data in input-json", () => {
    expect(
      buildExecuteCliCommand({
        apiKey: "secret-token",
        draft: true,
        environment: "bash/zsh",
        input: { name: "Alice", count: 3, payload: { source: "file" }, enabled: false },
        mode: "ASYNC",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe("actiondock script run 'hello-groovy' --draft --token 'secret-token' --mode 'async' --name 'Alice' --count '3' --enabled 'false' --input-json '{\"payload\":{\"source\":\"file\"}}'");
  });

  it("omits sync mode because it is the CLI default", () => {
    expect(
      buildExecuteCliCommand({
        environment: "bash/zsh",
        input: { message: "hi" },
        mode: "SYNC",
        origin: "http://localhost:8080",
        scriptId: "hello-groovy"
      })
    ).toBe("actiondock script run 'hello-groovy' --message 'hi'");
  });

  it("flattens plugin args but keeps scriptInput as json", () => {
    expect(
      buildPluginInvokeCliCommand({
        action: "summarize",
        apiKey: "secret'token",
        args: { topic: 'ops "night"', retries: 2, payload: { owner: "O'Brien" } },
        environment: "PowerShell",
        origin: "http://localhost:8080",
        pluginId: "plugin-a",
        responseView: "RESULT",
        scriptInput: { locale: "zh-CN" }
      })
    ).toBe("actiondock plugin invoke 'plugin-a' 'summarize' --token 'secret''token' --topic 'ops \"night\"' --retries '2' --args-json '{\"payload\":{\"owner\":\"O''Brien\"}}' --script-input-json '{\"locale\":\"zh-CN\"}'");
  });

  it("builds CLI presets", () => {
    expect(
      buildCliCommandPresets({
        keyPrefix: "invoke",
        cliBash: "actiondock script run 'hello-groovy'",
        cliPowerShell: "actiondock script run 'hello-groovy'"
      })
    ).toEqual([
      {
        key: "invoke-cli-bash",
        family: "CLI",
        environment: "bash/zsh",
        command: "actiondock script run 'hello-groovy'"
      },
      {
        key: "invoke-cli-powershell",
        family: "CLI",
        environment: "PowerShell",
        command: "actiondock script run 'hello-groovy'"
      }
    ]);
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
