import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ActionDockCliError, isRecord } from "./error.js";
const DEFAULT_SERVER_URL = "http://127.0.0.1:5177";
function configDir() {
    if (process.platform === "win32") {
        return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "actiondock");
    }
    if (process.platform === "darwin") {
        return path.join(os.homedir(), "Library", "Application Support", "actiondock");
    }
    return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "actiondock");
}
export function configPath() {
    return path.join(configDir(), "config.json");
}
export function readConfig() {
    const file = configPath();
    if (!fs.existsSync(file)) {
        return {};
    }
    const text = fs.readFileSync(file, "utf8");
    if (!text.trim()) {
        return {};
    }
    const parsed = JSON.parse(text);
    if (!isRecord(parsed)) {
        throw new ActionDockCliError(`配置文件格式非法: ${file}`, 2);
    }
    return {
        serverUrl: typeof parsed.serverUrl === "string" ? parsed.serverUrl : undefined,
        token: typeof parsed.token === "string" ? parsed.token : undefined
    };
}
export function writeConfig(config) {
    const file = configPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
export function setConfigValue(key, value) {
    const current = readConfig();
    const next = { ...current, [key]: value };
    writeConfig(next);
    return next;
}
export function clearConfigValue(key) {
    const current = readConfig();
    const next = { ...current };
    delete next[key];
    writeConfig(next);
    return next;
}
export function resolveServerUrl(flagValue) {
    return normalizeServerUrl(flagValue ?? process.env.ACTIONDOCK_BASE_URL ?? readConfig().serverUrl) ?? DEFAULT_SERVER_URL;
}
export function resolveToken(flagValue) {
    const token = flagValue ?? process.env.ACTIONDOCK_TOKEN ?? readConfig().token;
    return token?.trim() ? token.trim() : undefined;
}
export function normalizeServerUrl(value) {
    if (!value?.trim()) {
        return undefined;
    }
    return value.trim().replace(/\/+$/, "");
}
export function buildConfigView(config) {
    return {
        path: configPath(),
        serverUrl: normalizeServerUrl(config.serverUrl),
        tokenConfigured: Boolean(config.token?.trim())
    };
}
