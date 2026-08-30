import { resolve } from "node:path";
import { findProjectRoot, loadProjectConfig, startActionDockServer } from "@actiondock/core";
import { Command } from "commander";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the ActionDock lightweight HTTP Runner server for remote execution")
    .option("-p, --port <port>", "Port to listen on (default: 5177)", "5177")
    .option("-H, --host <host>", "Host address to bind to (default: 0.0.0.0)", "0.0.0.0")
    .option("-t, --token <token>", "Authentication token for securing the endpoint (or set ACTIONDOCK_TOKEN)")
    .option("-d, --dir <path>", "Project root directory (default: current working directory)")
    .action(async (options) => {
      const port = parseInt(options.port, 10) || 5177;
      const host = options.host || "0.0.0.0";
      const token = options.token || process.env.ACTIONDOCK_TOKEN;
      const projectRoot = options.dir
        ? resolve(options.dir)
        : findProjectRoot(process.cwd());

      let projectName = "Global Registry Mode";
      let packageId = "none";

      if (projectRoot) {
        try {
          const config = loadProjectConfig(projectRoot);
          projectName = `${config.name} (${config.id})`;
          packageId = config.id;
        } catch {
          // fallback
        }
      }

      try {
        const server = startActionDockServer({
          port,
          host,
          token,
          projectRoot: projectRoot || undefined,
        });

        console.log(`\n======================================================`);
        console.log(`  ActionDock 2.0 HTTP Runner Server`);
        console.log(`======================================================`);
        console.log(`  * Listening on:    http://${host}:${server.port}`);
        console.log(`  * Project:         ${projectName}`);
        if (projectRoot) {
          console.log(`  * Root Path:       ${projectRoot}`);
        }
        console.log(`  * Authentication:  ${token ? "Bearer Token Enabled" : "Disabled (Public/Local)"}`);
        console.log(`  * Health Endpoint: http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${server.port}/api/v1/health`);
        console.log(`======================================================\n`);
        console.log(`Server is ready to accept remote 'ac run' requests.`);
        console.log(`Press Ctrl+C to terminate.\n`);

        // Keep process running
        process.on("SIGINT", () => {
          console.log("\nStopping ActionDock server...");
          server.stop();
          process.exit(0);
        });
        process.on("SIGTERM", () => {
          server.stop();
          process.exit(0);
        });
      } catch (err: any) {
        console.error(`Failed to start ActionDock server: ${err.message}`);
        process.exit(1);
      }
    });
}
