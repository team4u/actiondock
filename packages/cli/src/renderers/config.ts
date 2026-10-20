import type { ConfigSource } from "@actiondock/core";
import type { EnvCheckItem } from "../types";

/**
 * 格式化渲染配置项列表。
 * 格式化规则：
 * - 根路径脱敏或已配置但整项隐藏显示 <hidden>；
 * - 未显式配置且无有效值显示 <not configured>；
 * - 字符串原样输出，其余类型（包括对象与数组）严格 JSON 序列化（杜绝 [object Object]）。
 */
export function renderConfigList(
  items: Array<{
    key: string;
    value?: unknown;
    source: ConfigSource | null;
    secret: boolean;
    configured?: boolean;
    redactedPaths?: string[];
    description?: string;
  }>,
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
      const valStr = formatSingleConfigDisplay(item);
      const secretBadge = item.secret ? ", secret" : "";
      lines.push(`  - ${item.key.padEnd(24)} = ${valStr} (${item.source}${secretBadge})`);
    }
  }
  return lines.join("\n");
}

/**
 * 格式化单项配置值人类友好展示文本。
 *
 * @param view 包含值、配置状态与脱敏路径的安全视图
 */
export function formatSingleConfigDisplay(view: {
  value?: unknown;
  configured?: boolean;
  redactedPaths?: string[];
}): string {
  const isRootHidden =
    view.redactedPaths?.includes("") || (Boolean(view.configured) && view.value === undefined);

  if (isRootHidden) {
    return "<hidden>";
  }
  if (!view.configured && view.value === undefined) {
    return "<not configured>";
  }
  return formatConfigValue(view.value);
}

/**
 * 格式化配置值：字符串原样输出，其余类型 JSON 序列化。
 */
export function formatConfigValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * 格式化渲染配置依赖规范检查。
 * 针对模板通配项展示独立 [TEMPLATE] 状态及已存储匹配键数量，且不计入缺失告警。
 */
export function renderConfigSchema(
  items: Array<{
    key: string;
    status: string;
    source: ConfigSource | null;
    secret: boolean;
    description: string;
    matchCount?: number;
  }>,
  packageId: string,
  root: string
): string {
  const lines: string[] = [];
  lines.push(`Configuration Requirements for ${packageId} (${root}):\n`);
  if (items.length === 0) {
    lines.push("  (No configuration dependencies declared for this package)");
    return lines.join("\n");
  }

  lines.push(`  ${"KEY".padEnd(24)} ${"STATUS".padEnd(12)} ${"SOURCE".padEnd(14)} ${"MATCHES".padEnd(10)} ${"SECRET".padEnd(8)} DESCRIPTION`);
  lines.push("  " + "-".repeat(95));

  const missing: string[] = [];
  for (const item of items) {
    let statusLabel: string;
    // 来源列只呈现真实 ConfigSource；模板与缺失无生效来源，显示 -
    const sourceLabel = item.source ?? "-";
    // 模板匹配数量单列呈现，不冒充来源
    const matchesLabel = item.status === "TEMPLATE" ? `${item.matchCount ?? 0}` : "-";

    if (item.status === "SET") {
      statusLabel = "[SET]";
    } else if (item.status === "DEFAULT") {
      statusLabel = "[DEFAULT]";
    } else if (item.status === "TEMPLATE") {
      statusLabel = "[TEMPLATE]";
    } else {
      statusLabel = "[MISSING]";
    }

    const secretLabel = item.secret ? "yes" : "no";
    lines.push(
      `  ${item.key.padEnd(24)} ${statusLabel.padEnd(12)} ${sourceLabel.padEnd(14)} ${matchesLabel.padEnd(10)} ${secretLabel.padEnd(8)} ${item.description}`
    );

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
