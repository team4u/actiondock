import type { Envelope, ProjectDetailInfo, AggregatedPackage, EnvCheckItem, RuntimeCliContext } from "./types";
import { formatError } from "./errors";

/**
 * 构造标准成功结果信封。
 * 
 * @param data 业务数据载荷
 * @param meta 附加元数据
 */
export function createSuccessEnvelope<T>(data: T, meta?: Record<string, unknown>): Envelope<T> {
  const result: Envelope<T> = {
    ok: true,
    data,
  };
  if (meta && Object.keys(meta).length > 0) {
    result.meta = meta;
  }
  return result;
}

/**
 * 构造标准失败结果信封。
 * 
 * @param code 错误码
 * @param message 错误描述信息
 * @param details 附加错误细节
 * @param meta 附加元数据
 */
export function createErrorEnvelope(
  code: string,
  message: string,
  details?: unknown,
  meta?: Record<string, unknown>
): Envelope<never> {
  const result: Envelope<never> = {
    ok: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
  if (meta && Object.keys(meta).length > 0) {
    result.meta = meta;
  }
  return result;
}

/**
 * 序列化数据为格式化 JSON 字符串。
 * 
 * @param data 待序列化数据
 * @param pretty 是否美化格式
 */
export function formatJson(data: unknown, pretty: boolean = true): string {
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}

/**
 * 标准输出写入辅助方法。
 */
export function writeStdout(message: string, context?: RuntimeCliContext): void {
  if (context?.stdout) {
    context.stdout(message);
  } else {
    console.log(message);
  }
}

/**
 * 标准错误写入辅助方法。
 */
export function writeStderr(message: string, context?: RuntimeCliContext): void {
  if (context?.stderr) {
    context.stderr(message);
  } else {
    console.error(message);
  }
}

/**
 * 统一根据输出模式进行渲染输出。
 */
export function renderResult<T>(
  data: T,
  options: {
    json?: boolean;
    envelope?: boolean;
    humanFormatter?: () => string;
    context?: RuntimeCliContext;
  }
): void {
  const isJson = Boolean(options.json);
  const useEnvelope = Boolean(options.envelope || (isJson && options.context?.defaultEnvelope));

  if (isJson) {
    if (useEnvelope) {
      // 避免重复包装已有信封
      if (typeof data === "object" && data !== null && "ok" in data) {
        writeStdout(formatJson(data), options.context);
      } else {
        writeStdout(formatJson(createSuccessEnvelope(data)), options.context);
      }
    } else {
      writeStdout(formatJson(data), options.context);
    }
  } else {
    if (options.humanFormatter) {
      writeStdout(options.humanFormatter(), options.context);
    } else {
      writeStdout(typeof data === "string" ? data : formatJson(data), options.context);
    }
  }
}

/**
 * 统一渲染异常输出。
 */
export function renderError(
  err: unknown,
  options: {
    json?: boolean;
    envelope?: boolean;
    context?: RuntimeCliContext;
  }
): void {
  const formatted = formatError(err);
  const isJson = Boolean(options.json);

  if (isJson) {
    const errorEnv = createErrorEnvelope(formatted.code, formatted.message, formatted.details);
    writeStdout(formatJson(errorEnv), options.context);
  } else {
    writeStderr(`Error: ${formatted.message}`, options.context);
  }
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

  lines.push(`\nActions (${info.actionsCount}):`);
  if (info.actionsMap) {
    for (const [id, act] of info.actionsMap.entries()) {
      lines.push(`  - ${id.padEnd(28)} ${act.description || ""}`);
    }
  } else {
    for (const actId of info.actions) {
      lines.push(`  - ${actId}`);
    }
  }

  lines.push(`\nPlaybooks (${info.playbooksCount}):`);
  if (info.playbooksMap) {
    for (const [id, pb] of info.playbooksMap.entries()) {
      lines.push(`  - ${id.padEnd(28)} ${pb.description || ""}`);
    }
  } else {
    for (const pbId of info.playbooks) {
      lines.push(`  - ${pbId}`);
    }
  }

  if (info.configDeclared.length > 0) {
    lines.push(`\nDeclared Config Keys:`);
    for (const k of info.configDeclared) {
      const item = info.configDef?.[k];
      const isSec = item?.secret ? " [secret]" : "";
      const def = item?.default !== undefined ? ` (default: ${JSON.stringify(item.default)})` : "";
      lines.push(`  - ${k.padEnd(24)} ${item?.description || ""}${def}${isSec}`);
    }
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
 * 格式化渲染注册表层级树结构。
 */
export function renderRegistryTree(status: any): string {
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
        ws.children.forEach((child: any, idx: number) => {
          const isLast = idx === ws.children.length - 1;
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

/**
 * 格式化渲染 Action 列表。
 */
export function renderActionList(
  items: Array<{ id: string; description: string; packageId?: string }>,
  title: string = "Actions",
  isFallback: boolean = false,
  intent?: string
): string {
  const lines: string[] = [];
  lines.push(`${title}:\n`);
  if (isFallback && intent) {
    lines.push(`(No actions matched intent '${intent}', showing all actions)\n`);
  }
  if (items.length === 0) {
    lines.push("  (no actions found)");
  } else {
    for (const a of items) {
      lines.push(`  - ${a.id.padEnd(28)} ${a.description}`);
    }
  }
  return lines.join("\n");
}

/**
 * 格式化渲染 Action 详情。
 */
export function renderActionDetail(action: {
  id: string;
  packageId?: string;
  projectRoot?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}): string {
  const lines: string[] = [];
  lines.push(`Action:      ${action.id}`);
  if (action.packageId) {
    const rootDesc = action.projectRoot ? ` (${action.projectRoot})` : "";
    lines.push(`Package:     ${action.packageId}${rootDesc}`);
  }
  if (action.description) {
    lines.push(`Description: ${action.description}`);
  }
  if (action.inputSchema) {
    lines.push("\nInput Schema:");
    lines.push(JSON.stringify(action.inputSchema, null, 2));
  }
  if (action.outputSchema) {
    lines.push("\nOutput Schema:");
    lines.push(JSON.stringify(action.outputSchema, null, 2));
  }
  return lines.join("\n");
}

/**
 * 格式化渲染 Action 校验结果。
 */
export function renderActionValidation(results: Array<{ id: string; valid: boolean; errors: string[] }>): string {
  const lines: string[] = [];
  for (const r of results) {
    if (r.valid) {
      lines.push(`[OK] ${r.id}: Valid`);
    } else {
      lines.push(`[FAIL] ${r.id}: ${r.errors.join(", ")}`);
    }
  }
  return lines.join("\n");
}

/**
 * 格式化渲染 Playbook 列表。
 */
export function renderPlaybookList(
  items: Array<{ id: string; description: string; packageId?: string }>,
  title: string = "Playbooks",
  isFallback: boolean = false,
  intent?: string
): string {
  const lines: string[] = [];
  lines.push(`${title}:\n`);
  if (isFallback && intent) {
    lines.push(`(No playbooks matched intent '${intent}', showing all playbooks)\n`);
  }
  if (items.length === 0) {
    lines.push("  (no playbooks found)");
  } else {
    for (const p of items) {
      const pkgDesc = p.packageId ? ` (Package: ${p.packageId})` : "";
      lines.push(`  - ${p.id.padEnd(26)} ${p.description}${pkgDesc}`);
    }
  }
  return lines.join("\n");
}

/**
 * 格式化渲染 Playbook 详情。
 */
export function renderPlaybookDetail(pb: {
  id: string;
  packageId?: string;
  description?: string;
  actions?: string[];
  filePath?: string;
  content?: string;
}): string {
  const lines: string[] = [];
  const pkgDesc = pb.packageId ? ` (Package: ${pb.packageId})` : "";
  lines.push(`Playbook:    ${pb.id}${pkgDesc}`);
  if (pb.description) lines.push(`Description: ${pb.description}`);
  if (pb.actions && pb.actions.length > 0) {
    lines.push(`Actions:     ${pb.actions.join(", ")}`);
  }
  if (pb.filePath) lines.push(`File:        ${pb.filePath}\n`);
  if (pb.content) {
    lines.push("--- Content ---");
    lines.push(pb.content);
  }
  return lines.join("\n");
}

/**
 * 格式化渲染配置项列表。
 */
export function renderConfigList(
  items: Array<{ key: string; value: unknown; source: string; secret: boolean; description?: string }>,
  scopeLabel: string = "Global Scope",
  isFallback: boolean = false,
  intent?: string,
  reveal: boolean = false
): string {
  const lines: string[] = [];
  lines.push(`Configurations [${scopeLabel}]:\n`);
  if (isFallback && intent) {
    lines.push(`(No config entries matched intent '${intent}', showing all entries)\n`);
  }
  if (items.length === 0) {
    lines.push("  (No configuration entries found)");
  } else {
    for (const item of items) {
      const valStr = typeof item.value === "string" && item.secret && !reveal ? item.value : JSON.stringify(item.value);
      const secretBadge = item.secret ? ", secret" : "";
      lines.push(`  - ${item.key.padEnd(24)} = ${valStr} (${item.source}${secretBadge})`);
    }
  }
  return lines.join("\n");
}

/**
 * 格式化渲染配置依赖规范检查。
 */
export function renderConfigSchema(
  items: Array<{ key: string; status: string; source: string; secret: boolean; description: string }>,
  packageId: string,
  root: string
): string {
  const lines: string[] = [];
  lines.push(`Configuration Requirements for ${packageId} (${root}):\n`);
  if (items.length === 0) {
    lines.push("  (No configuration dependencies declared for this package)");
    return lines.join("\n");
  }

  lines.push(`  ${"KEY".padEnd(24)} ${"STATUS".padEnd(12)} ${"SOURCE".padEnd(10)} ${"SECRET".padEnd(8)} DESCRIPTION`);
  lines.push("  " + "-".repeat(85));

  const missing: string[] = [];
  for (const item of items) {
    const statusLabel = item.status === "SET" ? "[SET]" : item.status === "DEFAULT" ? "[DEFAULT]" : "[MISSING]";
    const secretLabel = item.secret ? "yes" : "no";
    lines.push(`  ${item.key.padEnd(24)} ${statusLabel.padEnd(12)} ${item.source.padEnd(10)} ${secretLabel.padEnd(8)} ${item.description}`);
    if (item.status === "MISSING") {
      missing.push(item.key);
    }
  }

  if (missing.length > 0) {
    lines.push(`\n[WARNING] ${missing.length} required config(s) not set:`);
    for (const m of missing) {
      lines.push(`  - ${m}: Run 'ad config set ${m} <value>' to configure.`);
    }
  } else {
    lines.push("\n[OK] All configuration dependencies are satisfied.");
  }

  return lines.join("\n");
}

/**
 * 格式化渲染环境变量满足率诊断。
 */
export function renderConfigEnv(checks: EnvCheckItem[], packageId?: string): string {
  const lines: string[] = [];
  const targetDesc = packageId ? `for Package '${packageId}'` : "Global";
  lines.push(`Environment Variable Satisfaction Diagnostics ${targetDesc}:\n`);

  if (checks.length === 0) {
    lines.push("  (No configuration dependencies declared)");
    return lines.join("\n");
  }

  lines.push(`  ${"KEY".padEnd(24)} ${"SATISFIED".padEnd(12)} ${"REQUIRED".padEnd(10)} ${"MATCHED ENV".padEnd(28)} SECRET`);
  lines.push("  " + "-".repeat(85));

  for (const c of checks) {
    const satLabel = c.satisfied ? "[OK]" : "[MISSING]";
    const reqLabel = c.required ? "yes" : "no";
    const matched = c.matchedEnv || (c.hasDefault ? "(using default)" : "-");
    const secLabel = c.secret ? "yes" : "no";
    lines.push(`  ${c.key.padEnd(24)} ${satLabel.padEnd(12)} ${reqLabel.padEnd(10)} ${matched.padEnd(28)} ${secLabel}`);
  }

  const missingRequired = checks.filter((c) => c.required && !c.satisfied);
  if (missingRequired.length > 0) {
    lines.push(`\n[WARNING] ${missingRequired.length} required environment variable(s) not satisfied:`);
    for (const m of missingRequired) {
      lines.push(`  - ${m.key}: Please export ${m.key}=... in your environment.`);
    }
  } else {
    lines.push("\n[OK] All declared configuration dependencies are satisfied by environment or defaults.");
  }

  return lines.join("\n");
}

/**
 * 格式化渲染状态键列表。
 */
export function renderStateList(
  keys: string[],
  scopeLabel: string = "Current State",
  isFallback: boolean = false,
  intent?: string
): string {
  const lines: string[] = [];
  lines.push(`State keys for ${scopeLabel} (${keys.length}):\n`);
  if (isFallback && intent) {
    lines.push(`(No state keys matched intent '${intent}', showing all keys)\n`);
  }
  if (keys.length === 0) {
    lines.push("  (no state keys found)");
  } else {
    for (const k of keys) {
      lines.push(`  - ${k}`);
    }
  }
  return lines.join("\n");
}

/**
 * 格式化渲染执行记录列表。
 */
export function renderRunsList(
  items: Array<{ id: string; actionId: string; packageId?: string; status: string; startedAt: string }>,
  scopeLabel: string = "Execution Runs",
  isFallback: boolean = false,
  intent?: string
): string {
  const lines: string[] = [];
  lines.push(`${scopeLabel} (${items.length}):\n`);
  if (isFallback && intent) {
    lines.push(`(No runs matched intent '${intent}', showing all runs)\n`);
  }

  lines.push(`  ${"RUN ID".padEnd(38)} ${"PACKAGE".padEnd(18)} ${"ACTION".padEnd(22)} ${"STATUS".padEnd(10)} STARTED`);
  lines.push("  " + "-".repeat(105));

  for (const r of items) {
    const time = (r.startedAt || "").replace("T", " ").slice(0, 19);
    const pkg = (r.packageId || "").padEnd(18);
    lines.push(`  ${r.id.padEnd(38)} ${pkg} ${r.actionId.padEnd(22)} ${r.status.padEnd(10)} ${time}`);
  }

  return lines.join("\n");
}

/**
 * 格式化渲染单次执行记录详情。
 */
export function renderRunDetail(run: any): string {
  const lines: string[] = [];
  lines.push(`Run:          ${run.id}`);
  lines.push(`Action:       ${run.actionId}`);
  if (run.packageId) lines.push(`Package:      ${run.packageId}`);
  lines.push(`Status:       ${run.status}`);
  if (run.parentRunId) lines.push(`Parent Run:   ${run.parentRunId}`);
  lines.push(`Started:      ${run.startedAt}`);
  if (run.finishedAt) lines.push(`Finished:     ${run.finishedAt}`);

  lines.push("\nInput:");
  lines.push(JSON.stringify(run.input, null, 2));

  if (run.output !== undefined) {
    lines.push("\nOutput:");
    lines.push(JSON.stringify(run.output, null, 2));
  }

  if (run.error) {
    lines.push("\nError:");
    lines.push(JSON.stringify(run.error, null, 2));
  }

  return lines.join("\n");
}
