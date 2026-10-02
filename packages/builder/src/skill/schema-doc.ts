const MAX_DISPLAYED_PARAMS = 5;

/**
 * 格式化输入参数模式为紧凑的说明书文档条目。
 * 仅保留核心关键参数摘要，防止深层复杂模式导致上下文暴涨，引导通过 describe 查阅完整定义。
 */
export function formatInputSchema(schema: any): string[] {
  const lines: string[] = [];
  if (
    !schema ||
    typeof schema !== "object" ||
    !schema.properties ||
    typeof schema.properties !== "object"
  ) {
    lines.push("  - 输入参数: 无");
    return lines;
  }

  const props = schema.properties as Record<string, any>;
  const req = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const propKeys = Object.keys(props);

  if (propKeys.length === 0) {
    lines.push("  - 输入参数: 无");
    return lines;
  }

  lines.push("  - 输入参数:");

  // 必填参数优先排列，其余参数保持既有顺序
  const sortedKeys = [...propKeys].sort((a, b) => {
    const aReq = req.includes(a);
    const bReq = req.includes(b);
    if (aReq && !bReq) return -1;
    if (!aReq && bReq) return 1;
    return 0;
  });

  const displayedKeys = sortedKeys.slice(0, MAX_DISPLAYED_PARAMS);
  for (const k of displayedKeys) {
    const p = props[k] || {};
    const typeStr = typeof p.type === "string"
      ? `\`${p.type}\``
      : Array.isArray(p.type)
        ? `\`${p.type.join("|")}\``
        : "`any`";
    const reqStr = req.includes(k) ? ", 必填" : "";
    const rawDesc = typeof p.description === "string" ? p.description.split("\n")[0].trim() : "";
    const descStr = rawDesc ? `: ${rawDesc}` : "";

    let defStr = "";
    if (p.default !== undefined) {
      const defJson = JSON.stringify(p.default);
      if (defJson && defJson.length <= 30) {
        defStr = ` (默认值: \`${defJson}\`)`;
      }
    }

    lines.push(`    - \`${k}\` (${typeStr}${reqStr})${descStr}${defStr}`);
  }

  if (sortedKeys.length > MAX_DISPLAYED_PARAMS) {
    const omittedCount = sortedKeys.length - MAX_DISPLAYED_PARAMS;
    lines.push(`    - （其余 ${omittedCount} 个参数已省略，完整参数模式请通过 describe 命令查阅）`);
  }

  return lines;
}

/**
 * 格式化输出字段模式为紧凑的说明书文档条目。
 * 仅保留核心关键字段摘要，防止深层复杂模式展开，引导通过 describe 查阅完整定义。
 */
export function formatOutputSchema(schema: any): string[] {
  const lines: string[] = [];
  if (
    !schema ||
    typeof schema !== "object" ||
    !schema.properties ||
    typeof schema.properties !== "object"
  ) {
    return lines;
  }

  const outProps = schema.properties as Record<string, any>;
  const outKeys = Object.keys(outProps);
  if (outKeys.length === 0) {
    return lines;
  }

  lines.push("  - 输出字段:");
  const displayedKeys = outKeys.slice(0, MAX_DISPLAYED_PARAMS);
  for (const k of displayedKeys) {
    const p = outProps[k] || {};
    const typeStr = typeof p.type === "string"
      ? `\`${p.type}\``
      : Array.isArray(p.type)
        ? `\`${p.type.join("|")}\``
        : "`any`";
    const rawDesc = typeof p.description === "string" ? p.description.split("\n")[0].trim() : "";
    const descStr = rawDesc ? `: ${rawDesc}` : "";
    lines.push(`    - \`${k}\` (${typeStr})${descStr}`);
  }

  if (outKeys.length > MAX_DISPLAYED_PARAMS) {
    const omittedCount = outKeys.length - MAX_DISPLAYED_PARAMS;
    lines.push(`    - （其余 ${omittedCount} 个字段已省略，完整模式请通过 describe 命令查阅）`);
  }

  return lines;
}
