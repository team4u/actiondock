import { parseConfigOverrideAssignment } from "../input/config-override";
export { parseConfigOverrideAssignment } from "../input/config-override";

export interface ParsedArgs {
  controlArgs: string[];
  actionArgs: string[];
  filteredArgs: string[];
  dataDir?: string;
  configOverrides: Record<string, unknown>;
  command: string;
  subArgs: string[];
}

export function parseStandaloneArgs(argv: string[]): ParsedArgs {
  const separator = argv.indexOf("--");
  const controlArgs = separator >= 0 ? argv.slice(0, separator) : argv;
  const actionArgs = separator >= 0 ? argv.slice(separator + 1) : [];

  let dataDir: string | undefined;
  const configOverrides: Record<string, unknown> = {};

  const filteredArgs: string[] = [];
  for (let i = 0; i < controlArgs.length; i++) {
    const arg = controlArgs[i];
    if (arg === "--data-dir" && i + 1 < controlArgs.length) {
      dataDir = controlArgs[++i];
    } else if (arg.startsWith("--data-dir=")) {
      dataDir = arg.slice(11);
    } else if (arg === "--config" || arg === "-c") {
      const pair = controlArgs[++i] ?? "";
      const { key, value } = parseConfigOverrideAssignment(pair);
      Object.defineProperty(configOverrides, key, { value, enumerable: true, writable: true, configurable: true });
    } else if (arg.startsWith("--config=")) {
      const pair = arg.slice(9);
      const { key, value } = parseConfigOverrideAssignment(pair);
      Object.defineProperty(configOverrides, key, { value, enumerable: true, writable: true, configurable: true });
    } else {
      filteredArgs.push(arg);
    }
  }

  const command = filteredArgs[0] || "help";
  const subArgs = filteredArgs.slice(1);

  return { controlArgs, actionArgs, filteredArgs, dataDir, configOverrides, command, subArgs };
}

export function printHelp(
  writeOut: (msg: string) => void,
  options: { packageId: string; version: string; description?: string }
): void {
  writeOut(`${options.packageId} (v${options.version})`);
  if (options.description) writeOut(`${options.description}\n`);
  writeOut("Usage:");
  writeOut("  <cmd> list [--json]                         List available actions");
  writeOut("  <cmd> describe <id> [--json]                Show action details and schemas");
  writeOut("  <cmd> run <id> [--input '<json>']           Execute action (raw text output by default)");
  writeOut("  <cmd> run <id> [--json]                     Output standard execution result in JSON format");
  writeOut("  <cmd> run <id> [--stdin-field <field>] [-- <assignments...>]");
  writeOut("                                             Bind raw stdin text to an input field");
  writeOut("  <cmd> config list/get/set/delete            Manage package configuration");
  writeOut("  <cmd> state list/get/set/delete             Manage shared state store");
  writeOut("\nGlobal options:");
  writeOut("  --data-dir <path>                           Custom runtime database directory");
  writeOut("  --config <KEY=val|KEY:=json>                Temporary config override");
}

export function emitError(
  writeOut: (msg: string) => void,
  writeErr: (msg: string) => void,
  isJson: boolean,
  code: string,
  message: string,
  exitCode: number,
  options?: { textMessage?: string; details?: unknown; hint?: string }
): number {
  if (isJson) {
    const details = options?.details;
    const hint =
      options?.hint ??
      (details && typeof details === "object" && typeof (details as any).hint === "string"
        ? (details as any).hint
        : undefined);
    writeOut(
      JSON.stringify(
        {
          ok: false,
          error: {
            code,
            message,
            ...(details !== undefined ? { details } : {}),
          },
          ...(hint !== undefined ? { hint } : {}),
        },
        null,
        2
      )
    );
  } else {
    writeErr(options?.textMessage ?? `Error: ${message}`);
  }
  return exitCode;
}
