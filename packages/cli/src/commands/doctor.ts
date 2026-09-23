import {
  fetchRemoteDoctor,
} from "@actiondock/core/profile";
import {
  runDoctorChecks,
} from "@actiondock/core/project";
import { Command } from "commander";
import { ExecutionError } from "../errors";
import { renderResult } from "../renderer";
import type { CliContext } from "../types";
import { applyTargetOptions, getEffectiveOptions, resolveTargetFromOptions } from "../utils";

export function registerDoctorCommand(program: Command, context?: CliContext): void {
  const cmd = program
    .command("doctor")
    .description("Check ActionDock environment, registry health, and project diagnostics")
    .option("-P, --package <id|path>", "Target package ID or directory path for project diagnostics");

  applyTargetOptions(cmd)
    .option("--json", "Output diagnostics report in JSON format")
    .action(async (rawOptions, cmd) => {
      try {
        const options = getEffectiveOptions(rawOptions, cmd);
        const target = resolveTargetFromOptions(options, context);

        let report;
        if (target.type === "remote") {
          const remoteRes = await fetchRemoteDoctor(target.serverUrl!, target.token, options.package, {
            allowInsecureHttp: Boolean(options.allowInsecureHttp),
            insecure: target.insecure,
          });
          report = remoteRes.report || remoteRes;
        } else {
          report = await runDoctorChecks({
            packageIdOrPath: options.package,
            customHome: context?.customHome,
          });
        }

        renderResult(report, {
          json: options.json,
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
