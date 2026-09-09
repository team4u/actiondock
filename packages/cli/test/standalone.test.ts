import { describe, expect, it } from "bun:test";
import { defineAction } from "@actiondock/sdk";
import { ExitCode } from "../src/types";
import { runStandaloneCli } from "../src/standalone";

describe("CLI - Standalone Mode Dispatcher", () => {
  const greetAction = defineAction({
    id: "greet",
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
    async run(input: any, ctx) {
      const greeting = ctx.config.get("GREETING", "Hello");
      return { message: `${greeting}, ${input.name}!` };
    },
  });

  const failAction = defineAction({
    id: "fail",
    description: "Always fail",
    run: async () => {
      throw new Error("Intentional failure");
    },
  });

  const baseOptions = {
    packageId: "test.standalone",
    version: "1.2.3",
    description: "Standalone test package",
    actions: [greetAction, failAction],
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
    expect(code).toBe(ExitCode.SUCCESS);
    expect(out.trim()).toBe("test.standalone v1.2.3");
  });

  it("handles --help and lists usage", async () => {
    let out = "";
    const code = await runStandaloneCli(["--help"], {
      ...baseOptions,
      stdout: (msg) => (out += msg + "\n"),
    });
    expect(code).toBe(ExitCode.SUCCESS);
    expect(out).toContain("test.standalone");
    expect(out).toContain("Usage:");
    expect(out).toContain("list");
    expect(out).toContain("run");
  });

  it("lists actions in json and envelope formats", async () => {
    let jsonOut = "";
    const codeJson = await runStandaloneCli(["list", "--json"], {
      ...baseOptions,
      stdout: (msg) => (jsonOut += msg),
    });
    expect(codeJson).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(jsonOut);
    expect(parsed.length).toBe(2);
    expect(parsed.some((a: any) => a.id === "greet")).toBe(true);

    let envOut = "";
    const codeEnv = await runStandaloneCli(["list", "--envelope"], {
      ...baseOptions,
      stdout: (msg) => (envOut += msg),
    });
    expect(codeEnv).toBe(ExitCode.SUCCESS);
    const parsedEnv = JSON.parse(envOut);
    expect(parsedEnv.ok).toBe(true);
    expect(parsedEnv.data.length).toBe(2);
  });

  it("describes action specification and schema", async () => {
    let out = "";
    const code = await runStandaloneCli(["describe", "greet", "--json"], {
      ...baseOptions,
      stdout: (msg) => (out += msg),
    });
    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(out);
    expect(parsed.id).toBe("greet");
    expect(parsed.description).toBe("Greet someone warmly");
    expect(parsed.inputSchema.properties.name).toBeDefined();
  });

  it("executes action successfully and handles config overrides", async () => {
    let out = "";
    const code = await runStandaloneCli(
      ["run", "greet", "--input", '{"name": "Alice"}', "--config", "GREETING=Hi"],
      {
        ...baseOptions,
        stdout: (msg) => (out += msg),
      }
    );
    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.message).toBe("Hi, Alice!");
  });

  it("handles action execution failures transparently", async () => {
    let out = "";
    const code = await runStandaloneCli(["run", "fail"], {
      ...baseOptions,
      stdout: (msg) => (out += msg),
    });
    expect(code).toBe(ExitCode.FAILURE);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.message).toContain("Intentional failure");
  });

  it("manages state via state subcommands", async () => {
    let out = "";
    const opts = {
      ...baseOptions,
      stdout: (msg: string) => (out = msg),
    };

    // state set
    const setCode = await runStandaloneCli(["state", "set", "user:counter", "10"], opts);
    expect(setCode).toBe(ExitCode.SUCCESS);

    // state get
    const getCode = await runStandaloneCli(["state", "get", "user:counter", "--json"], opts);
    expect(getCode).toBe(ExitCode.SUCCESS);
    expect(JSON.parse(out).value).toBe(10);

    // state list
    const listCode = await runStandaloneCli(["state", "list"], opts);
    expect(listCode).toBe(ExitCode.SUCCESS);
    expect(JSON.parse(out).some((k: string) => k.includes("counter"))).toBe(true);

    // state delete
    const delCode = await runStandaloneCli(["state", "delete", "user:counter"], opts);
    expect(delCode).toBe(ExitCode.SUCCESS);

    // state get after delete
    const getDeletedCode = await runStandaloneCli(["state", "get", "user:counter", "--json"], opts);
    expect(getDeletedCode).toBe(ExitCode.SUCCESS);
    expect(JSON.parse(out).value).toBeUndefined();
  });

  it("manages config via config subcommands", async () => {
    let out = "";
    const opts = {
      ...baseOptions,
      stdout: (msg: string) => (out = msg),
    };

    // config set
    const setCode = await runStandaloneCli(["config", "set", "GREETING", "Welcome"], opts);
    expect(setCode).toBe(ExitCode.SUCCESS);

    // config get
    const getCode = await runStandaloneCli(["config", "get", "GREETING"], opts);
    expect(getCode).toBe(ExitCode.SUCCESS);
    expect(JSON.parse(out)).toBe("Welcome");

    // config list
    const listCode = await runStandaloneCli(["config", "list"], opts);
    expect(listCode).toBe(ExitCode.SUCCESS);
    expect(JSON.parse(out).GREETING).toBe("Welcome");
  });

  it("returns INVALID_ARGUMENT on unknown command", async () => {
    let errOut = "";
    const code = await runStandaloneCli(["unknown-cmd"], {
      ...baseOptions,
      stderr: (msg) => (errOut += msg),
    });
    expect(code).toBe(ExitCode.INVALID_ARGUMENT);
    expect(errOut).toContain("Unknown command");
  });
});
