import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  assertPathWithinRoot,
  fetchRemotePlaybooks,
  fetchRemotePlaybookShow,
  filterWithFallbackInfo,
  findProjectRoot,
  listLinkedPackages,
  loadActions,
  loadManifest,
  loadPlaybooks,
  loadProjectConfig,
  resolveActionProject,
  resolvePackageRoot,
  resolvePlaybookProject,
  resolveTarget,
  saveManifest,
  type PlaybookDefinition,
} from "@actiondock/core";
import { Command } from "commander";
import { ArgumentError, CliError, ExecutionError } from "../errors";
import {
  renderPlaybookDetail,
  renderPlaybookList,
  renderResult,
  writeStdout,
} from "../renderer";
import type { CliContext } from "../types";
import { getEffectiveOptions, resolveIntent } from "../utils";

/**
 * 注册 Playbook 命令集合（list, show, validate, create）。
 * 
 * @param program Commander 根程序对象
 * @param context 命令行上下文
 */
export function registerPlaybookCommands(program: Command, context?: CliContext): void {
  const pbCmd = program
    .command("playbook")
    .description("Manage task Playbooks (Task SOPs for AI Agents)");

  // playbook list
  pbCmd
    .command("list [patterns...]")
    .description("List playbooks in current project or linked packages")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-p, --profile <name>", "Query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (patterns: string[] = [], rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const effectiveIntent = resolveIntent(options.intent, patterns);
      const shouldFallback = options.fallback !== false;
      const isMachine = Boolean(options.json || options.envelope);

      // 1. 远端服务分支
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      }, context?.customHome);

      if (target.type === "remote") {
        const remotePbs = await fetchRemotePlaybooks(target.serverUrl!, target.token, {
          intent: effectiveIntent,
          package: options.package,
        });

        renderResult(remotePbs, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            renderPlaybookList(
              remotePbs,
              `Playbooks on remote server ${target.serverUrl}${target.profileName ? ` (Profile: ${target.profileName})` : ""}`,
              false,
              effectiveIntent
            ),
          context,
        });
        return;
      }

      // 2. 本地工程模式
      let targetRoot: string | null = null;
      if (options.package) {
        targetRoot = resolvePackageRoot(options.package);
        if (!targetRoot) {
          throw new ArgumentError(
            `Package '${options.package}' not found in linked packages or path`
          );
        }
      } else {
        targetRoot = findProjectRoot();
      }

      if (targetRoot) {
        const config = loadProjectConfig(targetRoot);
        const playbooks = loadPlaybooks(targetRoot, config.playbooksDir);
        const rawList = Array.from(playbooks.values()).map((pb) => ({
          id: pb.id,
          description: pb.description,
          packageId: config.id,
        }));

        const filterRes = filterWithFallbackInfo(
          rawList,
          effectiveIntent,
          [(p) => p.id, (p) => p.description],
          shouldFallback
        );

        if (filterRes.isFallback && isMachine) {
          renderResult(
            { items: filterRes.items, isFallback: true, matchedCount: 0 },
            { json: options.json, envelope: options.envelope, context }
          );
          return;
        }

        renderResult(filterRes.items, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            renderPlaybookList(
              filterRes.items,
              `Playbooks in ${config.id} (${targetRoot})`,
              filterRes.isFallback,
              effectiveIntent
            ),
          context,
        });
        return;
      }

      // 3. 扫描所有已链接的外部包
      const linkedList = listLinkedPackages(context?.customHome);
      if (linkedList.length === 0) {
        renderResult(
          [],
          {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => "No ActionDock project in current directory, and no packages linked.",
            context,
          }
        );
        return;
      }

      const aggregated: Array<{
        packageId: string;
        packageName: string;
        path: string;
        playbooks: Array<{ id: string; description?: string }>;
      }> = [];

      for (const pkg of linkedList) {
        if (!existsSync(pkg.path)) continue;
        try {
          const config = loadProjectConfig(pkg.path);
          const pbs = loadPlaybooks(pkg.path, config.playbooksDir);
          const list = Array.from(pbs.values()).map((p) => ({
            id: p.id,
            description: p.description,
          }));
          aggregated.push({
            packageId: pkg.id,
            packageName: pkg.name,
            path: pkg.path,
            playbooks: list,
          });
        } catch {}
      }

      let filteredPackages: typeof aggregated = [];
      let isFallback = false;
      if (!effectiveIntent) {
        filteredPackages = aggregated;
      } else {
        for (const pkg of aggregated) {
          const pkgMatches =
            filterWithFallbackInfo(
              [pkg],
              effectiveIntent,
              [(p) => p.packageId, (p) => p.packageName, (p) => p.path],
              false
            ).matchedCount > 0;

          if (pkgMatches) {
            filteredPackages.push(pkg);
          } else {
            const matchedPbs = filterWithFallbackInfo(
              pkg.playbooks,
              effectiveIntent,
              [(p) => p.id, (p) => p.description],
              false
            ).items;

            if (matchedPbs.length > 0) {
              filteredPackages.push({
                ...pkg,
                playbooks: matchedPbs,
              });
            }
          }
        }

        if (filteredPackages.length === 0 && shouldFallback) {
          filteredPackages = aggregated;
          isFallback = true;
        }
      }

      if (isFallback && isMachine) {
        renderResult(
          { packages: filteredPackages, isFallback: true, matchedCount: 0 },
          { json: options.json, envelope: options.envelope, context }
        );
        return;
      }

      renderResult(filteredPackages, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () => {
          const lines: string[] = ["Linked Playbooks:\n"];
          for (const pkg of filteredPackages) {
            lines.push(`- Package: ${pkg.packageId} (${pkg.path})`);
            for (const pb of pkg.playbooks) {
              lines.push(`    - ${pb.id.padEnd(26)} ${pb.description || ""}`);
            }
          }
          return lines.join("\n");
        },
        context,
      });
    });

  // playbook show <id>
  pbCmd
    .command("show <id>")
    .description("Show playbook content and metadata")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-p, --profile <name>", "Query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (id: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!id) {
        throw new ArgumentError("Playbook ID is required for show");
      }

      // 1. 远端服务分支
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      }, context?.customHome);

      if (target.type === "remote") {
        const detail = await fetchRemotePlaybookShow(target.serverUrl!, id, target.token);
        renderResult(detail, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderPlaybookDetail(detail),
          context,
        });
        return;
      }

      // 2. 本地项目模式
      let showTarget = id;
      if (options.package && !id.includes("/")) {
        const pkgRoot = resolvePackageRoot(options.package);
        if (!pkgRoot) {
          throw new ArgumentError(
            `Package '${options.package}' not found in linked packages or path`
          );
        }
        showTarget = `${options.package}/${id}`;
      }

      let resolved;
      try {
        resolved = resolvePlaybookProject(showTarget);
      } catch (err: any) {
        throw new ArgumentError(err.message);
      }

      const pb = resolved.playbook;
      const detail = {
        id: pb.id,
        packageId: resolved.packageId,
        description: pb.description,
        actions: pb.actions,
        filePath: pb.filePath,
        content: pb.content,
      };

      renderResult(detail, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () => renderPlaybookDetail(detail),
        context,
      });
    });

  // playbook validate
  pbCmd
    .command("validate [id]")
    .description("Validate playbook format and action references (in current project or linked packages)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (id: string | undefined, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);

      let root: string | null = null;
      if (options.package) {
        root = resolvePackageRoot(options.package);
        if (!root) {
          throw new ArgumentError(
            `Package '${options.package}' not found in linked packages or path`
          );
        }
      } else {
        root = findProjectRoot();
      }

      const targets: Array<{ root: string; packageId: string; playbooks: PlaybookDefinition[] }> = [];

      if (root) {
        const config = loadProjectConfig(root);
        const playbooks = loadPlaybooks(root, config.playbooksDir);
        if (id) {
          const pb = playbooks.get(id);
          if (!pb) {
            throw new ArgumentError(`Playbook '${id}' not found in package '${config.id}'`);
          }
          targets.push({ root, packageId: config.id, playbooks: [pb] });
        } else {
          targets.push({ root, packageId: config.id, playbooks: Array.from(playbooks.values()) });
        }
      } else if (id) {
        let resolved;
        try {
          resolved = resolvePlaybookProject(id);
        } catch (err: any) {
          throw new ArgumentError(err.message);
        }
        targets.push({
          root: resolved.projectRoot,
          packageId: resolved.packageId,
          playbooks: [resolved.playbook],
        });
      } else {
        const linkedList = listLinkedPackages(context?.customHome);
        if (linkedList.length === 0) {
          throw new ArgumentError("Not in an ActionDock project, and no packages linked.");
        }
        for (const pkg of linkedList) {
          if (!existsSync(pkg.path)) continue;
          try {
            const config = loadProjectConfig(pkg.path);
            const playbooks = loadPlaybooks(pkg.path, config.playbooksDir);
            targets.push({
              root: pkg.path,
              packageId: pkg.id,
              playbooks: Array.from(playbooks.values()),
            });
          } catch {}
        }
      }

      const results: Array<{ id: string; packageId: string; valid: boolean; warnings: string[]; errors: string[] }> = [];

      for (const target of targets) {
        const config = loadProjectConfig(target.root);
        const manifest = loadManifest(target.root);
        const actions = await loadActions(target.root, config.actionsDir);

        for (const pb of target.playbooks) {
          const warnings: string[] = [];
          const errors: string[] = [];

          if (!pb.id) {
            errors.push("Missing id in playbook");
          }
          if (!pb.description) {
            warnings.push("Missing description in actiondock.json");
          }

          if (pb.actions && Array.isArray(pb.actions)) {
            for (const actRef of pb.actions) {
              if (actRef.includes("/")) {
                try {
                  await resolveActionProject(actRef);
                } catch (e: any) {
                  errors.push(`Referenced cross-package action '${actRef}' not resolvable: ${e.message}`);
                }
              } else {
                const foundInActions = actions.has(actRef);
                const foundInManifest = Boolean(manifest?.actions?.[actRef]);
                if (!foundInActions && !foundInManifest) {
                  errors.push(`Referenced action '${actRef}' not found in project actions`);
                }
              }
            }
          }

          results.push({
            id: pb.id,
            packageId: target.packageId,
            valid: errors.length === 0,
            warnings,
            errors,
          });
        }
      }

      const allValid = results.every((r) => r.valid);

      renderResult(
        { valid: allValid, results },
        {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => {
            const lines: string[] = [];
            for (const r of results) {
              const tag = r.valid ? "[OK]" : "[FAIL]";
              lines.push(`${tag} ${r.packageId}/${r.id}: ${r.valid ? "Valid" : "Invalid"}`);
              for (const e of r.errors) {
                lines.push(`    Error: ${e}`);
              }
              for (const w of r.warnings) {
                lines.push(`    Warning: ${w}`);
              }
            }
            return lines.join("\n");
          },
          context,
        }
      );

      if (!allValid) {
        throw new ExecutionError("Playbook validation failed", results);
      }
    });

  // playbook create / new
  pbCmd
    .command("create <id>")
    .alias("new")
    .description("Scaffold a new Playbook markdown file")
    .option("-d, --desc <description>", "Playbook description")
    .option("-a, --actions <actions...>", "Referenced action IDs")
    .option("-f, --file <filePath>", "Target file path relative to playbooks dir")
    .action((id, options) => {
      handlePlaybookCreate(id, options, context);
    });
}

