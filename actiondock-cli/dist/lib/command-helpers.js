import fs from "node:fs";
import path from "node:path";
import { Flags } from "@oclif/core";
import { ActionDockClient } from "./client.js";
import { resolveServerUrl, resolveToken } from "./config.js";
import { ActionDockCliError } from "./error.js";
import { parseInputObject } from "./input.js";
export function createClient(flags) {
    return new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
    });
}
export const serverTokenFlags = {
    profile: Flags.string({
        description: "Use a configured server profile"
    }),
    server: Flags.string({
        description: "Override ActionDock server URL"
    }),
    token: Flags.string({
        description: "Override ActionDock bearer token"
    })
};
export const intentFlag = Flags.string({
    description: "Regex filter for list intent; falls back to the full list when no item matches"
});
export async function listWithIntentFallback(intent, fetchWithIntent) {
    if (!intent) {
        return fetchWithIntent(undefined);
    }
    const matched = await fetchWithIntent(intent);
    return matched.length === 0 ? fetchWithIntent(undefined) : matched;
}
export const jsonObjectFlags = (name, description) => ({
    [`${name}-json`]: Flags.string({
        description: `Inline JSON object for ${description}`
    }),
    [`${name}-file`]: Flags.string({
        description: `Path to a JSON file containing ${description}`
    })
});
export function parseNamedObject(flags, name, _label) {
    const json = flags[`${name}-json`];
    const file = flags[`${name}-file`];
    return parseInputObject(typeof json === "string" ? json : undefined, typeof file === "string" ? file : undefined, {
        jsonFlag: `\`--${name}-json\``,
        fileFlag: `\`--${name}-file\``
    });
}
export function buildRepositoryInstallRequest(flags) {
    return {
        installSchedules: Boolean(flags["install-schedules"]),
        installScriptDependencies: Boolean(flags["install-script-dependencies"]),
        installPluginDependencies: Boolean(flags["install-plugin-dependencies"]),
        forcePluginUpgrade: Boolean(flags["force-plugin-upgrade"])
    };
}
export function resolveOutputPath(output, defaultFilename, force = false) {
    const target = output ?? defaultFilename;
    const stat = fs.existsSync(target) ? fs.statSync(target) : undefined;
    const outputPath = stat?.isDirectory() ? path.join(target, defaultFilename) : target;
    if (!force && fs.existsSync(outputPath)) {
        throw new ActionDockCliError(`输出文件已存在: ${outputPath}。如需覆盖请加 --force。`, 2);
    }
    return outputPath;
}
export function readDefinitionFile(definitionFile) {
    const text = fs.readFileSync(definitionFile, "utf8");
    try {
        return JSON.parse(text);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new ActionDockCliError(`definition file 不是合法 JSON: ${detail}`, 2);
    }
}
