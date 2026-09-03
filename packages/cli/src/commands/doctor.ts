import { fetchRemoteDoctor, resolveTarget, runDoctorChecks } from "@actiondock/core";
import { Command } from "commander";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check ActionDock environment, registry health, and project diagnostics")
    .option("-P, --package <id|path>", "Target package ID or directory path for project diagnostics")
    .option("-p, --profile <name>", "Query doctor diagnostics on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--json", "Output diagnostics report in JSON format")
    .action(async (options) => {
      try {
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

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
          if (!report.ok) {
            process.exit(1);
          }
          return;
        }

        const title = target.type === "remote"
          ? `[DOCTOR] Remote ActionDock Server Diagnostics (${target.serverUrl}${target.profileName ? ` - Profile: ${target.profileName}` : ""})\n`
          : "[DOCTOR] ActionDock System & Project Diagnostics\n";
        console.log(title);

        // 1. Runtime & Environment Group
        console.log("[Runtime & Environment]");
        const envChecks = (report.checks || []).filter((c: any) => c.category === "runtime" || c.category === "storage" || c.category === "registry");
        for (const c of envChecks) {
          const tag = c.status === "ok" ? "[OK]" : c.status === "warn" ? "[WARN]" : "[ERROR]";
          console.log(`  ${tag} ${c.name}: ${c.message}`);
          if (c.fix) {
            console.log(`       Fix: ${c.fix}`);
          }
        }

        // 2. Project Group
        if (report.hasProject) {
          console.log(`\n[Project: ${report.packageId || "unknown"}] (${report.projectRoot})`);
          const projChecks = (report.checks || []).filter((c: any) => c.category === "project");
          for (const c of projChecks) {
            const tag = c.status === "ok" ? "[OK]" : c.status === "warn" ? "[WARN]" : "[ERROR]";
            console.log(`  ${tag} ${c.name}: ${c.message}`);
            if (c.fix) {
              console.log(`       Fix: ${c.fix}`);
            }
          }
        } else {
          console.log("\n[Project Context]");
          console.log("  [INFO] Not inside an ActionDock project directory (skipped project checks)");
        }

        // 3. Summary
        console.log(`\n[Summary] ${report.summary.ok} passed, ${report.summary.warn} warning(s), ${report.summary.error} error(s)`);

        if (!report.ok) {
          process.exit(1);
        }
      } catch (err: any) {
        console.error(`[ERROR] Doctor failed to run diagnostics: ${err.message}`);
        process.exit(1);
      }
    });
}
