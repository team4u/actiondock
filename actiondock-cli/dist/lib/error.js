export class ActionDockCliError extends Error {
    exitCode;
    details;
    constructor(message, exitCode = 2, details) {
        super(message);
        this.name = "ActionDockCliError";
        this.exitCode = exitCode;
        this.details = details;
    }
}
export function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
