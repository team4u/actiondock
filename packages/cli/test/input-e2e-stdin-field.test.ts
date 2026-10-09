import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startActionDockServer, type ActionDockServerInstance } from "@actiondock/core/server";

import { runCliAsync } from "./helpers/run-cli";

let tempHome: string | undefined;

async function runCli(
  args: string[],
  cwd?: string,
  stdinInput?: string | Buffer,
  env?: Record<string, string>
) {
  return await runCliAsync(args, cwd, {
    ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}),
    ...env,
  }, stdinInput);
}

describe("CLI Action Input Resolution - Raw Stdin Field Binding", () => {
  let tempDir: string;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-cli-stdin-field-test-"));
    tempHome = mkdtempSync(join(tmpdir(), "ad-cli-stdin-field-home-"));

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
      } catch {}
    }

    const initProc = await runCli(["init", "--id", "test.stdin-pkg", "--name", "Stdin Pkg", "."], tempDir);
    assert.strictEqual(initProc.exitCode, 0);

    const echoActionSource = `import { defineAction } from "@actiondock/sdk";
import { writeFileSync } from "node:fs";
export default defineAction(async (input: any) => {
  if (input && input.triggerSideEffect) {
    writeFileSync("${join(tempDir, "side-effect.ran").replace(/\\/g, "/")}", "ran");
  }
  return { received: input };
});
`;
    writeFileSync(join(tempDir, "actions", "echo.ts"), echoActionSource, "utf-8");

    const configPath = join(tempDir, "actiondock.json");
    const existingConfig = JSON.parse(
      existsSync(configPath) ? readFileSync(configPath, "utf-8") : "{}"
    );
    existingConfig.actions = existingConfig.actions || {};
    existingConfig.actions["test.echo"] = {
      entry: "actions/echo.ts",
      description: "Echo input payload",
    };
    writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), "utf-8");
  });

  after(async () => {
    if (tempHome && existsSync(tempHome)) {
      try {
        rmSync(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {}
      tempHome = undefined;
    }
    if (tempDir && existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {}
    }
  });

  it("binds raw stdin text to the named input field combined with flat args", async () => {
    const proc = await runCli(
      ["run", "test.echo", "--stdin-field", "text", "--json", "--", "style=brief"],
      tempDir,
      "这是一段正文"
    );
    assert.strictEqual(proc.exitCode, 0);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.data.received, { text: "这是一段正文", style: "brief" });
  });

  it("binds stdin without flat args yielding only the field", async () => {
    const proc = await runCli(
      ["run", "test.echo", "--stdin-field", "content", "--json"],
      tempDir,
      "plain body"
    );
    assert.strictEqual(proc.exitCode, 0);
    const res = JSON.parse(proc.stdout.toString());
    assert.deepStrictEqual(res.data.received, { content: "plain body" });
  });

  it("preserves raw bytes exactly: whitespace, CRLF, quotes, backslash, unicode and BOM", async () => {
    const payload = Buffer.concat([
      Buffer.from("  start \n", "utf8"),
      Buffer.from("line2\r\n", "utf8"),
      Buffer.from([0xef, 0xbb, 0xbf]), // UTF-8 BOM 保留为正文
      Buffer.from("\"引号\" 反斜杠\\\\ 中文 😀\t ", "utf8"),
    ]);

    const proc = await runCli(
      ["run", "test.echo", "--stdin-field", "text", "--json"],
      tempDir,
      payload
    );
    assert.strictEqual(proc.exitCode, 0);
    const res = JSON.parse(proc.stdout.toString());
    const received: string = res.data.received.text;
    assert.strictEqual(received, payload.toString("utf8"));
    assert.ok(received.startsWith("  start"));
    assert.ok(received.includes("\r\n"));
    assert.ok(received.includes("\uFEFF"));
    assert.ok(!received.startsWith("\uFEFF"));
  });

  it("does not parse stdin content that looks like JSON or numbers", async () => {
    const proc = await runCli(
      ["run", "test.echo", "--stdin-field", "text", "--json"],
      tempDir,
      "{\"not\":\"json-object\"}"
    );
    assert.strictEqual(proc.exitCode, 0);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.data.received.text, "{\"not\":\"json-object\"}");

    const proc2 = await runCli(
      ["run", "test.echo", "--stdin-field", "text", "--json"],
      tempDir,
      "12345"
    );
    const res2 = JSON.parse(proc2.stdout.toString());
    assert.strictEqual(res2.data.received.text, "12345");
  });

  it("empty stdin yields empty string bound to the field", async () => {
    const proc = await runCli(
      ["run", "test.echo", "--stdin-field", "text", "--json"],
      tempDir,
      ""
    );
    assert.strictEqual(proc.exitCode, 0);
    const res = JSON.parse(proc.stdout.toString());
    assert.deepStrictEqual(res.data.received, { text: "" });
  });

  it("rejects duplicate target field from flat args before reading stdin and without side effects", async () => {
    const proc = await runCli(
      ["run", "test.echo", "--stdin-field", "text", "--json", "--", "text=abc", "triggerSideEffect:=true"],
      tempDir,
      "body"
    );
    assert.strictEqual(proc.exitCode, 2);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, "INPUT_PATH_CONFLICT");
    assert.strictEqual(res.error.details.reason, "DUPLICATE_ASSIGNMENT");
    assert.strictEqual(existsSync(join(tempDir, "side-effect.ran")), false);
  });

  it("rejects ancestor conflict when flat args assign nested path under the stdin field", async () => {
    const proc = await runCli(
      ["run", "test.echo", "--stdin-field", "text", "--json", "--", "text.child=abc"],
      tempDir,
      "body"
    );
    assert.strictEqual(proc.exitCode, 2);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.error.code, "INPUT_PATH_CONFLICT");
    assert.strictEqual(res.error.details.reason, "LEAF_CONTAINER_CONFLICT");
  });

  it("rejects combining --stdin-field with --input or --input-file before execution", async () => {
    const inlineProc = await runCli(
      ["run", "test.echo", "--stdin-field", "text", "--input", "{}", "--json"],
      tempDir,
      "body"
    );
    assert.strictEqual(inlineProc.exitCode, 2);
    const inlineRes = JSON.parse(inlineProc.stdout.toString());
    assert.strictEqual(inlineRes.error.code, "INPUT_CONFLICT");
    assert.strictEqual(inlineRes.error.details.reason, "MULTIPLE_INPUT_MODES");

    const stdinJsonProc = await runCli(
      ["run", "test.echo", "--stdin-field", "text", "--input-file", "-", "--json"],
      tempDir,
      "body"
    );
    assert.strictEqual(stdinJsonProc.exitCode, 2);
    const stdinJsonRes = JSON.parse(stdinJsonProc.stdout.toString());
    assert.strictEqual(stdinJsonRes.error.code, "INPUT_CONFLICT");
  });

  it("rejects invalid field names with INVALID_FLAT_ARGUMENT before execution", async () => {
    const cases: Array<[string, string]> = [
      ["", "INVALID_SEGMENT"],
      ["   ", "INVALID_SEGMENT"],
      ["user.name", "INVALID_DOT_NOTATION"],
      ["__proto__", "FORBIDDEN_PROPERTY"],
      ["constructor", "FORBIDDEN_PROPERTY"],
      ["bad name!", "INVALID_SEGMENT"],
    ];

    for (const [field, reason] of cases) {
      const proc = await runCli(
        ["run", "test.echo", "--stdin-field", field, "--json"],
        tempDir,
        "body"
      );
      assert.strictEqual(proc.exitCode, 2, `field '${field}' should be rejected`);
      const res = JSON.parse(proc.stdout.toString());
      assert.strictEqual(res.error.code, "INVALID_FLAT_ARGUMENT", `field '${field}'`);
      assert.strictEqual(res.error.details.reason, reason, `field '${field}'`);
    }
  });

  it("inputSchema validation still rejects non-string fields as usual", async () => {
    const configPath = join(tempDir, "actiondock.json");
    const existingConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    existingConfig.actions["test.typed"] = {
      entry: "actions/echo.ts",
      description: "Typed echo",
      inputSchema: {
        type: "object",
        properties: {
          count: { type: "number" },
        },
        required: ["count"],
      },
    };
    writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), "utf-8");

    const proc = await runCli(
      ["run", "test.typed", "--stdin-field", "count", "--json"],
      tempDir,
      "12345"
    );
    assert.strictEqual(proc.exitCode, 1);
    const res = JSON.parse(proc.stdout.toString());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, "INPUT_VALIDATION_FAILED");
  });

  it("allows using --stdin-field together with --text-field", async () => {
    const configPath = join(tempDir, "actiondock.json");
    const existingConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    existingConfig.actions["test.summarize"] = {
      entry: "actions/summarize.ts",
      description: "Summarize text",
      annotations: {
        "actiondock.cli": {
          textField: "summary",
        },
      },
    };
    writeFileSync(
      configPath,
      JSON.stringify(existingConfig, null, 2),
      "utf-8"
    );
    writeFileSync(
      join(tempDir, "actions", "summarize.ts"),
      `import { defineAction } from "@actiondock/sdk";
export default defineAction(async (input: { text: string; style?: string }) => {
  return { summary: input.text.toUpperCase(), style: input.style || "default" };
});
`,
      "utf-8"
    );

    const proc = await runCli(
      ["run", "test.summarize", "--stdin-field", "text", "--text-field", "summary", "--", "style=brief"],
      tempDir,
      "body text"
    );
    assert.strictEqual(proc.exitCode, 0);
    assert.strictEqual(proc.stdout.toString(), "BODY TEXT\n");
    assert.strictEqual(proc.stderr.toString(), JSON.stringify({ style: "brief" }, null, 2) + "\n");
  });

  it("remote async submission constructs input locally with the same capability", async () => {
    const remoteDir = mkdtempSync(join(tmpdir(), "ad-cli-stdin-field-remote-"));
    const initProc = await runCli(["init", "--id", "test.remote-stdin", "--name", "Remote", "."], remoteDir);
    assert.strictEqual(initProc.exitCode, 0);

    writeFileSync(
      join(remoteDir, "actions", "echo.ts"),
      `import { defineAction } from "@actiondock/sdk";
export default defineAction(async (input: any) => {
  return { received: input };
});
`,
      "utf-8"
    );
    const remoteConfigPath = join(remoteDir, "actiondock.json");
    const remoteConfig = JSON.parse(readFileSync(remoteConfigPath, "utf-8"));
    remoteConfig.actions = remoteConfig.actions || {};
    remoteConfig.actions["remote.echo"] = {
      entry: "actions/echo.ts",
      description: "Remote echo",
    };
    writeFileSync(remoteConfigPath, JSON.stringify(remoteConfig, null, 2), "utf-8");

    const server: ActionDockServerInstance = await startActionDockServer({
      port: 0,
      host: "127.0.0.1",
      token: "test-secret-stdin-field",
      projectRoot: remoteDir,
    });

    try {
      const asyncProc = await runCli(
        [
          "run",
          "remote.echo",
          "--stdin-field",
          "text",
          "--async",
          "--json",
          "--server",
          `http://127.0.0.1:${server.port}`,
          "--token",
          "test-secret-stdin-field",
          "--",
          "style=brief",
        ],
        tempDir,
        "远程正文"
      );
      assert.strictEqual(asyncProc.exitCode, 0);
      const asyncRes = JSON.parse(asyncProc.stdout.toString());
      assert.strictEqual(asyncRes.ok, true);
      assert.strictEqual(typeof asyncRes.runId, "string");

      const syncProc = await runCli(
        [
          "run",
          "remote.echo",
          "--stdin-field",
          "text",
          "--json",
          "--server",
          `http://127.0.0.1:${server.port}`,
          "--token",
          "test-secret-stdin-field",
          "--",
          "style=brief",
        ],
        tempDir,
        "远程正文"
      );
      assert.strictEqual(syncProc.exitCode, 0);
      const syncRes = JSON.parse(syncProc.stdout.toString());
      assert.strictEqual(syncRes.ok, true);
      assert.deepStrictEqual(syncRes.data.received, { text: "远程正文", style: "brief" });
    } finally {
      try {
        await server.stop();
      } catch {}
      try {
        rmSync(remoteDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {}
    }
  });
});
