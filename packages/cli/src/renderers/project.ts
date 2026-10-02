import type {
  ProjectDetailInfo,
  ProjectDetailJson,
  ProjectDetailConfigItem,
  ProjectDetailPlaybookItem,
  ProjectDetailActionItem,
  AggregatedPackage,
} from "../types";
import type { RegistryStatusReport } from "@actiondock/core/registry";

/**
 * 将工程详情信息转换为机器输出视图（结构化配置契约、规程与动作索引）。
 */
export function projectDetailToJson(info: ProjectDetailInfo): ProjectDetailJson {
  const config: Record<string, ProjectDetailConfigItem> = {};
  if (info.configDeclared && info.configDeclared.length > 0) {
    for (const key of info.configDeclared) {
      const item = info.configDef?.[key];
      config[key] = {
        ...(item?.description !== undefined ? { description: item.description } : {}),
        ...(item?.default !== undefined ? { default: item.default } : {}),
        secret: Boolean(item?.secret),
      };
    }
  }

  const playbooks: ProjectDetailPlaybookItem[] = [];
  if (info.playbooksMap && info.playbooksMap.size > 0) {
    for (const [id, pb] of info.playbooksMap.entries()) {
      playbooks.push({
        id,
        ...(pb?.description ? { description: pb.description } : {}),
      });
    }
  } else if (info.playbooks && info.playbooks.length > 0) {
    for (const pbId of info.playbooks) {
      playbooks.push({ id: pbId });
    }
  }

  const actions: ProjectDetailActionItem[] = [];
  if (info.actionsMap && info.actionsMap.size > 0) {
    for (const [id, act] of info.actionsMap.entries()) {
      actions.push({
        id,
        ...(act?.description ? { description: act.description } : {}),
      });
    }
  } else if (info.actions && info.actions.length > 0) {
    for (const actId of info.actions) {
      actions.push({ id: actId });
    }
  }

  const hints: string[] = [
    "Tip: Run 'ad playbook show <id>' to inspect procedure steps before execution.",
  ];
  if (info.configDeclared && info.configDeclared.length > 0) {
    hints.push("Tip: Run 'ad config set <KEY> <val>' to configure required settings.");
  }

  const result: ProjectDetailJson = {
    id: info.id,
    name: info.name || info.id,
    version: info.version || "0.0.0",
    root: info.projectRoot,
    config,
    playbooks,
    actions,
    hints,
  };

  if (info.description) {
    result.description = info.description;
  }

  return result;
}

/**
 * 格式化渲染单个项目的元数据与详情信息。
 */
export function renderProjectDetail(info: ProjectDetailInfo): string {
  const lines: string[] = [];
  lines.push(`ActionDock Project: ${info.name} (${info.id})`);
  lines.push(`Version:     ${info.version}`);
  if (info.description) {
    lines.push(`Description: ${info.description}`);
  }
  lines.push(`Root:        ${info.projectRoot}`);

  if (info.configDeclared.length > 0) {
    lines.push(`\nDeclared Config Keys (${info.configDeclared.length}):`);
    for (const k of info.configDeclared) {
      const item = info.configDef?.[k];
      const isSec = item?.secret ? " [secret]" : "";
      const def = item?.default !== undefined ? ` (default: ${JSON.stringify(item.default)})` : "";
      lines.push(`  - ${k.padEnd(24)} ${item?.description || ""}${def}${isSec}`);
    }
  }

  lines.push(`\nPlaybooks (${info.playbooksCount}):`);
  if (info.playbooksMap && info.playbooksMap.size > 0) {
    for (const [id, pb] of info.playbooksMap.entries()) {
      lines.push(`  - ${id.padEnd(28)} ${pb.description || ""}`);
    }
  } else if (info.playbooks && info.playbooks.length > 0) {
    for (const pbId of info.playbooks) {
      lines.push(`  - ${pbId}`);
    }
  } else {
    lines.push("  (no playbooks declared)");
  }

  lines.push(`\nActions (${info.actionsCount}):`);
  const actionList: Array<{ id: string; description: string }> = [];
  if (info.actionsMap) {
    for (const [id, act] of info.actionsMap.entries()) {
      actionList.push({ id, description: act.description || "" });
    }
  } else if (info.actions) {
    for (const actId of info.actions) {
      actionList.push({ id: actId, description: "" });
    }
  }

  if (actionList.length === 0) {
    lines.push("  (no actions declared)");
  } else {
    for (const a of actionList) {
      lines.push(`  - ${a.id.padEnd(28)} ${a.description}`);
    }
  }

  lines.push("\nTip: Run 'ad playbook show <id>' to inspect procedure steps before execution.");
  if (info.configDeclared.length > 0) {
    lines.push("Tip: Run 'ad config set <KEY> <val>' to configure required settings.");
  }

  return lines.join("\n");
}

