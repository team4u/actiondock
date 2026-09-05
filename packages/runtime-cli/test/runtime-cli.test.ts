import { describe, expect, it } from "bun:test";
import { defineAction } from "@actiondock/sdk";
import {
  ArgumentError,
  CliError,
  createErrorEnvelope,
  createRuntimeProgram,
  createSuccessEnvelope,
  ExecutionError,
  ExitCode,
  formatError,
  formatJson,
  parseByteSize,
  parseListOption,
  renderActionDetail,
  renderActionList,
  renderActionValidation,
  renderConfigEnv,
  renderConfigList,
  renderProjectDetail,
  renderRegistryTree,
  renderRunsList,
  renderStateList,
  resolveIntent,
  runRuntimeCli,
  SigintError,
} from "../src";

describe("@actiondock/runtime-cli - Command Registration", () => {
  it("registers all runtime commands and expected subcommands", () => {
    const program = createRuntimeProgram();
    const commandNames = program.commands.map((c) => c.name());

    // 核心命令
    expect(commandNames).toContain("info");
    expect(commandNames).toContain("action");
    expect(commandNames).toContain("run"); // 顶层 run 别名
    expect(commandNames).toContain("playbook");
    expect(commandNames).toContain("config");
    expect(commandNames).toContain("state");
    expect(commandNames).toContain("runs");
    expect(commandNames).toContain("serve");
    expect(commandNames).toContain("mcp");
    expect(commandNames).toContain("version");
    expect(commandNames).toContain("help");

    // action 子命令
    const actionCmd = program.commands.find((c) => c.name() === "action")!;
    const actionSubs = actionCmd.commands.map((c) => c.name());
    expect(actionSubs).toContain("list");
    expect(actionSubs).toContain("show");
    expect(actionSubs).toContain("validate");
    expect(actionSubs).toContain("run");

    // playbook 子命令
    const playbookCmd = program.commands.find((c) => c.name() === "playbook")!;
    const playbookSubs = playbookCmd.commands.map((c) => c.name());
    expect(playbookSubs).toContain("list");
    expect(playbookSubs).toContain("show");

    // config 子命令
    const configCmd = program.commands.find((c) => c.name() === "config")!;
    const configSubs = configCmd.commands.map((c) => c.name());
    expect(configSubs).toContain("list");
    expect(configSubs).toContain("get");
    expect(configSubs).toContain("set");
    expect(configSubs).toContain("delete");
    expect(configSubs).toContain("env");

    // state 子命令
    const stateCmd = program.commands.find((c) => c.name() === "state")!;
    const stateSubs = stateCmd.commands.map((c) => c.name());
    expect(stateSubs).toContain("list");
    expect(stateSubs).toContain("keys");
    expect(stateSubs).toContain("get");
    expect(stateSubs).toContain("set");
    expect(stateSubs).toContain("delete");
    expect(stateSubs).toContain("clear");

    // runs 子命令
    const runsCmd = program.commands.find((c) => c.name() === "runs")!;
    const runsSubs = runsCmd.commands.map((c) => c.name());
    expect(runsSubs).toContain("list");
    expect(runsSubs).toContain("show");
    expect(runsSubs).toContain("clear");
    expect(runsSubs).toContain("cancel");

    // mcp 子命令
    const mcpCmd = program.commands.find((c) => c.name() === "mcp")!;
    const mcpSubs = mcpCmd.commands.map((c) => c.name());
    expect(mcpSubs).toContain("serve");
  });
});

