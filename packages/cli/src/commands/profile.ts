import {
  addProfile,
  checkRemoteHealth,
  filterWithFallbackInfo,
  getProfile,
  listProfiles,
  loadProfiles,
  maskSecretValue,
  removeProfile,
  resolveProfileToken,
  resolveTarget,
  toSnakeUpperCase,
  useProfile,
} from "@actiondock/core";
import { Command } from "commander";
import { resolveIntent } from "../utils/filter";

export function registerProfileCommands(program: Command): void {
  const profileCmd = program
    .command("profile")
    .description("Manage multi-cloud and remote execution profiles");

  // ad profile list
  profileCmd
    .command("list [patterns...]")
    .description("List all configured profiles")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("--reveal, --show-secrets", "Reveal plain text values for tokens")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .action((patterns, options) => {
      try {
        const effectiveIntent = resolveIntent(options.intent, patterns);
        const shouldFallback = options.fallback !== false;
        const reveal = Boolean(options.reveal || options.showSecrets);

        const list = listProfiles();
        const enriched = list.map((p) => {
          const resolved = resolveProfileToken(p.name, p.entry);
          return {
            name: p.name,
            isCurrent: p.isCurrent,
            serverUrl: p.entry.serverUrl,
            description: p.entry.description || "",
            tokenEnv: p.entry.tokenEnv,
            tokenConfigured: resolved.source !== "none",
            tokenSource: resolved.source,
            token: reveal ? resolved.token : (resolved.token ? maskSecretValue(resolved.token) : undefined),
          };
        });

        const filterRes = filterWithFallbackInfo(
          enriched,
          effectiveIntent,
          [(p) => p.name, (p) => p.serverUrl, (p) => p.description, (p) => p.tokenSource],
          shouldFallback
        );

        if (options.json) {
          console.log(JSON.stringify(filterRes.items, null, 2));
        } else {
          console.log("ActionDock Execution Profiles:\n");
          if (filterRes.isFallback && effectiveIntent) {
            console.log(`(No profiles matched intent '${effectiveIntent}', showing all profiles)\n`);
          }
          for (const item of filterRes.items) {
            const currentMarker = item.isCurrent ? "* " : "  ";
            let tokenInfo = "";
            if (item.tokenSource === "tokenEnv") {
              tokenInfo = ` [token: env(${item.tokenEnv})]`;
            } else if (item.tokenSource === "profileEnv") {
              tokenInfo = ` [token: env(ACTIONDOCK_${toSnakeUpperCase(item.name)}_TOKEN)]`;
            } else if (item.tokenSource === "profile") {
              tokenInfo = ` [token: stored in profile]`;
            } else if (item.tokenSource === "globalEnv") {
              tokenInfo = ` [token: env(ACTIONDOCK_TOKEN)]`;
            }

            if (reveal && item.token) {
              tokenInfo += ` = ${item.token}`;
            }

            const desc = item.description ? ` - ${item.description}` : "";
            console.log(
              `${currentMarker}${item.name.padEnd(20)} ${item.serverUrl}${tokenInfo}${desc}`
            );
          }
          console.log(
            "\nUse 'ad profile use <name>' to switch or 'ad run <action> --profile <name>' to execute on a specific target."
          );
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // ad profile add <name>
  profileCmd
    .command("add <name>")
    .description("Add or update a remote execution profile")
    .requiredOption("-s, --server <url>", "Remote ActionDock server URL (e.g. http://1.2.3.4:5177)")
    .option("-t, --token <token>", "Authentication token for the remote server (deprecated; prefer --token-env)")
    .option("--token-env <env>", "Environment variable name containing the authentication token")
    .option("-d, --desc <description>", "Description of this profile/machine")
    .action((name, options) => {
      try {
        if (options.token) {
          console.warn(
            "Warning: storing tokens directly in profiles.json is deprecated. Use --token-env or standard environment variables (e.g. ACTIONDOCK_<PROFILE>_TOKEN) instead."
          );
        }
        addProfile(name, {
          serverUrl: options.server,
          token: options.token,
          tokenEnv: options.tokenEnv,
          description: options.desc,
        });
        console.log(`[OK] Profile '${name}' configured for server: ${options.server}`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // ad profile use <name>
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

  // ad profile show [name]
  profileCmd
    .command("show [name]")
    .description("Display details of a profile (defaults to active profile)")
    .option("--reveal, --show-secrets", "Reveal plain text values for tokens")
    .option("--json", "Output as JSON")
    .action((name, options) => {
      try {
        const config = loadProfiles();
        const targetName = name || config.currentProfile || "local";
        const entry = getProfile(targetName);
        const reveal = Boolean(options.reveal || options.showSecrets);

        if (!entry && targetName !== "local") {
          console.error(`Error: Profile '${targetName}' not found.`);
          process.exit(1);
        }

        const resolved = resolveProfileToken(targetName, entry);
        const displayToken = reveal
          ? resolved.token
          : (resolved.token ? maskSecretValue(resolved.token) : undefined);

        const data = {
          name: targetName,
          isCurrent: config.currentProfile === targetName,
          serverUrl: entry?.serverUrl || "local",
          tokenConfigured: resolved.source !== "none",
          tokenSource: resolved.source,
          tokenEnv: entry?.tokenEnv,
          token: displayToken,
          description: entry?.description || "",
        };

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(`Profile:      ${data.name}${data.isCurrent ? " (Active)" : ""}`);
          console.log(`Server URL:   ${data.serverUrl}`);
          let sourceDetail = "None";
          if (data.tokenSource === "tokenEnv") {
            sourceDetail = `Environment Variable ($${data.tokenEnv})`;
          } else if (data.tokenSource === "profileEnv") {
            sourceDetail = `Profile Environment Variable ($ACTIONDOCK_${toSnakeUpperCase(data.name)}_TOKEN)`;
          } else if (data.tokenSource === "profile") {
            sourceDetail = "Stored in profiles.json (Deprecated)";
          } else if (data.tokenSource === "globalEnv") {
            sourceDetail = "Global Environment Variable ($ACTIONDOCK_TOKEN)";
          }
          console.log(`Auth Source:  ${sourceDetail}`);
          if (data.tokenConfigured) {
            console.log(`Token Value:  ${data.token}`);
          }
          if (data.description) {
            console.log(`Description:  ${data.description}`);
          }
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // ad profile rm / remove <name>
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

  // ad profile test [name]
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