/**
 * 格式化渲染已链接的多个 Package 摘要信息。
 */
export function renderAggregatedPackages(
  packages: AggregatedPackage[],
  options?: { header?: string; showTip?: boolean }
): string {
  const lines: string[] = [];
  if (options?.header) {
    lines.push(options.header);
  } else {
    lines.push(`ActionDock Linked Packages (${packages.length}):\n`);
  }

  for (const p of packages) {
    lines.push(`- ${p.name} (${p.id}) v${p.version}`);
    lines.push(`  Path:      ${p.path}`);
    if (p.description) {
      lines.push(`  Desc:      ${p.description}`);
    }
    lines.push(`  Actions (${p.actionsCount}):   ${p.actions.join(", ") || "(none)"}`);
    lines.push(`  Playbooks (${p.playbooksCount}): ${p.playbooks.join(", ") || "(none)"}`);
    lines.push("");
  }

  if (options?.showTip !== false) {
    lines.push("Tip: Run 'ad info <package-id>' to view detailed package configuration and schema.");
  }

  return lines.join("\n");
}

/**
 * 远端 info 接口返回的注册表树视图（与 RegistryStatusReport 字段兼容的宽松结构）。
 */
export type RegistryTreeView = RegistryStatusReport | (Record<string, unknown> & {
  workspaces?: Array<{
    id?: string;
    path: string;
    status: string;
    packagesCount?: number;
    children?: Array<{ id: string; version?: string; path: string }>;
  }>;
  packages?: Array<{ id: string; version?: string; path: string; status: string }>;
  totalPackagesCount?: number;
  staleCount?: number;
});

/**
 * 格式化渲染注册表层级树结构。
 */
export function renderRegistryTree(status: RegistryTreeView): string {
  const lines: string[] = [];
  const workspaces = status.workspaces || [];
  const packages = status.packages || [];
  const hasWorkspaces = workspaces.length > 0;
  const hasPackages = packages.length > 0;

  if (!hasWorkspaces && !hasPackages) {
    lines.push("[INFO] No ActionDock packages or workspaces currently linked.");
    lines.push("       Run 'ad link' inside an Action package or workspace to register it.");
    return lines.join("\n");
  }

  lines.push("[ActionDock Workspace & Package Tree]\n");

  if (hasWorkspaces) {
    lines.push("Workspaces:");
    for (const ws of workspaces) {
      const tag = ws.status === "active" ? "[OK]" : "[STALE]";
      lines.push(`  ${tag} ${ws.path} (${ws.packagesCount} package${ws.packagesCount === 1 ? "" : "s"})`);
      if (ws.children && ws.children.length > 0) {
        const children = ws.children;
        children.forEach((child, idx) => {
          const isLast = idx === children.length - 1;
          const prefix = isLast ? "    +-- " : "    |-- ";
          lines.push(`${prefix}${child.id} (v${child.version}) -> ${child.path}`);
        });
      }
    }
  }

  if (hasPackages) {
    if (hasWorkspaces) lines.push("");
    lines.push("Standalone Packages:");
    for (const pkg of packages) {
      const tag = pkg.status === "active" ? "[OK]" : "[STALE]";
      lines.push(`  ${tag} ${pkg.id} (v${pkg.version || "unknown"}) -> ${pkg.path}`);
    }
  }

  const totalActive = status.totalPackagesCount ?? packages.length;
  lines.push(`\n[Summary] Total: ${totalActive} active package(s), ${workspaces.length} workspace(s)`);
  if (status.staleCount && status.staleCount > 0) {
    lines.push(`[WARN] ${status.staleCount} stale entry/entries detected. Run 'ad unlink --prune' to clean up.`);
  }

  return lines.join("\n");
}
