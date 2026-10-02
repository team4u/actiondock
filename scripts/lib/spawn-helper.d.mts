import type { ChildProcess } from "node:child_process";

export interface RunCommandSyncOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string | Buffer;
  input?: string | Buffer;
  timeout?: number;
  stdout?: "pipe" | "ignore" | "inherit";
  stderr?: "pipe" | "ignore" | "inherit";
  stdio?: ("pipe" | "ignore" | "inherit")[] | string;
}

export interface RunCommandResult {
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
  signalCode: NodeJS.Signals | null;
}

export interface StartCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: ("pipe" | "ignore" | "inherit")[] | string;
  stdin?: boolean;
  stdout?: boolean | "pipe" | "ignore" | "inherit";
  stderr?: boolean | "pipe" | "ignore" | "inherit";
  detached?: boolean;
}

export function runCommandSync(
  cmdArray: string[],
  options?: RunCommandSyncOptions
): RunCommandResult;

export function startCommand(
  cmdArray: string[],
  options?: StartCommandOptions
): ChildProcess & { exited: Promise<number> };

export function whichExecutable(command: string): string | null;