describe("@actiondock/runtime-cli - Utilities & Parameter Parsing", () => {
  it("parses human-readable byte sizes correctly", () => {
    expect(parseByteSize("1024")).toBe(1024);
    expect(parseByteSize("500b")).toBe(500);
    expect(parseByteSize("1kb")).toBe(1024);
    expect(parseByteSize("2mb")).toBe(2 * 1024 * 1024);
    expect(parseByteSize("1gb")).toBe(1024 * 1024 * 1024);
    expect(() => parseByteSize("invalid-size")).toThrow(ArgumentError);
  });

  it("resolves intent filter options and positional patterns", () => {
    expect(resolveIntent(undefined, [])).toBeUndefined();
    expect(resolveIntent("greet", [])).toBe("greet");
    expect(resolveIntent(undefined, ["hello", "world"])).toBe("hello|world");
    expect(resolveIntent("query", ["filter1", "filter2"])).toBe("query|filter1|filter2");
  });

  it("parses comma-separated option lists", () => {
    expect(parseListOption("a,b,c")).toEqual(["a", "b", "c"]);
    expect(parseListOption("item1", ["existing"])).toEqual(["existing", "item1"]);
    expect(parseListOption("  x , y  , z ")).toEqual(["x", "y", "z"]);
  });
});

describe("@actiondock/runtime-cli - Exit Code Strategy", () => {
  it("defines standard exit codes matching specifications", () => {
    expect(ExitCode.SUCCESS).toBe(0);
    expect(ExitCode.FAILURE).toBe(1);
    expect(ExitCode.INVALID_ARGUMENT).toBe(2);
    expect(ExitCode.SIGINT).toBe(130);
  });

  it("correctly formats different error instances", () => {
    const argErr = new ArgumentError("Missing parameter");
    expect(argErr.exitCode).toBe(2);
    const formattedArg = formatError(argErr);
    expect(formattedArg.exitCode).toBe(2);
    expect(formattedArg.code).toBe("INVALID_ARGUMENT");

    const execErr = new ExecutionError("Action failed");
    expect(execErr.exitCode).toBe(1);
    const formattedExec = formatError(execErr);
    expect(formattedExec.exitCode).toBe(1);

    const sigintErr = new SigintError();
    expect(sigintErr.exitCode).toBe(130);
    const formattedSigint = formatError(sigintErr);
    expect(formattedSigint.exitCode).toBe(130);

    const normalErr = new Error("Generic error");
    const formattedNormal = formatError(normalErr);
    expect(formattedNormal.exitCode).toBe(1);
  });

  it("returns exit code 0 on version command", async () => {
    const stdoutLogs: string[] = [];
    const code = await runRuntimeCli(["node", "ad", "version"], {
      stdout: (msg) => stdoutLogs.push(msg),
    });
    expect(code).toBe(ExitCode.SUCCESS);
    expect(stdoutLogs.join("")).toContain("v2.0.2");
  });

  it("returns exit code 0 on help command", async () => {
    const stdoutLogs: string[] = [];
    const code = await runRuntimeCli(["node", "ad", "help"], {
      stdout: (msg) => stdoutLogs.push(msg),
    });
    expect(code).toBe(ExitCode.SUCCESS);
  });

  it("returns exit code 2 on unknown commander options without process.exit", async () => {
    const stderrLogs: string[] = [];
    const code = await runRuntimeCli(["node", "ad", "--unknown-nonexistent-flag"], {
      stderr: (msg) => stderrLogs.push(msg),
    });
    expect(code).toBe(ExitCode.INVALID_ARGUMENT);
    expect(stderrLogs.join("")).toContain("unknown-nonexistent-flag");
  });

  it("returns exit code 2 on missing mandatory action id without process.exit", async () => {
    const stderrLogs: string[] = [];
    const code = await runRuntimeCli(["node", "ad", "action", "show"], {
      stderr: (msg) => stderrLogs.push(msg),
    });
    expect(code).toBe(ExitCode.INVALID_ARGUMENT);
    expect(stderrLogs.join("")).toContain("missing required argument 'id'");
  });
});

