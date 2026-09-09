import { fetchRemoteDoctor, resolveTarget, runDoctorChecks } from "@actiondock/core";
import { Command } from "commander";
import { ExecutionError } from "../errors";
import { renderResult } from "../renderer";
import { getEffectiveOptions } from "../utils";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check ActionDock environment, registry health, and project diagnostics")
    .option("-P, --package <id|path>", "Target package ID or directory path for project diagnostics")
    .option("-p, --profile <name>", "Query doctor diagnostics on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--json", "Output diagnostics report in JSON format")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (rawOptions, cmd) => {
      try {
        const options = getEffectiveOptions(rawOptions, cmd);
        const target = resolveTarget({
          profile: options.profile,
          server: options.server,
          token: options.token,
        });

        let report;
        if (target.type === "remote") {
          const remoteRes = await fetchRemoteDoctor(target.serverUrl!, target.token, options.package);
          report = remoteRes.report || remoteRes;
        } else {
          report = await runDoctorChecks({
            packageIdOrPath: options.package,
          });
        }

        renderResult(report, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => {
            const lines: string[] = [];
            const title = target.type === "remote"
              ? `[DOCTOR] Remote ActionDock Server Diagnostics (${target.serverUrl}${target.profileName ? ` - Profile: ${target.profileName}` : ""})\n`
              : "[DOCTOR] ActionDock System & Project Diagnostics\n";
            lines.push(title);

            // 1. Runtime & Environment Group
            lines.push("[Runtime & Environment]");
            const envChecks = (report.checks || []).filter((c: any) => c.category === "runtime" || c.category === "storage" || c.category === "registry");
            for (const c of envChecks) {
              const tag = c.status === "ok" ? "[OK]" : c.status === "warn" ? "[WARN]" : "[ERROR]";
              lines.push(`  ${tag} ${c.name}: ${c.message}`);
              if (c.fix) {
                lines.push(`       Fix: ${c.fix}`);
              }
            }

            // 2. Project Group
            if (report.hasProject) {
              lines.push(`\n[Project: ${report.packageId || "unknown"}] (${report.projectRoot})`);
              const projChecks = (report.checks || []).filter((c: any) => c.category === "project");
              for (const c of projChecks) {
                const tag = c.status === "ok" ? "[OK]" : c.status === "warn" ? "[WARN]" : "[ERROR]";
                lines.push(`  ${tag} ${c.name}: ${c.message}`);
                if (c.fix) {
                  lines.push(`       Fix: ${c.fix}`);
                }
              }
            } else {
              lines.push("\n[Project Context]");
              lines.push("  [INFO] Not inside an ActionDock project directory (skipped project checks)");
            }

            // 3. Summary
            lines.push(`\n[Summary] ${report.summary.ok} passed, ${report.summary.warn} warning(s), ${report.summary.error} error(s)`);
            return lines.join("\n");
          },
        });

        if (!report.ok) {
          process.exitCode = 1;
        }
      } catch (err: any) {
        throw new ExecutionError(`Doctor failed to run diagnostics: ${err.message}`);
      }
    });
}
