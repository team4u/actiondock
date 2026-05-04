import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ActionDockCliError } from "../src/lib/error.js";
import { runRuntimeCommand } from "../src/lib/runtime.js";

const originalPath = process.env.PATH;

afterEach(() => {
  process.env.PATH = originalPath;
});

describe("runtime command bridge", () => {
  it("runs jDeploy runtime commands through PATH", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "actiondock-runtime-test-"));
    const argsFile = path.join(tempDir, "args.txt");
    const command = process.platform === "win32" ? "actiondock-runtime.cmd" : "actiondock-runtime";
    const executable = path.join(tempDir, command);

    if (process.platform === "win32") {
      fs.writeFileSync(executable, `@echo off\r\necho %* > "${argsFile}"\r\nexit /b 0\r\n`, "utf8");
    } else {
      fs.writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\n`, "utf8");
      fs.chmodSync(executable, 0o755);
    }

    process.env.PATH = `${tempDir}${path.delimiter}${originalPath ?? ""}`;

    await expect(runRuntimeCommand("actiondock-runtime", ["service", "status"]))
      .resolves.toBe(0);

    const output = fs.readFileSync(argsFile, "utf8");
    if (process.platform === "win32") {
      expect(output.trim()).toBe("service status");
    } else {
      expect(output.trim().split("\n")).toEqual(["service", "status"]);
    }
  });

  it("wraps missing runtime command errors", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "actiondock-runtime-missing-"));
    process.env.PATH = tempDir;

    await expect(runRuntimeCommand("actiondock-runtime", []))
      .rejects.toThrow(ActionDockCliError);
  });
});