describe("@actiondock/runtime-cli - Output & Envelope Renderer", () => {
  it("builds standard success and error envelope structures", () => {
    const successEnv = createSuccessEnvelope({ message: "hello" }, { durationMs: 12 });
    expect(successEnv.ok).toBe(true);
    expect(successEnv.data).toEqual({ message: "hello" });
    expect(successEnv.meta?.durationMs).toBe(12);

    const errorEnv = createErrorEnvelope("RESOURCE_NOT_FOUND", "Item not found", { id: "123" });
    expect(errorEnv.ok).toBe(false);
    expect(errorEnv.error?.code).toBe("RESOURCE_NOT_FOUND");
    expect(errorEnv.error?.message).toBe("Item not found");
    expect(errorEnv.error?.details).toEqual({ id: "123" });
  });

  it("supports --envelope flag to wrap JSON responses in standard envelope", async () => {
    const logs: string[] = [];
    const code = await runRuntimeCli(["node", "ad", "info", "--json", "--envelope"], {
      standalone: {
        packageId: "envelope-test",
        version: "2.0.0",
        actions: [],
      },
      stdout: (msg) => logs.push(msg),
    });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(logs.join(""));
    expect(parsed.ok).toBe(true);
    expect(parsed.data).toBeDefined();
    expect(parsed.data.id).toBe("envelope-test");
  });

  it("outputs standard error envelope in --json mode upon failure", async () => {
    const stdoutLogs: string[] = [];
    const code = await runRuntimeCli(["node", "ad", "action", "show", "--json"], {
      stdout: (msg) => stdoutLogs.push(msg),
    });
    expect(code).toBe(ExitCode.INVALID_ARGUMENT);
    const parsed = JSON.parse(stdoutLogs.join(""));
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
  });

  it("formats human-readable text representations properly", () => {
    // 渲染 Action 列表
    const actionListText = renderActionList(
      [{ id: "sample.greet", description: "Greets a person" }],
      "Available Actions"
    );
    expect(actionListText).toContain("Available Actions:");
    expect(actionListText).toContain("sample.greet");

    // 渲染 Action 详情
    const actionDetailText = renderActionDetail({
      id: "sample.greet",
      packageId: "sample.pkg",
      description: "Greet action",
      inputSchema: { type: "object" },
    });
    expect(actionDetailText).toContain("Action:      sample.greet");
    expect(actionDetailText).toContain("Input Schema:");

    // 渲染环境变量满足率诊断
    const envText = renderConfigEnv([
      {
        key: "API_KEY",
        required: true,
        satisfied: true,
        matchedEnv: "API_KEY",
        hasDefault: false,
        secret: true,
      },
    ]);
    expect(envText).toContain("Environment Variable Satisfaction Diagnostics");
    expect(envText).toContain("API_KEY");
    expect(envText).toContain("[OK]");

    // 渲染状态列表
    const stateText = renderStateList(["user:1", "user:2"], "Test Package");
    expect(stateText).toContain("State keys for Test Package");
    expect(stateText).toContain("user:1");

    // 渲染执行记录列表
    const runsText = renderRunsList([
      {
        id: "run-001",
        actionId: "sample.greet",
        packageId: "pkg1",
        status: "succeeded",
        startedAt: "2026-09-05T12:00:00Z",
      },
    ]);
    expect(runsText).toContain("RUN ID");
    expect(runsText).toContain("run-001");
  });
});

