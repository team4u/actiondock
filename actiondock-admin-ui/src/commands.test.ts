import { describe, expect, it } from "vitest";
import {
  buildHttpCommandPresets,
  buildExecutePowerShellCommand,
  buildPluginInvokePowerShellCommand,
  buildExecutionInputExample,
  resolveExecutionCommandInput,
  buildScriptDetailCurlCommand,
  buildScriptDetailPowerShellCommand,
  buildExecuteCurlCommand,
  buildPluginInvokeCurlCommand,
  buildToolDetailCurlCommand,
  buildToolDetailPowerShellCommand
} from "./commands";
import type { SchemaFieldDefinition } from "./schema";

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
  'http://localhost:8080/api/scripts/hello-groovy'`);

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
  -d '{"scriptId":"hello-groovy","input":{"name":"Alice"},"mode":"ASYNC"}' \\
  'http://localhost:8080/api/executions'`);
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
        httpBash: "curl -X GET 'http://localhost:8080/api/scripts/hello-groovy'",
        httpPowerShell: "Invoke-WebRequest -Uri 'http://localhost:8080/api/scripts/hello-groovy'"
      })
    ).toEqual([
      {
        key: "detail-http-bash",
        family: "HTTP",
        environment: "bash/zsh",
        command: "curl -X GET 'http://localhost:8080/api/scripts/hello-groovy'"
      },
      {
        key: "detail-http-powershell",
        family: "HTTP",
        environment: "PowerShell",
        command: "Invoke-WebRequest -Uri 'http://localhost:8080/api/scripts/hello-groovy'"
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
