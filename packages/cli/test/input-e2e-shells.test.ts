import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
setDefaultTimeout(120000);
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
  return Bun.spawnSync(["bun", cliPath, ...args], {
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

  beforeAll(() => {
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
    expect(initProc.exitCode).toBe(0);

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

  afterAll(async () => {
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
    const pwshBin = Bun.which("pwsh") || Bun.which("powershell");
    if (!pwshBin) {
      // If PowerShell is not installed in the environment, test child process piped simulation
      const pipedData = JSON.stringify({ powerShell: true, author: "PowerShellSimulated" });
      const proc = runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, pipedData);
      expect(proc.exitCode).toBe(0);
      const res = JSON.parse(proc.stdout.toString());
      expect(res.ok).toBe(true);
      expect(res.data.received.author).toBe("PowerShellSimulated");
      return;
    }

    const command = `$data = @{ powerShell = $true; author = 'PowerShellUser' }; $data | ConvertTo-Json -Compress | node "${cliPath}" run test.echo --input-file - --json`;
    const res = spawnSync(pwshBin, ["-NoProfile", "-NonInteractive", "-Command", command], {
      cwd: tempDir,
      env: { ...process.env, ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}) },
      encoding: "utf-8",
    });
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.received.author).toBe("PowerShellUser");
  });

  // 16. cmd.exe 调用
  it("supports cmd.exe invocation when cmd is available", () => {
    const cmdBin = Bun.which("cmd.exe") || Bun.which("cmd");
    if (!cmdBin || process.platform !== "win32") {
      // If cmd.exe is not available (e.g. on Linux), verify pipe simulation behavior
      const cmdData = JSON.stringify({ cmd: true, author: "CmdSimulated" });
      const proc = runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, cmdData);
      expect(proc.exitCode).toBe(0);
      const res = JSON.parse(proc.stdout.toString());
      expect(res.ok).toBe(true);
      expect(res.data.received.author).toBe("CmdSimulated");
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
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.received.author).toBe("CmdUser");
  });

  // 17. Bash / zsh 调用
  it("supports Bash and zsh pipe and inline JSON invocations", () => {
    if (process.platform === "win32") {
      // Bash and zsh are POSIX shells; on Windows verify pipe simulation behavior
      const shellData = JSON.stringify({ fromShell: true, simulated: true });
      const proc = runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, shellData);
      expect(proc.exitCode).toBe(0);
      const res = JSON.parse(proc.stdout.toString());
      expect(res.ok).toBe(true);
      expect(res.data.received.fromShell).toBe(true);
      return;
    }

    const bashBin = Bun.which("bash");
    const zshBin = Bun.which("zsh");

    if (!bashBin && !zshBin) {
      const shellData = JSON.stringify({ fromShell: true, simulated: true });
      const proc = runCli(["run", "test.echo", "--input-file", "-", "--json"], tempDir, shellData);
      expect(proc.exitCode).toBe(0);
      const res = JSON.parse(proc.stdout.toString());
      expect(res.ok).toBe(true);
      expect(res.data.received.fromShell).toBe(true);
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
      expect(bashInlineRes.status).toBe(0);
      const parsedInline = JSON.parse(bashInlineRes.stdout);
      expect(parsedInline.ok).toBe(true);
      expect(parsedInline.data.received.shell).toBe("bash-inline");

      // Stdin pipe in Bash
      const pipeCmd = `cat "${inputPath}" | node "${cliPath}" run test.echo --input-file - --json`;
      const bashPipeRes = spawnSync(bashBin, ["-c", pipeCmd], {
        cwd: tempDir,
        env: { ...process.env, ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}) },
        encoding: "utf-8",
      });
      expect(bashPipeRes.status).toBe(0);
      const parsedPipe = JSON.parse(bashPipeRes.stdout);
      expect(parsedPipe.ok).toBe(true);
      expect(parsedPipe.data.received.fromShell).toBe(true);
    }

    if (zshBin) {
      // Inline JSON in Zsh
      const inlineCmd = `node "${cliPath}" run test.echo --input '{"shell":"zsh-inline"}' --json`;
      const zshInlineRes = spawnSync(zshBin, ["-c", inlineCmd], {
        cwd: tempDir,
        env: { ...process.env, ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}) },
        encoding: "utf-8",
      });
      expect(zshInlineRes.status).toBe(0);
      const parsedInline = JSON.parse(zshInlineRes.stdout);
      expect(parsedInline.ok).toBe(true);
      expect(parsedInline.data.received.shell).toBe("zsh-inline");

      // Stdin pipe in Zsh
      const pipeCmd = `cat "${inputPath}" | node "${cliPath}" run test.echo --input-file - --json`;
      const zshPipeRes = spawnSync(zshBin, ["-c", pipeCmd], {
        cwd: tempDir,
        env: { ...process.env, ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}) },
        encoding: "utf-8",
      });
      expect(zshPipeRes.status).toBe(0);
      const parsedPipe = JSON.parse(zshPipeRes.stdout);
      expect(parsedPipe.ok).toBe(true);
      expect(parsedPipe.data.received.fromShell).toBe(true);
    }
  });
});
