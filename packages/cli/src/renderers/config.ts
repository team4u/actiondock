import type { EnvCheckItem } from "../types";

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
export function formatConfigValue(value: unknown): string {
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
