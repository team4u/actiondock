import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ArgumentError,
  ExecutionError,
  formatError,
  notInProjectError,
  packageNotFoundError,
  SigintError,
} from "../src/errors";
import {
  createErrorEnvelope,
  createSuccessEnvelope,
  projectDetailToJson,
  renderActionDetail,
  renderActionList,
  renderActionValidation,
  renderConfigList,
  renderError,
  renderPlaybookDetail,
  renderPlaybookList,
  renderProjectDetail,
  renderResult,
  renderRunsList,
  renderStateList,
} from "../src/renderer";
import { ExitCode } from "../src/types";
import {
  getEffectiveOptions,
  parseByteSize,
  parseListOption,
  resolveIntent,
} from "../src/utils";

describe("CLI - Errors & Formatting", () => {
  it("formats CliError with code, message and exitCode", () => {
    const err = new ArgumentError("Invalid option --foo");
    assert.strictEqual(err.exitCode, ExitCode.INVALID_ARGUMENT);
    assert.strictEqual(err.code, "INVALID_ARGUMENT");
    const formatted = formatError(err);
    assert.strictEqual(formatted.exitCode, ExitCode.INVALID_ARGUMENT);
    assert.strictEqual(formatted.code, "INVALID_ARGUMENT");
    assert.strictEqual(formatted.message, "Invalid option --foo");
  });

  it("formats ExecutionError with code, message and details", () => {
    const err = new ExecutionError("Run failed", { step: 2 });
    assert.strictEqual(err.exitCode, ExitCode.FAILURE);
    assert.strictEqual(err.code, "EXECUTION_FAILURE");
    const formatted = formatError(err);
    assert.strictEqual(formatted.exitCode, ExitCode.FAILURE);
    assert.strictEqual(formatted.code, "EXECUTION_FAILURE");
    assert.deepStrictEqual(formatted.details, { step: 2 });
  });

  it("formats SigintError with 130 exit code", () => {
    const err = new SigintError();
    assert.strictEqual(err.exitCode, ExitCode.SIGINT);
    const formatted = formatError(err);
    assert.strictEqual(formatted.exitCode, ExitCode.SIGINT);
    assert.strictEqual(formatted.code, "SIGINT_INTERRUPTED");
  });

  it("formats generic Error as FAILURE", () => {
    const err = new Error("Database locked");
    const formatted = formatError(err);
    assert.strictEqual(formatted.exitCode, ExitCode.FAILURE);
    assert.strictEqual(formatted.code, "ERROR");
    assert.strictEqual(formatted.message, "Database locked");
  });
});

