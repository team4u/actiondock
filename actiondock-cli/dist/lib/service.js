import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ActionDockCliError } from "./error.js";
const SERVICE_NAME = "actiondock";
const MAC_LABEL = "org.team4u.actiondock";
export async function runServiceAction(action, args) {
    if (process.platform === "darwin") {
        return await runMacServiceAction(action, args);
    }
    if (process.platform === "linux") {
        return await runLinuxServiceAction(action, args);
    }
    throw new ActionDockCliError("ActionDock service management is currently supported on macOS and Linux only. Use `actiondock server` on this platform.", 2);
}
async function runMacServiceAction(action, args) {
    const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${MAC_LABEL}.plist`);
    const logsDir = path.join(os.homedir(), "Library", "Logs", "ActionDock");
    switch (action) {
        case "install":
            mkdirSync(path.dirname(plistPath), { recursive: true });
            mkdirSync(logsDir, { recursive: true });
            writeFileSync(plistPath, macPlist(args, logsDir), "utf8");
            return await run("launchctl", ["bootstrap", `gui/${process.getuid?.() ?? ""}`, plistPath], { allowFailure: true });
        case "start":
            return await run("launchctl", ["kickstart", "-k", `gui/${process.getuid?.() ?? ""}/${MAC_LABEL}`]);
        case "stop":
            return await run("launchctl", ["bootout", `gui/${process.getuid?.() ?? ""}/${MAC_LABEL}`], { allowFailure: true });
        case "status":
            return await run("launchctl", ["print", `gui/${process.getuid?.() ?? ""}/${MAC_LABEL}`], { allowFailure: true });
        case "restart": {
            await runMacServiceAction("stop", []);
            return await runMacServiceAction("start", []);
        }
        case "uninstall":
            await runMacServiceAction("stop", []);
            rmSync(plistPath, { force: true });
            return 0;
    }
}
async function runLinuxServiceAction(action, args) {
    const serviceDir = path.join(os.homedir(), ".config", "systemd", "user");
    const servicePath = path.join(serviceDir, `${SERVICE_NAME}.service`);
    switch (action) {
        case "install":
            mkdirSync(serviceDir, { recursive: true });
            writeFileSync(servicePath, linuxUnit(args), "utf8");
            await run("systemctl", ["--user", "daemon-reload"]);
            return await run("systemctl", ["--user", "enable", SERVICE_NAME]);
        case "start":
            return await run("systemctl", ["--user", "start", SERVICE_NAME]);
        case "stop":
            return await run("systemctl", ["--user", "stop", SERVICE_NAME], { allowFailure: true });
        case "status":
            return await run("systemctl", ["--user", "status", SERVICE_NAME], { allowFailure: true });
        case "restart":
            return await run("systemctl", ["--user", "restart", SERVICE_NAME]);
        case "uninstall":
            await run("systemctl", ["--user", "disable", "--now", SERVICE_NAME], { allowFailure: true });
            rmSync(servicePath, { force: true });
            return await run("systemctl", ["--user", "daemon-reload"]);
    }
}
function macPlist(args, logsDir) {
    const runtime = runtimeExecutable();
    const programArguments = [runtime, ...args].map((value) => `    <string>${escapeXml(value)}</string>`).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${MAC_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(logsDir, "service.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(logsDir, "service.err.log"))}</string>
</dict>
</plist>
`;
}
function linuxUnit(args) {
    const execStart = [runtimeExecutable(), ...args].map(quoteSystemdArg).join(" ");
    return `[Unit]
Description=ActionDock local runtime
After=network.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}
function runtimeExecutable() {
    const executable = process.platform === "win32" ? "actiondock-runtime.cmd" : "actiondock-runtime";
    const localRuntime = path.resolve(path.dirname(process.argv[1] ?? ""), executable);
    if (existsSync(localRuntime)) {
        return localRuntime;
    }
    return executable;
}
function quoteSystemdArg(value) {
    return value.includes(" ") ? `"${value.replaceAll("\"", "\\\"")}"` : value;
}
function escapeXml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&apos;");
}
async function run(command, args, options = {}) {
    return await new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: "inherit",
        });
        child.on("error", (error) => {
            reject(new ActionDockCliError(`Unable to run ${command}: ${error.message}`, 1));
        });
        child.on("close", (code, signal) => {
            if (signal) {
                reject(new ActionDockCliError(`${command} was terminated by signal: ${signal}`, 1));
                return;
            }
            const exitCode = code ?? 1;
            if (exitCode !== 0 && !options.allowFailure) {
                reject(new ActionDockCliError(`${command} exited with code ${exitCode}`, exitCode));
                return;
            }
            resolve(exitCode);
        });
    });
}
