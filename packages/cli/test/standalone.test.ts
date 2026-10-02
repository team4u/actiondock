import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineAction } from "@actiondock/sdk";
import { ExitCode } from "../src/types";
import { runStandaloneCli } from "../src/index";

describe("CLI - Standalone Mode Dispatcher", () => {
  const greetAction = defineAction({
    async run(input: any, ctx) {
      const greeting = ctx.config.get("GREETING", "Hello");
      return { message: `${greeting}, ${input.name}!` };
    },
  });

  const failAction = defineAction({
    run: async () => {
      throw new Error("Intentional failure");
    },
  });

  const baseOptions = {
    packageId: "test.standalone",
    version: "1.2.3",
    description: "Standalone test package",
    actions: [
      {
        id: "greet",
        action: greetAction,
        description: "Greet someone warmly",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        outputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
        },
      },
      {
        id: "fail",
        action: failAction,
        description: "Always fail",
      },
    ],
    configDefs: {
      GREETING: {
        type: "string" as const,
        default: "Hello",
        description: "Greeting prefix",
      },
    },
    inMemory: true,
  };

  it("handles --version and -v flags", async () => {
    let out = "";
    const code = await runStandaloneCli(["--version"], {
      ...baseOptions,
      stdout: (msg) => (out += msg + "\n"),
    });
    assert.strictEqual(code, ExitCode.SUCCESS);
    assert.strictEqual(out.trim(), "test.standalone v1.2.3");
  });

  it("handles --help and lists usage", async () => {
    let out = "";
    const code = await runStandaloneCli(["--help"], {
      ...baseOptions,
      stdout: (msg) => (out += msg + "\n"),
    });
    assert.strictEqual(code, ExitCode.SUCCESS);
    assert.ok((out).includes("test.standalone"));
    assert.ok((out).includes("Usage:"));
    assert.ok((out).includes("list"));
    assert.ok((out).includes("run"));
  });

  it("lists actions in json format", async () => {
    let jsonOut = "";
    const codeJson = await runStandaloneCli(["list", "--json"], {
      ...baseOptions,
      stdout: (msg) => (jsonOut += msg),
    });
    assert.strictEqual(codeJson, ExitCode.SUCCESS);
    const parsed = JSON.parse(jsonOut);
    assert.strictEqual(parsed.items.length, 2);
    assert.strictEqual(parsed.items.some((a: any) => a.id === "greet"), true);
    assert.strictEqual(Array.isArray(parsed.hints), true);
  });

  it("describes action specification and schema", async () => {
    let out = "";
    const code = await runStandaloneCli(["describe", "greet", "--json"], {
      ...baseOptions,
      stdout: (msg) => (out += msg),
    });
    assert.strictEqual(code, ExitCode.SUCCESS);
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.id, "greet");
    assert.strictEqual(parsed.description, "Greet someone warmly");
    assert.notStrictEqual(parsed.inputSchema.properties.name, undefined);
  });

  it("executes action successfully and handles config overrides", async () => {
    // 1. Raw default mode
    let outRaw = "";
    const codeRaw = await runStandaloneCli(
      ["run", "greet", "--input", '{"name": "Alice"}', "--config", "GREETING=Hi"],
      {
        ...baseOptions,
        stdout: (msg) => (outRaw += msg),
      }
    );
    assert.strictEqual(codeRaw, ExitCode.SUCCESS);
    assert.strictEqual(outRaw, "Hi, Alice!");

    // 2. Machine JSON mode
    let outJson = "";
    const codeJson = await runStandaloneCli(
      ["run", "greet", "--input", '{"name": "Alice"}', "--config", "GREETING=Hi", "--json"],
      {
        ...baseOptions,
        stdout: (msg) => (outJson += msg),
      }
    );
    assert.strictEqual(codeJson, ExitCode.SUCCESS);
    const parsed = JSON.parse(outJson);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.data.message, "Hi, Alice!");
  });

  it("handles action execution failures transparently", async () => {
    // 1. Raw default mode: error in stderr, non-zero exit code
    let errOut = "";
    const codeRaw = await runStandaloneCli(["run", "fail"], {
      ...baseOptions,
      stderr: (msg) => (errOut += msg),
    });
    assert.strictEqual(codeRaw, ExitCode.FAILURE);
    assert.ok((errOut).includes("Intentional failure"));

    // 2. Machine JSON mode: error in JSON envelope on stdout
    let jsonOut = "";
    const codeJson = await runStandaloneCli(["run", "fail", "--json"], {
      ...baseOptions,
      stdout: (msg) => (jsonOut += msg),
    });
    assert.strictEqual(codeJson, ExitCode.FAILURE);
    const parsed = JSON.parse(jsonOut);
    assert.strictEqual(parsed.ok, false);
    assert.ok((parsed.error.message).includes("Intentional failure"));
  });

  it("manages state via state subcommands", async () => {
    let out = "";
    const opts = {
      ...baseOptions,
      stdout: (msg: string) => (out = msg),
    };

    // state set
    const setCode = await runStandaloneCli(["state", "set", "user:counter", "10"], opts);
    assert.strictEqual(setCode, ExitCode.SUCCESS);

    // state get
    const getCode = await runStandaloneCli(["state", "get", "user:counter", "--json"], opts);
    assert.strictEqual(getCode, ExitCode.SUCCESS);
    assert.strictEqual(JSON.parse(out).value, 10);

    // state list
    const listCode = await runStandaloneCli(["state", "list"], opts);
    assert.strictEqual(listCode, ExitCode.SUCCESS);
    assert.strictEqual(JSON.parse(out).some((k: string) => k.includes("counter")), true);

    // state delete
    const delCode = await runStandaloneCli(["state", "delete", "user:counter"], opts);
    assert.strictEqual(delCode, ExitCode.SUCCESS);

    // state get after delete
    const getDeletedCode = await runStandaloneCli(["state", "get", "user:counter", "--json"], opts);
    assert.strictEqual(getDeletedCode, ExitCode.SUCCESS);
    assert.strictEqual(JSON.parse(out).value, undefined);
  });

  it("manages config via config subcommands", async () => {
    let out = "";
    const opts = {
      ...baseOptions,
      stdout: (msg: string) => (out = msg),
    };

    // config set
    const setCode = await runStandaloneCli(["config", "set", "GREETING", "Welcome"], opts);
    assert.strictEqual(setCode, ExitCode.SUCCESS);

    // config get
    const getCode = await runStandaloneCli(["config", "get", "GREETING"], opts);
    assert.strictEqual(getCode, ExitCode.SUCCESS);
    assert.strictEqual(JSON.parse(out), "Welcome");

    // config list
    const listCode = await runStandaloneCli(["config", "list"], opts);
    assert.strictEqual(listCode, ExitCode.SUCCESS);
    assert.strictEqual(JSON.parse(out).GREETING, "Welcome");
  });

  it("returns INVALID_ARGUMENT on unknown command", async () => {
    let errOut = "";
    const code = await runStandaloneCli(["unknown-cmd"], {
      ...baseOptions,
      stderr: (msg) => (errOut += msg),
    });
    assert.strictEqual(code, ExitCode.INVALID_ARGUMENT);
    assert.ok((errOut).includes("Unknown command"));
  });
});
