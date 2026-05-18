import { describe, expect, it } from "vitest";

import {
  SKIP_NEW_VERSION_CHECK_ENV,
  applyNewVersionCheckEnvironment,
  hasExplicitSkipNewVersionCheck,
  shouldSkipNewVersionCheckByDefault,
} from "../bin/update-env.js";

describe("update check environment", () => {
  it("keeps explicit skip setting untouched", () => {
    const env = { [SKIP_NEW_VERSION_CHECK_ENV]: "0" };

    const result = applyNewVersionCheckEnvironment({
      env,
      stdinIsTTY: false,
      stdoutIsTTY: false,
      stderrIsTTY: false,
    });

    expect(result).toBe(env);
    expect(result[SKIP_NEW_VERSION_CHECK_ENV]).toBe("0");
    expect(hasExplicitSkipNewVersionCheck(env)).toBe(true);
  });

  it("skips checks by default in ci", () => {
    expect(
      shouldSkipNewVersionCheckByDefault({
        env: { CI: "true" },
        stdinIsTTY: true,
        stdoutIsTTY: true,
        stderrIsTTY: true,
      }),
    ).toBe(true);
  });

  it("skips checks by default when not attached to a tty", () => {
    expect(
      shouldSkipNewVersionCheckByDefault({
        env: {},
        stdinIsTTY: true,
        stdoutIsTTY: false,
        stderrIsTTY: true,
      }),
    ).toBe(true);
  });

  it("keeps checks enabled in an interactive local shell", () => {
    const env = {};

    const result = applyNewVersionCheckEnvironment({
      env,
      stdinIsTTY: true,
      stdoutIsTTY: true,
      stderrIsTTY: true,
    });

    expect(result).toBe(env);
    expect(result[SKIP_NEW_VERSION_CHECK_ENV]).toBeUndefined();
  });

  it("forces checks off for development entrypoints", () => {
    const env = {};

    applyNewVersionCheckEnvironment({
      env,
      forceSkip: true,
      stdinIsTTY: true,
      stdoutIsTTY: true,
      stderrIsTTY: true,
    });

    expect(env[SKIP_NEW_VERSION_CHECK_ENV]).toBe("1");
  });

});
