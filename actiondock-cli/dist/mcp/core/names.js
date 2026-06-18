/**
 * Normalize an arbitrary value (typically a script id) into a tool-name-safe
 * fragment: lowercased ASCII, non {@code [a-z0-9_]} runs collapsed to a single
 * underscore, leading/trailing underscores stripped.
 */
export function toToolSafeName(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/_+/g, "_");
}
/**
 * Parse a CSV string into a trimmed, de-duplicated-by-position list of non-empty
 * entries. {@code undefined} / empty input yields an empty array.
 */
export function splitCsv(value) {
    if (!value) {
        return [];
    }
    return value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}
/**
 * Decide whether {@code scriptId} may be exposed as a dynamic tool under the
 * given policy.
 *
 * <p>Rules:
 * <ul>
 *   <li>If {@code deniedScripts} contains the id, reject.</li>
 *   <li>If {@code allowedScripts} is non-empty, only ids in that list pass;
 *       otherwise all (non-denied) ids pass.</li>
 * </ul>
 */
export function isScriptAllowed(scriptId, policy) {
    if (policy.deniedScripts.includes(scriptId)) {
        return false;
    }
    if (policy.allowedScripts.length > 0) {
        return policy.allowedScripts.includes(scriptId);
    }
    return true;
}