describe("@actiondock/runtime-cli - Standalone Binary Runtime Mode", () => {
  const sampleAction = defineAction({
    id: "greet",
    description: "Greet user with message",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    },
    outputSchema: {
      type: "object",
      properties: {
        greeting: { type: "string" },
      },
      required: ["greeting"],
    },
    async run(input) {
      return { greeting: `Hello, ${(input as any).name}!` };
    },
  });

  const standaloneOptions = {
    packageId: "standalone-greeting",
    version: "1.0.0",
    description: "Standalone greeting utility",
    configDefs: {
      DEFAULT_NAME: {
        description: "Default fallback name",
        default: "World",
      },
    },
    actions: [sampleAction],
  };

  it("executes info in standalone mode", async () => {
    const logs: string[] = [];
    const code = await runRuntimeCli(["node", "app", "info", "--json"], {
      standalone: standaloneOptions,
      stdout: (msg) => logs.push(msg),
    });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(logs.join(""));
    expect(parsed.id).toBe("standalone-greeting");
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.actions).toContain("greet");
  });

  it("executes action list in standalone mode", async () => {
    const logs: string[] = [];
    const code = await runRuntimeCli(["node", "app", "action", "list", "--json"], {
      standalone: standaloneOptions,
      stdout: (msg) => logs.push(msg),
    });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(logs.join(""));
    expect(parsed.length).toBe(1);
    expect(parsed[0].id).toBe("greet");
  });

  it("executes action show in standalone mode", async () => {
    const logs: string[] = [];
    const code = await runRuntimeCli(["node", "app", "action", "show", "greet", "--json"], {
      standalone: standaloneOptions,
      stdout: (msg) => logs.push(msg),
    });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(logs.join(""));
    expect(parsed.id).toBe("greet");
    expect(parsed.inputSchema).toBeDefined();
  });

  it("executes action validate in standalone mode", async () => {
    const logs: string[] = [];
    const code = await runRuntimeCli(["node", "app", "action", "validate", "--json"], {
      standalone: standaloneOptions,
      stdout: (msg) => logs.push(msg),
    });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(logs.join(""));
    expect(parsed.valid).toBe(true);
    expect(parsed.results.length).toBe(1);
  });

  it("executes action run via root alias in standalone mode", async () => {
    const logs: string[] = [];
    const code = await runRuntimeCli(
      ["node", "app", "run", "greet", "--input", JSON.stringify({ name: "ActionDock" })],
      {
        standalone: standaloneOptions,
        stdout: (msg) => logs.push(msg),
      }
    );

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(logs.join(""));
    expect(parsed.ok).toBe(true);
    expect(parsed.data.greeting).toBe("Hello, ActionDock!");
    expect(parsed.runId).toBeDefined();
  });

  it("fails action run with invalid input schema and returns exit code 1", async () => {
    const logs: string[] = [];
    const code = await runRuntimeCli(
      ["node", "app", "run", "greet", "--input", JSON.stringify({})], // missing required name
      {
        standalone: standaloneOptions,
        stdout: (msg) => logs.push(msg),
        stderr: () => {},
      }
    );

    expect(code).toBe(ExitCode.FAILURE);
    const parsed = JSON.parse(logs.join(""));
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBeDefined();
  });

  it("manages configuration in standalone mode", async () => {
    // 1. config set
    const setLogs: string[] = [];
    const setCode = await runRuntimeCli(
      ["node", "app", "config", "set", "CUSTOM_SETTING", "custom_value"],
      {
        standalone: standaloneOptions,
        stdout: (msg) => setLogs.push(msg),
      }
    );
    expect(setCode).toBe(ExitCode.SUCCESS);

    // 2. config get --json
    const getLogs: string[] = [];
    const getCode = await runRuntimeCli(
      ["node", "app", "config", "get", "CUSTOM_SETTING", "--json"],
      {
        standalone: standaloneOptions,
        stdout: (msg) => getLogs.push(msg),
      }
    );
    expect(getCode).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(getLogs.join(""));
    expect(parsed.key).toBe("CUSTOM_SETTING");
    expect(parsed.value).toBe("custom_value");

    // 3. secret key masking and --reveal
    await runRuntimeCli(
      ["node", "app", "config", "set", "MY_SECRET_TOKEN", "secret123"],
      { standalone: standaloneOptions, stdout: () => {} }
    );
    const maskedLogs: string[] = [];
    await runRuntimeCli(
      ["node", "app", "config", "get", "MY_SECRET_TOKEN", "--json"],
      { standalone: standaloneOptions, stdout: (msg) => maskedLogs.push(msg) }
    );
    const maskedParsed = JSON.parse(maskedLogs.join(""));
    expect(maskedParsed.value).toBe("********");

    const revealLogs: string[] = [];
    await runRuntimeCli(
      ["node", "app", "config", "get", "MY_SECRET_TOKEN", "--reveal", "--json"],
      { standalone: standaloneOptions, stdout: (msg) => revealLogs.push(msg) }
    );
    const revealParsed = JSON.parse(revealLogs.join(""));
    expect(revealParsed.value).toBe("secret123");

    // 3. config env --json
    const envLogs: string[] = [];
    const envCode = await runRuntimeCli(
      ["node", "app", "config", "env", "--json"],
      {
        standalone: standaloneOptions,
        stdout: (msg) => envLogs.push(msg),
      }
    );
    expect(envCode).toBe(ExitCode.SUCCESS);
    const envParsed = JSON.parse(envLogs.join(""));
    expect(envParsed.packageId).toBe("standalone-greeting");
    expect(envParsed.envChecks.length).toBeGreaterThan(0);
  });

  it("manages shared state in standalone mode", async () => {
    // 1. state set
    const setLogs: string[] = [];
    const setCode = await runRuntimeCli(
      ["node", "app", "state", "set", "counter", "42"],
      {
        standalone: standaloneOptions,
        stdout: (msg) => setLogs.push(msg),
      }
    );
    expect(setCode).toBe(ExitCode.SUCCESS);

    // 2. state get --json
    const getLogs: string[] = [];
    const getCode = await runRuntimeCli(
      ["node", "app", "state", "get", "counter", "--json"],
      {
        standalone: standaloneOptions,
        stdout: (msg) => getLogs.push(msg),
      }
    );
    expect(getCode).toBe(ExitCode.SUCCESS);
    const getParsed = JSON.parse(getLogs.join(""));
    expect(getParsed.key).toBe("counter");
    expect(getParsed.value).toBe(42);

    // 3. state keys --json
    const keysLogs: string[] = [];
    const keysCode = await runRuntimeCli(
      ["node", "app", "state", "keys", "--json"],
      {
        standalone: standaloneOptions,
        stdout: (msg) => keysLogs.push(msg),
      }
    );
    expect(keysCode).toBe(ExitCode.SUCCESS);
    const keysParsed = JSON.parse(keysLogs.join(""));
    expect(keysParsed).toContain("counter");

    // 4. state clear --json
    const clearLogs: string[] = [];
    const clearCode = await runRuntimeCli(
      ["node", "app", "state", "clear", "--json"],
      {
        standalone: standaloneOptions,
        stdout: (msg) => clearLogs.push(msg),
      }
    );
    expect(clearCode).toBe(ExitCode.SUCCESS);
    const clearParsed = JSON.parse(clearLogs.join(""));
    expect(clearParsed.ok).toBe(true);
    expect(clearParsed.clearedCount).toBeGreaterThanOrEqual(1);
  });

  it("manages execution runs history in standalone mode", async () => {
    // 之前运行过 action run，已有历史记录
    const listLogs: string[] = [];
    const listCode = await runRuntimeCli(
      ["node", "app", "runs", "list", "--json"],
      {
        standalone: standaloneOptions,
        stdout: (msg) => listLogs.push(msg),
      }
    );
    expect(listCode).toBe(ExitCode.SUCCESS);
    const runsList = JSON.parse(listLogs.join(""));
    expect(Array.isArray(runsList)).toBe(true);

    if (runsList.length > 0) {
      const showLogs: string[] = [];
      const showCode = await runRuntimeCli(
        ["node", "app", "runs", "show", runsList[0].id, "--json"],
        {
          standalone: standaloneOptions,
          stdout: (msg) => showLogs.push(msg),
        }
      );
      expect(showCode).toBe(ExitCode.SUCCESS);
      const showParsed = JSON.parse(showLogs.join(""));
      expect(showParsed.id).toBe(runsList[0].id);
    }

    // runs clear
    const clearLogs: string[] = [];
    const clearCode = await runRuntimeCli(
      ["node", "app", "runs", "clear", "--json"],
      {
        standalone: standaloneOptions,
        stdout: (msg) => clearLogs.push(msg),
      }
    );
    expect(clearCode).toBe(ExitCode.SUCCESS);
  });
});
