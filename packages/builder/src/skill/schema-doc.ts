export function formatInputSchema(schema: any): string[] {
  const lines: string[] = [];
  if (
    schema &&
    typeof schema === "object" &&
    schema.properties
  ) {
    const props = schema.properties as Record<string, any>;
    const req = (schema.required || []) as string[];
    const propKeys = Object.keys(props);

    if (propKeys.length > 0) {
      lines.push("  - 输入参数:");
      for (const k of propKeys) {
        const p = props[k] || {};
        const typeStr = p.type ? `\`${p.type}\`` : "`any`";
        const reqStr = req.includes(k) ? ", 必填" : "";
        const descStr = p.description ? `: ${p.description}` : "";
        const defStr =
          p.default !== undefined
            ? ` (默认值: \`${JSON.stringify(p.default)}\`)`
            : "";
        lines.push(`    - \`${k}\` (${typeStr}${reqStr})${descStr}${defStr}`);
      }
    } else {
      lines.push("  - 输入参数: 无");
    }
  } else {
    lines.push("  - 输入参数: 无");
  }
  return lines;
}

export function formatOutputSchema(schema: any): string[] {
  const lines: string[] = [];
  if (
    schema &&
    typeof schema === "object" &&
    schema.properties
  ) {
    const outProps = schema.properties as Record<string, any>;
    const outKeys = Object.keys(outProps);
    if (outKeys.length > 0) {
      lines.push("  - 输出字段:");
      for (const k of outKeys) {
        const p = outProps[k] || {};
        const typeStr = p.type ? `\`${p.type}\`` : "`any`";
        const descStr = p.description ? `: ${p.description}` : "";
        lines.push(`    - \`${k}\` (${typeStr})${descStr}`);
      }
    }
  }
  return lines;
}