describe("CLI - Envelope & Renderer Utilities", () => {
  it("creates standard success and error envelopes", () => {
    const successEnv = createSuccessEnvelope({ count: 42 });
    assert.strictEqual(successEnv.ok, true);
    assert.deepStrictEqual(successEnv.data, { count: 42 });

    const errorEnv = createErrorEnvelope("FAIL", "Something went wrong", { id: 1 });
    assert.strictEqual(errorEnv.ok, false);
    assert.strictEqual(errorEnv.error?.code, "FAIL");
    assert.strictEqual(errorEnv.error?.message, "Something went wrong");
    assert.deepStrictEqual(errorEnv.error?.details, { id: 1 });
  });

  it("formats json with renderResult", () => {
    let out = "";
    renderResult({ key: "val" }, { json: true, context: { stdout: (m) => (out = m) } });
    assert.deepStrictEqual(JSON.parse(out), { key: "val" });
  });

  it("renders error in human and machine formats", () => {
    let errOut = "";
    renderError(new ArgumentError("Missing arg"), {
      context: { stderr: (m) => (errOut = m) },
    });
    assert.ok((errOut).includes("Error: Missing arg"));

    let jsonErrOut = "";
    renderError(new ArgumentError("Missing arg"), {
      json: true,
      context: { stdout: (m) => (jsonErrOut = m) },
    });
    const parsed = JSON.parse(jsonErrOut);
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.error.code, "INVALID_ARGUMENT");
  });

  it("renders action list with headers and items", () => {
    const rendered = renderActionList(
      [
        { id: "greet", description: "Greeting" },
        { id: "echo", description: "Echo input" },
      ],
      "Available Actions"
    );
    assert.ok((rendered).includes("Available Actions"));
    assert.ok((rendered).includes("greet"));
    assert.ok((rendered).includes("echo"));
  });

  it("renders action detail and validation summary", () => {
    const detail = renderActionDetail({
      id: "greet",
      description: "Greeting",
      inputSchema: { type: "object" },
    });
    assert.ok((detail).includes("greet"));
    assert.ok((detail).includes("Greeting"));

    const val = renderActionValidation([
      { id: "greet", valid: true, errors: [] },
      { id: "echo", valid: false, errors: ["Invalid schema"] },
    ]);
    assert.ok((val).includes("greet"));
    assert.ok((val).includes("Valid"));
    assert.ok((val).includes("Invalid schema"));
  });

  it("renders config, state, and runs list formats", () => {
    const cfg = renderConfigList([
      { key: "API_KEY", value: "secret", source: "local", secret: true },
      { key: "PORT", value: 3000, source: "default", secret: false },
    ]);
    assert.ok((cfg).includes("API_KEY"));
    assert.ok((cfg).includes("PORT"));

    const state = renderStateList(["sess:1"]);
    assert.ok((state).includes("sess:1"));

    const runs = renderRunsList([
      { id: "run-1", actionId: "greet", status: "success", startedAt: "2026-09-09T00:00:00Z" },
    ]);
    assert.ok((runs).includes("run-1"));
    assert.ok((runs).includes("greet"));
  });

  it("creates error envelope with hint at root level", () => {
    const errorEnv = createErrorEnvelope(
      "TEST_ERROR",
      "Something failed",
      { field: "val" },
      undefined,
      "Tip: Try fixing field"
    );
    assert.strictEqual(errorEnv.ok, false);
    assert.strictEqual(errorEnv.error?.code, "TEST_ERROR");
    assert.strictEqual(errorEnv.error?.message, "Something failed");
    assert.strictEqual(errorEnv.hint, "Tip: Try fixing field");
  });

  it("extracts hint from error details if not explicitly passed", () => {
    const errorEnv = createErrorEnvelope("TEST_ERROR", "Failed", {
      hint: "Hint: Self-healing tip",
    });
    assert.strictEqual(errorEnv.hint, "Hint: Self-healing tip");
  });

  it("renders error in human and machine formats with hint", () => {
    let errOut = "";
    const err = new ArgumentError("Invalid value", undefined, "INVALID_ARGUMENT", "Tip: Check docs");
    renderError(err, {
      context: { stderr: (m) => (errOut += m + "\n") },
    });
    assert.ok((errOut).includes("Error: Invalid value"));
    assert.ok((errOut).includes("Tip: Check docs"));

    let jsonErrOut = "";
    let jsonStderr = "";
    renderError(err, {
      json: true,
      context: {
        stdout: (m) => (jsonErrOut = m),
        stderr: (m) => (jsonStderr += m),
      },
    });
    assert.strictEqual(jsonStderr.trim(), "");
    const parsed = JSON.parse(jsonErrOut);
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.error.code, "INVALID_ARGUMENT");
    assert.strictEqual(parsed.error.message, "Invalid value");
    assert.strictEqual(parsed.hint, "Tip: Check docs");
  });

  it("renders action list with guidance tip for playbooks", () => {
    const rendered = renderActionList([
      { id: "greet", description: "Greeting" },
    ]);
    assert.ok((rendered).includes("Tip: For composite or multi-step tasks, check 'ad playbook list' for standard operating procedures."));
  });

  it("renders playbook list and detail with execution guidance tips", () => {
    const pbList = renderPlaybookList([
      { id: "deploy", description: "Deploy workflow" },
    ]);
    assert.ok((pbList).includes("deploy"));
    assert.ok((pbList).includes("Tip: Run 'ad playbook show <id>' to inspect procedure steps before execution."));

    const pbDetail = renderPlaybookDetail({
      id: "deploy",
      description: "Deploy workflow",
      actions: ["build", "publish"],
      content: "Step 1: build\nStep 2: publish",
    });
    assert.ok((pbDetail).includes("deploy"));
    assert.ok((pbDetail).includes("Tip: Follow steps sequentially. Invoke constituent actions using 'ad run <action> [options] -- <assignments...>'."));
  });

  it("renders project detail with config and playbooks before actions, full actions list, and guidance tips", () => {
    const detail = renderProjectDetail({
      id: "test.pkg",
      name: "Test Package",
      version: "1.0.0",
      description: "A test package",
      projectRoot: "/path/to/pkg",
      actionsDir: "actions",
      playbooksDir: "playbooks",
      actionsCount: 10,
      playbooksCount: 1,
      actions: [
        "act1", "act2", "act3", "act4", "act5", "act6", "act7", "act8", "act9", "act10"
      ],
      playbooks: ["flow1"],
      configDeclared: ["API_KEY"],
      configDef: {
        API_KEY: { description: "API Key", secret: true },
      },
    });

    // 检查布局顺序：Declared Config Keys 与 Playbooks 在 Actions 之前
    const configIdx = detail.indexOf("Declared Config Keys");
    const playbooksIdx = detail.indexOf("Playbooks (1):");
    const actionsIdx = detail.indexOf("Actions (10):");

    assert.ok((configIdx) > -1);
    assert.ok((playbooksIdx) > -1);
    assert.ok((actionsIdx) > -1);
    assert.ok((configIdx) < playbooksIdx);
    assert.ok((playbooksIdx) < actionsIdx);

    // 方案一：全量平铺展示所有动作，不截断
    assert.ok((detail).includes("act1"));
    assert.ok((detail).includes("act10"));
    assert.ok(!(detail).includes("more)"));

    // 检查底部提示
    assert.ok(!(detail).includes("Tip: Run 'ad list' to view all callable actions and run-ready IDs."));
    assert.ok((detail).includes("Tip: Run 'ad playbook show <id>' to inspect procedure steps before execution."));
    assert.ok((detail).includes("Tip: Run 'ad config set <KEY> <val>' to configure required settings."));
  });

  it("converts project detail info to structured json contract with aligned hints", () => {
    const info = {
      id: "test.pkg",
      name: "Test Package",
      version: "1.0.0",
      description: "A test package",
      projectRoot: "/path/to/pkg",
      actionsDir: "actions",
      playbooksDir: "playbooks",
      actionsCount: 2,
      playbooksCount: 1,
      actions: ["act1", "act2"],
      playbooks: ["flow1"],
      configDeclared: ["API_KEY"],
      configDef: {
        API_KEY: { description: "API Key", secret: true },
      },
      actionsMap: new Map([
        ["act1", { id: "act1", description: "First action" }],
        ["act2", { id: "act2", description: "Second action" }],
      ]),
      playbooksMap: new Map([
        ["flow1", { id: "flow1", description: "Deployment workflow" }],
      ]),
    };
    const json = projectDetailToJson(info as any);
    assert.deepStrictEqual(json, {
      id: "test.pkg",
      name: "Test Package",
      version: "1.0.0",
      description: "A test package",
      root: "/path/to/pkg",
      config: {
        API_KEY: {
          description: "API Key",
          secret: true,
        },
      },
      playbooks: [
        { id: "flow1", description: "Deployment workflow" },
      ],
      actions: [
        { id: "act1", description: "First action" },
        { id: "act2", description: "Second action" },
      ],
      hints: [
        "Tip: Run 'ad playbook show <id>' to inspect procedure steps before execution.",
        "Tip: Run 'ad config set <KEY> <val>' to configure required settings.",
      ],
    });
  });

  it("formats notInProjectError and packageNotFoundError with hints", () => {
    const nip = notInProjectError();
    const formattedNip = formatError(nip);
    assert.strictEqual(formattedNip.hint, 
      "Hint: Run 'ad init' to start a new project, specify '-P <id|path>' for an existing package, or run 'ad link <path>' to register it."
    );

    const pnf = packageNotFoundError("foo");
    const formattedPnf = formatError(pnf);
    assert.strictEqual(formattedPnf.hint, 
      "Hint: Package 'foo' not found. Run 'ad add foo' to install project dependency, or 'ad link <path>' for local development."
    );
  });
});

