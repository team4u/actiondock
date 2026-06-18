/**
 * Lowercased key substrings whose values should be masked as {@code "***"}.
 */
const SECRET_KEY_HINTS = [
    "token",
    "tokenvalue",
    "accesstoken",
    "refreshtoken",
    "authorization",
    "password",
    "secret",
    "apikey",
    "privatekey",
    "credential"
];
function isSecretKey(key) {
    const lower = key.toLowerCase();
    return SECRET_KEY_HINTS.some((hint) => lower.includes(hint));
}
/**
 * Recursively mask secret-looking values inside {@code input}.
 *
 * <p>When {@code enabled} is {@code false} the value is returned unchanged.
 * Object keys whose lowercased name contains any of the configured secret hints
 * have their value replaced with {@code "***"}; nested objects and arrays are
 * traversed; primitives are returned as-is.
 */
export function redactSecrets(input, enabled) {
    if (!enabled) {
        return input;
    }
    if (Array.isArray(input)) {
        return input.map((item) => redactSecrets(item, true));
    }
    if (input !== null && typeof input === "object") {
        const result = {};
        for (const [key, value] of Object.entries(input)) {
            result[key] = isSecretKey(key) ? "***" : redactSecrets(value, true);
        }
        return result;
    }
    return input;
}
