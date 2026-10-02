import { runCommandSync, whichExecutable } from "../../../scripts/lib/spawn-helper.mjs";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");

let tempHome: string | undefined;

function runCli(
  args: string[],
  cwd?: string,
  stdinInput?: string | Buffer,
  env?: Record<string, string>
) {
  return runCommandSync(["bun", cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}),
      ...env,
    },
    stdin: stdinInput !== undefined ? (Buffer.isBuffer(stdinInput) ? stdinInput : Buffer.from(stdinInput)) : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("CLI Action Input Resolution - Shell Pipes and Platforms", () => {
  let tempDir: string;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-cli-input-shells-test-"));
    tempHome = mkdtempSync(join(tmpdir(), "ad-cli-input-shells-home-"));

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
      } catch {}
    }

    // Initialize project
    const initProc = runCli(["init", "--id", "test.input-pkg", "--name", "Input Pkg", "."], tempDir);
    assert.strictEqual(initProc.exitCode, 0);

    // Create an echo action that returns the exact received input
    const echoActionSource = `import { defineAction } from "@actiondock/sdk";
export default defineAction(async (input: any) => {
  return { received: input };
});
`;
    writeFileSync(join(tempDir, "actions", "echo.ts"), echoActionSource, "utf-8");

    // Register echo action in actiondock.json
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
      } catch {
        await new Promise((r) => setTimeout(r, 200));
        try {
          rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        } catch {}
      }
    }
  });

  // 15. PowerShell 调用
  it("supports PowerShell pipe invocation when pwsh / powershell is available", () => {
    const pwshBin = whichExecutable("pwsh") || whichExecutable("powershell");
    if (!pwshBin) {
      // If PowerShell is not installed in the environment, test child process piped simulation
      const pipedData = JSON.stringify({ powerShell: true, author: "PowerShellSimulated" });
      const proc = runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, pipedData);
      assert.strictEqual(proc.exitCode, 0);
      const res = JSON.parse(proc.stdout.toString());
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.data.received.author, "PowerShellSimulated");
      return;
    }

    const command = `$data = @{ powerShell = $true; author = 'PowerShellUser' }; $data | ConvertTo-Json -Compress | node "${cliPath}" run test.echo --input-file - --json`;
    const res = spawnSync(pwshBin, ["-NoProfile", "-NonInteractive", "-Command", command], {
      cwd: tempDir,
      env: { ...process.env, ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}) },
      encoding: "utf-8",
    });
    assert.strictEqual(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.data.received.author, "PowerShellUser");
  });

  // 16. cmd.exe 调用
  it("supports cmd.exe invocation when cmd is available", () => {
    const cmdBin = whichExecutable("cmd.exe") || whichExecutable("cmd");
    if (!cmdBin || process.platform !== "win32") {
      // If cmd.exe is not available (e.g. on Linux), verify pipe simulation behavior
      const cmdData = JSON.stringify({ cmd: true, author: "CmdSimulated" });
      const proc = runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, cmdData);
      assert.strictEqual(proc.exitCode, 0);
      const res = JSON.parse(proc.stdout.toString());
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.data.received.author, "CmdSimulated");
      return;
    }

    const inputPath = join(tempDir, "cmd-input.json");
    writeFileSync(inputPath, JSON.stringify({ cmd: true, author: "CmdUser" }), "utf-8");
    const cmdCommand = `type "${inputPath}" | node "${cliPath}" run test.echo --input-file - --json`;
    const res = spawnSync(cmdBin, ["/d", "/s", "/c", `"${cmdCommand}"`], {
      cwd: tempDir,
      env: { ...process.env, ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}) },
      encoding: "utf-8",
      windowsVerbatimArguments: true,
    });
    assert.strictEqual(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.data.received.author, "CmdUser");
  });

  // 17. Bash / zsh 调用
  it("supports Bash and zsh pipe and inline JSON invocations", () => {
    if (process.platform === "win32") {
      // Bash and zsh are POSIX shells; on Windows verify pipe simulation behavior
      const shellData = JSON.stringify({ fromShell: true, simulated: true });
      const proc = runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, shellData);
      assert.strictEqual(proc.exitCode, 0);
      const res = JSON.parse(proc.stdout.toString());
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.data.received.fromShell, true);
      return;
    }

    const bashBin = whichExecutable("bash");
    const zshBin = whichExecutable("zsh");

    if (!bashBin && !zshBin) {
      const shellData = JSON.stringify({ fromShell: true, simulated: true });
      const proc = runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, shellData);
      assert.strictEqual(proc.exitCode, 0);
      const res = JSON.parse(proc.stdout.toString());
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.data.received.fromShell, true);
      return;
    }

    const inputPath = join(tempDir, "shell-input.json");
    writeFileSync(inputPath, JSON.stringify({ fromShell: true }), "utf-8");

    if (bashBin) {
      // Inline JSON in Bash
      const inlineCmd = `node "${cliPath}" run test.echo --input '{"shell":"bash-inline"}' --json`;
      const bashInlineRes = spawnSync(bashBin, ["-c", inlineCmd], {
        cwd: tempDir,
        env: { ...process.env, ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}) },
        encoding: "utf-8",
      });
      assert.strictEqual(bashInlineRes.status, 0);
      const parsedInline = JSON.parse(bashInlineRes.stdout);
      assert.strictEqual(parsedInline.ok, true);
      assert.strictEqual(parsedInline.data.received.shell, "bash-inline");

      // Stdin pipe in Bash
      const pipeCmd = `cat "${inputPath}" | node "${cliPath}" run test.echo --input-file - --json`;
      const bashPipeRes = spawnSync(bashBin, ["-c", pipeCmd], {
        cwd: tempDir,
        env: { ...process.env, ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}) },
        encoding: "utf-8",
      });
      assert.strictEqual(bashPipeRes.status, 0);
      const parsedPipe = JSON.parse(bashPipeRes.stdout);
      assert.strictEqual(parsedPipe.ok, true);
      assert.strictEqual(parsedPipe.data.received.fromShell, true);
    }

    if (zshBin) {
      // Inline JSON in Zsh
      const inlineCmd = `node "${cliPath}" run test.echo --input '{"shell":"zsh-inline"}' --json`;
      const zshInlineRes = spawnSync(zshBin, ["-c", inlineCmd], {
        cwd: tempDir,
        env: { ...process.env, ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}) },
        encoding: "utf-8",
      });
      assert.strictEqual(zshInlineRes.status, 0);
      const parsedInline = JSON.parse(zshInlineRes.stdout);
      assert.strictEqual(parsedInline.ok, true);
      assert.strictEqual(parsedInline.data.received.shell, "zsh-inline");

      // Stdin pipe in Zsh
      const pipeCmd = `cat "${inputPath}" | node "${cliPath}" run test.echo --input-file - --json`;
      const zshPipeRes = spawnSync(zshBin, ["-c", pipeCmd], {
        cwd: tempDir,
        env: { ...process.env, ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}) },
        encoding: "utf-8",
      });
      assert.strictEqual(zshPipeRes.status, 0);
      const parsedPipe = JSON.parse(zshPipeRes.stdout);
      assert.strictEqual(parsedPipe.ok, true);
      assert.strictEqual(parsedPipe.data.received.fromShell, true);
    }
  });
});