export function handlePlaybookCreate(
  id: string,
  options: any,
  context?: CliContext
): void {
  const root = findProjectRoot();
  if (!root) {
    throw new ExecutionError("Not in an ActionDock project (actiondock.json not found)");
  }
  try {
    const config = loadProjectConfig(root);
    const pbDir = resolve(root, config.playbooksDir || "playbooks");
    if (!existsSync(pbDir)) {
      mkdirSync(pbDir, { recursive: true });
    }

    if (options.file && isAbsolute(options.file)) {
      throw new ExecutionError(`--file option must be a relative path, received: ${options.file}`);
    }

    const cleanName = id.replace(/[^a-zA-Z0-9-_]/g, "-");
    const targetRelFile = options.file || `${cleanName}.md`;
    const targetFullFile = resolve(pbDir, targetRelFile);
    assertPathWithinRoot(pbDir, targetFullFile, "playbook file");

    if (existsSync(targetFullFile)) {
      throw new ExecutionError(`File '${targetFullFile}' already exists`);
    }

    mkdirSync(dirname(targetFullFile), { recursive: true });

    const desc = options.desc || `SOP guide for ${id}`;
    const actionsList = Array.isArray(options.actions) ? options.actions : [];

    const template = `# ${id.replace(/[-_]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())} SOP

This playbook provides task execution guidance for AI Agents.

## Instructions

- Inspect available actions with \`<binary> list --json\`.
- Follow the required steps to complete the task.
`;

    writeFileSync(targetFullFile, template, "utf-8");

    const manifest = loadManifest(root) || {
      $schema: "https://actiondock.dev/schema/v2/actiondock.json",
      id: config.id,
      name: config.name,
      version: config.version,
      playbooks: {},
    };
    manifest.playbooks = manifest.playbooks || {};
    const relEntry = relative(root, targetFullFile).replace(/\\/g, "/");
    manifest.playbooks[id] = {
      entry: relEntry,
      description: desc,
      actions: actionsList,
    };
    saveManifest(root, manifest);

    writeStdout(`[OK] Created Playbook '${id}' at ${targetFullFile}`, context);
  } catch (err: any) {
    if (err instanceof CliError) {
      throw err;
    }
    throw new ExecutionError(err.message);
  }
}
