import {
  addProfile,
  checkRemoteHealth,
  getProfile,
  listProfiles,
  loadProfiles,
  removeProfile,
  resolveTarget,
  useProfile,
} from "@actiondock/core";
import { Command } from "commander";

export function registerProfileCommands(program: Command): void {
  const profileCmd = program
    .command("profile")
    .description("Manage multi-cloud and remote execution profiles");

  // ac profile list
  profileCmd
    .command("list")
    .description("List all configured profiles")
    .option("--json", "Output as JSON")
    .action((options) => {
      try {
        const list = listProfiles();
        if (options.json) {
          console.log(JSON.stringify(list, null, 2));
        } else {
          console.log("ActionDock Execution Profiles:\n");
          for (const item of list) {
            const currentMarker = item.isCurrent ? "* " : "  ";
            const tokenInfo = item.entry.token ? " [token configured]" : "";
            const desc = item.entry.description ? ` - ${item.entry.description}` : "";
            console.log(
              `${currentMarker}${item.name.padEnd(20)} ${item.entry.serverUrl}${tokenInfo}${desc}`
            );
          }
          console.log(
            "\nUse 'ac profile use <name>' to switch or 'ac run <action> --profile <name>' to execute on a specific target."
          );
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // ac profile add <name>
  profileCmd
    .command("add <name>")
    .description("Add or update a remote execution profile")
    .requiredOption("-s, --server <url>", "Remote ActionDock server URL (e.g. http://1.2.3.4:5177)")
    .option("-t, --token <token>", "Authentication token for the remote server")
    .option("-d, --desc <description>", "Description of this profile/machine")
    .action((name, options) => {
      try {
        addProfile(name, {
          serverUrl: options.server,
          token: options.token,
          description: options.desc,
        });
        console.log(`[OK] Profile '${name}' configured for server: ${options.server}`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // ac profile use <name>
  profileCmd
    .command("use <name>")
    .description("Switch active default profile")
    .action((name) => {
      try {
        useProfile(name);
        console.log(`[OK] Active profile switched to '${name}'`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // ac profile show [name]
  profileCmd
    .command("show [name]")
    .description("Display details of a profile (defaults to active profile)")
    .option("--json", "Output as JSON")
    .action((name, options) => {
      try {
        const config = loadProfiles();
        const targetName = name || config.currentProfile || "local";
        const entry = getProfile(targetName);

        if (!entry && targetName !== "local") {
          console.error(`Error: Profile '${targetName}' not found.`);
          process.exit(1);
        }

        const data = {
          name: targetName,
          isCurrent: config.currentProfile === targetName,
          serverUrl: entry?.serverUrl || "local",
          tokenConfigured: Boolean(entry?.token),
          description: entry?.description || "",
        };

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(`Profile:     ${data.name}${data.isCurrent ? " (Active)" : ""}`);
          console.log(`Server URL:  ${data.serverUrl}`);
          console.log(`Auth Token:  ${data.tokenConfigured ? "Configured" : "None"}`);
          if (data.description) {
            console.log(`Description: ${data.description}`);
          }
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // ac profile rm / remove <name>
  profileCmd
    .command("rm <name>")
    .alias("remove")
    .description("Remove a profile")
    .action((name) => {
      try {
        if (name === "local") {
          console.error("Error: Cannot remove built-in 'local' profile");
          process.exit(1);
        }
        const removed = removeProfile(name);
        if (!removed) {
          console.error(`Error: Profile '${name}' not found`);
          process.exit(1);
        }
        console.log(`[OK] Profile '${name}' removed`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // ac profile test [name]
  profileCmd
    .command("test [name]")
    .description("Test connection latency and health of a profile")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const target = resolveTarget({ profile: name });
        if (target.type === "local") {
          if (options.json) {
            console.log(JSON.stringify({ ok: true, type: "local", message: "Local execution" }, null, 2));
          } else {
            console.log(`Target profile '${target.profileName || "local"}' is local (runs in local Bun runtime).`);
          }
          return;
        }

        const health = await checkRemoteHealth(target.serverUrl!, target.token);
        if (options.json) {
          console.log(JSON.stringify(health, null, 2));
        } else {
          if (health.ok) {
            console.log(
              `[OK] Connected to ${target.serverUrl} (${health.latencyMs}ms) - Version: ${health.version}, Status: ${health.status}`
            );
          } else {
            console.error(
              `[FAIL] Connection to ${target.serverUrl} failed (${health.latencyMs}ms): ${health.error}`
            );
            process.exit(1);
          }
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}
