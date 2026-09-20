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
  updateProfile,
  useProfile,
} from "@actiondock/core";
import { Command } from "commander";
import {
  ArgumentError,
  CliError,
  ExecutionError,
} from "../errors";
import { renderResult, writeStderr, writeStdout } from "../renderer";
import { getEffectiveOptions, resolveFallbackStrategy, resolveIntent } from "../utils";

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
    .option("--fallback", "Enable fallback to full list when no items match intent")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action((patterns, rawOptions, cmd) => {
      try {
        const options = getEffectiveOptions(rawOptions, cmd);
        const effectiveIntent = resolveIntent(options.intent, patterns);
        const { isMachine, shouldFallback } = resolveFallbackStrategy(options);
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
            insecure: Boolean(p.entry.insecure),
          };
        });

        const filterRes = filterWithFallbackInfo(
          enriched,
          effectiveIntent,
          [(p) => p.name, (p) => p.serverUrl, (p) => p.description, (p) => p.tokenSource, (p) => (p.insecure ? "insecure" : "")],
          shouldFallback
        );

        if (filterRes.isFallback && isMachine) {
          renderResult(
            { items: filterRes.items, isFallback: true, matchedCount: 0 },
            { json: options.json, envelope: options.envelope }
          );
          return;
        }

        renderResult(filterRes.items, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => {
            const lines = ["ActionDock Execution Profiles:\n"];
            if (filterRes.isFallback && effectiveIntent) {
              lines.push(`(No profiles matched intent '${effectiveIntent}', showing all profiles)\n`);
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

              const insecureTag = item.insecure ? " [insecure]" : "";
              const desc = item.description ? ` - ${item.description}` : "";
              lines.push(
                `${currentMarker}${item.name.padEnd(20)} ${item.serverUrl}${tokenInfo}${insecureTag}${desc}`
              );
            }
            lines.push(
              "\nUse 'ad profile use <name>' to switch or 'ad run <action> --profile <name>' to execute on a specific target."
            );
            return lines.join("\n");
          },
        });
      } catch (err: any) {
        if (err instanceof ArgumentError || err instanceof CliError) throw err;
        throw new ExecutionError(err.message);
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
    .option("-k, --insecure", "Allow insecure server connections (skip TLS certificate validation)")
    .action((name, options) => {
      try {
        if (options.token) {
          writeStderr(
            "Warning: storing tokens directly in profiles.json is deprecated. Use --token-env or standard environment variables (e.g. ACTIONDOCK_<PROFILE>_TOKEN) instead."
          );
        }
        addProfile(name, {
          serverUrl: options.server,
          token: options.token,
          tokenEnv: options.tokenEnv,
          description: options.desc,
          insecure: options.insecure ? true : undefined,
        });
        writeStdout(`[OK] Profile '${name}' configured for server: ${options.server}${options.insecure ? " (insecure: true)" : ""}`);
      } catch (err: any) {
        throw new ExecutionError(err.message);
      }
    });

  // ad profile update <name>
  profileCmd
    .command("update <name>")
    .description("Update an existing remote execution profile")
    .option("-s, --server <url>", "Remote ActionDock server URL (e.g. http://1.2.3.4:5177)")
    .option("-t, --token <token>", "Authentication token for the remote server (deprecated; prefer --token-env)")
    .option("--token-env <env>", "Environment variable name containing the authentication token")
    .option("-d, --desc <description>", "Description of this profile/machine")
    .option("-k, --insecure", "Allow insecure server connections (skip TLS certificate validation)")
    .option("--no-insecure", "Enforce strict TLS certificate validation")
    .action((name, options) => {
      try {
        if (options.token) {
          writeStderr(
            "Warning: storing tokens directly in profiles.json is deprecated. Use --token-env or standard environment variables (e.g. ACTIONDOCK_<PROFILE>_TOKEN) instead."
          );
        }
        let insecure: boolean | undefined;
        if (options.insecure === true) {
          insecure = true;
        } else if (options.insecure === false) {
          insecure = false;
        }

        updateProfile(name, {
          serverUrl: options.server,
          token: options.token,
          tokenEnv: options.tokenEnv,
          description: options.desc,
          insecure,
        });
        writeStdout(`[OK] Profile '${name}' updated`);
      } catch (err: any) {
        throw new ExecutionError(err.message);
      }
    });

  // ad profile use <name>
  profileCmd
    .command("use <name>")
    .description("Switch active default profile")
    .action((name) => {
      try {
        useProfile(name);
        writeStdout(`[OK] Active profile switched to '${name}'`);
      } catch (err: any) {
        throw new ExecutionError(err.message);
      }
    });

  // ad profile show [name]
  profileCmd
    .command("show [name]")
    .description("Display details of a profile (defaults to active profile)")
    .option("--reveal, --show-secrets", "Reveal plain text values for tokens")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action((name, rawOptions, cmd) => {
      try {
        const options = getEffectiveOptions(rawOptions, cmd);
        const config = loadProfiles();
        const targetName = name || config.currentProfile || "local";
        const entry = getProfile(targetName);
        const reveal = Boolean(options.reveal || options.showSecrets);

        if (!entry && targetName !== "local") {
          throw new ArgumentError(`Profile '${targetName}' not found.`);
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
          insecure: Boolean(entry?.insecure),
          description: entry?.description || "",
        };

        renderResult(data, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => {
            const lines: string[] = [];
            lines.push(`Profile:      ${data.name}${data.isCurrent ? " (Active)" : ""}`);
            lines.push(`Server URL:   ${data.serverUrl}`);
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
            lines.push(`Auth Source:  ${sourceDetail}`);
            if (data.tokenConfigured) {
              lines.push(`Token Value:  ${data.token}`);
            }
            if (data.serverUrl !== "local") {
              lines.push(`TLS Verify:   ${data.insecure ? "Disabled (Insecure)" : "Strict (Default)"}`);
            }
            if (data.description) {
              lines.push(`Description:  ${data.description}`);
            }
            return lines.join("\n");
          },
        });
      } catch (err: any) {
        if (err instanceof ArgumentError || err instanceof CliError) {
          throw err;
        }
        throw new ExecutionError(err.message);
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
          throw new ExecutionError("Cannot remove built-in 'local' profile");
        }
        const removed = removeProfile(name);
        if (!removed) {
          throw new ExecutionError(`Profile '${name}' not found`);
        }
        writeStdout(`[OK] Profile '${name}' removed`);
      } catch (err: any) {
        if (err instanceof CliError) {
          throw err;
        }
        throw new ExecutionError(err.message);
      }
    });

  // ad profile test [name]
  profileCmd
    .command("test [name]")
    .description("Test connection latency and health of a profile")
    .option("-k, --insecure", "Allow insecure TLS connections (skip TLS certificate validation)")
    .option("--allow-insecure-http", "Allow insecure HTTP connections with auth token")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (name, rawOptions, cmd) => {
      try {
        const options = getEffectiveOptions(rawOptions, cmd);
        const target = resolveTarget({
          profile: name,
          insecure: options.insecure !== undefined ? Boolean(options.insecure) : undefined,
          allowInsecureHttp: options.allowInsecureHttp,
        });
        if (target.type === "local") {
          renderResult(
            { ok: true, type: "local", message: "Local execution" },
            {
              json: options.json,
              envelope: options.envelope,
              humanFormatter: () =>
                `Target profile '${target.profileName || "local"}' is local (runs in local runtime).`,
            }
          );
          return;
        }

        const health = await checkRemoteHealth(target.serverUrl!, target.token, 5000, {
          allowInsecureHttp: Boolean(options.allowInsecureHttp),
          insecure: target.insecure,
        });
        renderResult(health, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => {
            if (health.ok) {
              return `[OK] Connected to ${target.serverUrl} (${health.latencyMs}ms) - Version: ${health.version}, Status: ${health.status}`;
            }
            return `[FAIL] Connection to ${target.serverUrl} failed (${health.latencyMs}ms): ${health.error}`;
          },
        });
        if (!health.ok) {
          process.exitCode = 1;
        }
      } catch (err: any) {
        if (err instanceof ArgumentError || err instanceof CliError) throw err;
        throw new ExecutionError(err.message);
      }
    });
}
