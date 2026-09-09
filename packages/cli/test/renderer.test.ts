import { describe, expect, it } from "bun:test";
import {
  ArgumentError,
  CliError,
  ExecutionError,
  formatError,
  SigintError,
} from "../src/errors";
import {
  createErrorEnvelope,
  createSuccessEnvelope,
  formatJson,
  renderActionDetail,
  renderActionList,
  renderActionValidation,
  renderConfigList,
  renderError,
  renderProjectDetail,
  renderRegistryTree,
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
    expect(err.exitCode).toBe(ExitCode.INVALID_ARGUMENT);
    expect(err.code).toBe("INVALID_ARGUMENT");
    const formatted = formatError(err);
    expect(formatted.exitCode).toBe(ExitCode.INVALID_ARGUMENT);
    expect(formatted.code).toBe("INVALID_ARGUMENT");
    expect(formatted.message).toBe("Invalid option --foo");
  });

  it("formats ExecutionError with code, message and details", () => {
    const err = new ExecutionError("Run failed", { step: 2 });
    expect(err.exitCode).toBe(ExitCode.FAILURE);
    expect(err.code).toBe("EXECUTION_FAILURE");
    const formatted = formatError(err);
    expect(formatted.exitCode).toBe(ExitCode.FAILURE);
    expect(formatted.code).toBe("EXECUTION_FAILURE");
    expect(formatted.details).toEqual({ step: 2 });
  });

  it("formats SigintError with 130 exit code", () => {
    const err = new SigintError();
    expect(err.exitCode).toBe(ExitCode.SIGINT);
    const formatted = formatError(err);
    expect(formatted.exitCode).toBe(ExitCode.SIGINT);
    expect(formatted.code).toBe("SIGINT_INTERRUPTED");
  });

  it("formats generic Error as FAILURE", () => {
    const err = new Error("Database locked");
    const formatted = formatError(err);
    expect(formatted.exitCode).toBe(ExitCode.FAILURE);
    expect(formatted.code).toBe("ERROR");
    expect(formatted.message).toBe("Database locked");
  });
});

describe("CLI - Envelope & Renderer Utilities", () => {
  it("creates standard success and error envelopes", () => {
    const successEnv = createSuccessEnvelope({ count: 42 });
    expect(successEnv.ok).toBe(true);
    expect(successEnv.data).toEqual({ count: 42 });

    const errorEnv = createErrorEnvelope("FAIL", "Something went wrong", { id: 1 });
    expect(errorEnv.ok).toBe(false);
    expect(errorEnv.error?.code).toBe("FAIL");
    expect(errorEnv.error?.message).toBe("Something went wrong");
    expect(errorEnv.error?.details).toEqual({ id: 1 });
  });

  it("formats json and renders envelope vs raw json", () => {
    let out = "";
    renderResult({ key: "val" }, { json: true, context: { stdout: (m) => (out = m) } });
    expect(JSON.parse(out)).toEqual({ key: "val" });

    let envOut = "";
    renderResult({ key: "val" }, { envelope: true, context: { stdout: (m) => (envOut = m) } });
    const parsedEnv = JSON.parse(envOut);
    expect(parsedEnv.ok).toBe(true);
    expect(parsedEnv.data).toEqual({ key: "val" });
  });

  it("renders error in human and machine formats", () => {
    let errOut = "";
    renderError(new ArgumentError("Missing arg"), {
      context: { stderr: (m) => (errOut = m) },
    });
    expect(errOut).toContain("Error: Missing arg");

    let jsonErrOut = "";
    renderError(new ArgumentError("Missing arg"), {
      json: true,
      context: { stdout: (m) => (jsonErrOut = m) },
    });
    const parsed = JSON.parse(jsonErrOut);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
  });

  it("renders action list with headers and items", () => {
    const rendered = renderActionList(
      [
        { id: "greet", description: "Greeting" },
        { id: "echo", description: "Echo input" },
      ],
      "Available Actions"
    );
    expect(rendered).toContain("Available Actions");
    expect(rendered).toContain("greet");
    expect(rendered).toContain("echo");
  });

  it("renders action detail and validation summary", () => {
    const detail = renderActionDetail({
      id: "greet",
      description: "Greeting",
      inputSchema: { type: "object" },
    });
    expect(detail).toContain("greet");
    expect(detail).toContain("Greeting");

    const val = renderActionValidation([
      { id: "greet", valid: true, errors: [] },
      { id: "echo", valid: false, errors: ["Invalid schema"] },
    ]);
    expect(val).toContain("greet");
    expect(val).toContain("Valid");
    expect(val).toContain("Invalid schema");
  });

  it("renders config, state, and runs list formats", () => {
    const cfg = renderConfigList([
      { key: "API_KEY", value: "secret", source: "local", secret: true },
      { key: "PORT", value: 3000, source: "default", secret: false },
    ]);
    expect(cfg).toContain("API_KEY");
    expect(cfg).toContain("PORT");

    const state = renderStateList(["sess:1"]);
    expect(state).toContain("sess:1");

    const runs = renderRunsList([
      { id: "run-1", actionId: "greet", status: "success", startedAt: "2026-09-09T00:00:00Z" },
    ]);
    expect(runs).toContain("run-1");
    expect(runs).toContain("greet");
  });
});

describe("CLI - Utils & Parameter Parsing", () => {
  it("resolves intent from options or positional patterns", () => {
    expect(resolveIntent("greet", [])).toBe("greet");
    expect(resolveIntent(undefined, ["foo", "bar"])).toBe("foo|bar");
    expect(resolveIntent(undefined, [])).toBeUndefined();
  });

  it("parses byte size strings", () => {
    expect(parseByteSize("1024")).toBe(1024);
    expect(parseByteSize("1kb")).toBe(1024);
    expect(parseByteSize("2MB")).toBe(2 * 1024 * 1024);
    expect(parseByteSize("1GB")).toBe(1024 * 1024 * 1024);
  });

  it("parses comma or space separated list options", () => {
    expect(parseListOption("a,b,c", [])).toEqual(["a", "b", "c"]);
    expect(parseListOption("c,d", ["a", "b"])).toEqual(["a", "b", "c", "d"]);
  });

  it("extracts effective options from Commander command", () => {
    const rawOpts = { foo: "bar" };
    const fakeCmd = {
      optsWithGlobals: () => ({ json: true, dataDir: "/data" }),
    };
    const effective = getEffectiveOptions(rawOpts, fakeCmd as any);
    expect(effective.foo).toBe("bar");
    expect(effective.json).toBe(true);
    expect(effective.dataDir).toBe("/data");
  });
});
