export class ActionDockCliError extends Error {
  readonly exitCode: number;
  readonly details?: unknown;

  constructor(message: string, exitCode = 2, details?: unknown) {
    super(message);
    this.name = "ActionDockCliError";
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