describe("CLI - Utils & Parameter Parsing", () => {
  it("resolves intent from options or positional patterns", () => {
    assert.strictEqual(resolveIntent("greet", []), "greet");
    assert.strictEqual(resolveIntent(undefined, ["foo", "bar"]), "foo|bar");
    assert.strictEqual(resolveIntent(undefined, []), undefined);
  });

  it("parses byte size strings", () => {
    assert.strictEqual(parseByteSize("1024"), 1024);
    assert.strictEqual(parseByteSize("1kb"), 1024);
    assert.strictEqual(parseByteSize("2MB"), 2 * 1024 * 1024);
    assert.strictEqual(parseByteSize("1GB"), 1024 * 1024 * 1024);
  });

  it("parses comma or space separated list options", () => {
    assert.deepStrictEqual(parseListOption("a,b,c", []), ["a", "b", "c"]);
    assert.deepStrictEqual(parseListOption("c,d", ["a", "b"]), ["a", "b", "c", "d"]);
  });

  it("extracts effective options from Commander command", () => {
    const rawOpts = { foo: "bar" };
    const fakeCmd = {
      optsWithGlobals: () => ({ json: true, dataDir: "/data" }),
    };
    const effective = getEffectiveOptions(rawOpts, fakeCmd as any);
    assert.strictEqual(effective.foo, "bar");
    assert.strictEqual(effective.json, true);
    assert.strictEqual(effective.dataDir, "/data");
  });
});
