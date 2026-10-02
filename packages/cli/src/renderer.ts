import type { RunRecord } from "@actiondock/sdk";
import type { ActionSpec } from "@actiondock/core";
import {
  buildActionDescribePayload,
  ACTION_DESCRIBE_SYNTAX_REFERENCE,
} from "@actiondock/core/project";
import {
  type RegistryStatusReport,
} from "@actiondock/core/registry";
import type {
  Envelope,
  ProjectDetailInfo,
  ProjectDetailJson,
  ProjectDetailConfigItem,
  ProjectDetailPlaybookItem,
  ProjectDetailActionItem,
  AggregatedPackage,
  EnvCheckItem,
  CliContext,
} from "./types";
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
  meta?: Record<string, unknown>,
  hint?: string
): Envelope<never> {
  const effectiveHint =
    hint ??
    (details && typeof details === "object" && typeof (details as any).hint === "string"
      ? (details as any).hint
      : undefined);

  const result: Envelope<never> = {
    ok: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
  if (effectiveHint !== undefined) {
    result.hint = effectiveHint;
  }
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
export function writeStdout(message: string, context?: CliContext): void {
  if (context?.stdout) {
    context.stdout(message);
  } else {
    console.log(message);
  }
}

/**
 * 标准错误写入辅助方法。
 */
export function writeStderr(message: string, context?: CliContext): void {
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
    humanFormatter?: () => string;
    context?: CliContext;
  }
): void {
  const isJson = Boolean(options.json);

  if (isJson) {
    writeStdout(formatJson(data), options.context);
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
    context?: CliContext;
  }
): void {
  const formatted = formatError(err);
  const isMachine = Boolean(options.json);

  if (isMachine) {
    const errorEnv = createErrorEnvelope(
      formatted.code,
      formatted.message,
      formatted.details,
      undefined,
      formatted.hint
    );
    writeStdout(formatJson(errorEnv), options.context);
  } else {
    writeStderr(`Error: ${formatted.message}`, options.context);
    if (formatted.hint) {
      writeStderr(formatted.hint, options.context);
    }
  }
}

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
  lines.push("\nTip: For composite or multi-step tasks, check 'ad playbook list' for standard operating procedures.");
  return lines.join("\n");
}

/**
 * 格式化渲染 Action 详情人类可读文本。
 *
 * @param input Action 描述载荷或 Action 规范
 * @returns 格式化后的说明文本
 */
export function formatActionDetail(
  input:
    | ReturnType<typeof buildActionDescribePayload>
    | (Partial<ActionSpec> & { id: string })
    | {
        id: string;
        packageId?: string;
        projectRoot?: string;
        description?: string;
        inputSchema?: unknown;
        outputSchema?: unknown;
        tags?: string[];
        annotations?: Record<string, unknown>;
        uses?: string[];
        entry?: string;
        [key: string]: any;
      }
): string {
  const payload =
    "inputAdvice" in input && (input as any).inputAdvice
      ? (input as ReturnType<typeof buildActionDescribePayload>)
      : buildActionDescribePayload(input as any);

  const lines: string[] = [];
  lines.push(`Action: ${payload.id}`);
  if (payload.packageId) {
    lines.push(`Package: ${payload.packageId}`);
  }
  if (payload.description) {
    lines.push(`Description: ${payload.description}`);
  }
  if (payload.tags && payload.tags.length > 0) {
    lines.push(`Tags: ${payload.tags.join(", ")}`);
  }
  if (payload.uses && payload.uses.length > 0) {
    lines.push(`Uses: ${payload.uses.join(", ")}`);
  }
  if (payload.entry) {
    lines.push(`Entry: ${payload.entry}`);
  }

  if (payload.inputSchema !== undefined) {
    lines.push("");
    lines.push("Input Schema:");
    lines.push(
      typeof payload.inputSchema === "string"
        ? payload.inputSchema
        : JSON.stringify(payload.inputSchema, null, 2)
    );
  }

  if (payload.outputSchema !== undefined) {
    lines.push("");
    lines.push("Output Schema:");
    lines.push(
      typeof payload.outputSchema === "string"
        ? payload.outputSchema
        : JSON.stringify(payload.outputSchema, null, 2)
    );
  }

  lines.push("");
  lines.push(`Recommended Input: ${payload.inputAdvice.recommendedMode}`);

  if (payload.inputAdvice.reason) {
    lines.push(`Reason: ${payload.inputAdvice.reason}`);
  }

  const hasAssignments = Boolean(
    payload.inputAdvice.assignments &&
      Object.keys(payload.inputAdvice.assignments).length > 0
  );

  if (hasAssignments) {
    lines.push("");
    lines.push("Assignments:");
    for (const [key, op] of Object.entries(payload.inputAdvice.assignments!)) {
      lines.push(`  ${key}${op}`);
    }
  }

  if (payload.inputAdvice.recommendedMode === "flat" || hasAssignments) {
    lines.push("");
    lines.push("Syntax Reference:");
    lines.push(...(payload.syntaxReference || ACTION_DESCRIBE_SYNTAX_REFERENCE));
  }

  if (payload.inputAdvice.issues && payload.inputAdvice.issues.length > 0) {
    lines.push("");
    lines.push("Issues:");
    for (const issue of payload.inputAdvice.issues) {
      lines.push(`  - ${issue.path}: ${issue.code}`);
    }
  }

  return lines.join("\n");
}

/**
 * 格式化渲染 Action 详情（编码顾问 Encoding Advisor）。
 * 统一复用 formatActionDetail 实现。
 */
export function renderActionDetail(action: {
  id: string;
  packageId?: string;
  projectRoot?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}): string {
  return formatActionDetail(action);
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
  items: Array<{ id: string; description?: string; packageId?: string }>,
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
  lines.push("\nTip: Run 'ad playbook show <id>' to inspect procedure steps before execution.");
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
  lines.push("\nTip: Follow steps sequentially. Invoke constituent actions using 'ad run <action> [options] -- <assignments...>'.");
  return lines.join("\n");
}

/**
 * 格式化渲染配置项列表。
 * 掩码决策收敛在命令层（传入的 value 已完成是否打码处理），
 * 此处仅负责值的字符串格式化：字符串原样输出，其余类型 JSON 序列化。
 */
export function renderConfigList(
  items: Array<{ key: string; value: unknown; source: string; secret: boolean; description?: string }>,
  scopeLabel: string = "Global Scope",
  isFallback: boolean = false,
  intent?: string
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
      const valStr = formatConfigValue(item.value);
      const secretBadge = item.secret ? ", secret" : "";
      lines.push(`  - ${item.key.padEnd(24)} = ${valStr} (${item.source}${secretBadge})`);
    }
  }
  return lines.join("\n");
}

/**
 * 格式化配置值：字符串原样输出，其余类型 JSON 序列化。
 */
function formatConfigValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
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
export function renderRunDetail(run: RunRecord): string {
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
