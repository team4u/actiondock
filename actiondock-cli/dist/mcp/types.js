/**
 * Sensible default policy: execute + dynamic tools enabled, write + admin
 * disabled, 200 KB result cap, secret redaction on, empty allow/deny lists.
 */
export function defaultPolicy() {
    return {
        enableExecuteTools: true,
        enableWriteTools: false,
        enableAdminTools: false,
        enableDynamicTools: true,
        allowedScripts: [],
        deniedScripts: [],
        maxResultBytes: 200_000,
        redactSecrets: true
    };
}
