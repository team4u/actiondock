/**
 * Action 输入编码顾问（Encoding Advisor）。
 *
 * 职责：
 * - 集中分析 Action 的 inputSchema，评估是否支持扁平输入（Flat Encoding）。
 * - 针对合法的扁平字段生成类型感知型赋值建议（key=TEXT, key:=JSON, key.0=TEXT 等）。
 * - 针对非对象根模式、空属性模式或非法键名提供结构化回退提示（推荐 --input-file）。
 * - 提供共享的文本格式化输出，确保 CLI 与独立分发器（Standalone）的交互体验完全一致。
 */

export const FLAT_SAFE_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * 单个字段的输入建议明细。
 */
export interface ActionInputFieldAdvice {
  /** 字段属性名 */
  name: string;
  /** 字段类型字符串 */
  type: string;
  /** 是否为必填字段 */
  required: boolean;
  /** 字段描述信息 */
  description?: string;
  /** 建议赋值表达式（仅在 flatSafe 为 true 时存在） */
  suggestedAssignment?: string;
  /** 字段名是否满足扁平编码安全规范 */
  flatSafe: boolean;
}

/**
 * Action 输入模式整体编码顾问分析报告。
 */
export interface ActionInputAdvice {
  /** 根模式是否支持扁平入参赋值 */
  flatSupported: boolean;
  /** 字段明细清单 */
  fields: ActionInputFieldAdvice[];
  /** 扁平编码全局指引清单 */
  guidelines: string[];
  /** 建议赋值样例清单 */
  suggestedAssignments: string[];
  /** 结构化提示与降级说明清单 */
  notes: string[];
}

/**
 * 依据 inputSchema 构造统一的 Action 输入编码建议。
 *
 * @param schema Action 的 inputSchema 定义
 * @returns 结构化编码建议报告
 */
export function buildActionInputAdvice(schema: unknown): ActionInputAdvice {
  const guidelines: string[] = [
    "字符串: path=TEXT",
    "JSON 标量与结构: path:=JSON (例如 count:=1, enabled:=true)",
    "数组元素: path.INDEX=... (例如 items.0=first)",
    "提示: 复杂嵌套或大段文本建议使用 --input 或 --input-file",
  ];

  if (!schema || typeof schema !== "object") {
    return {
      flatSupported: false,
      fields: [],
      guidelines,
      suggestedAssignments: [],
      notes: ["根模式未声明输入字段，直接调用或使用 --input-file / --input '{}'"],
    };
  }

  const s = schema as Record<string, any>;

  // 校验根模式是否为 object 类型
  if (s.type !== undefined && s.type !== "object") {
    return {
      flatSupported: false,
      fields: [],
      guidelines,
      suggestedAssignments: [],
      notes: [
        `根模式类型为 '${s.type}'，不支持扁平赋值，建议使用 --input-file 或 --input`,
      ],
    };
  }

  const properties = (s.properties || {}) as Record<string, any>;
  const required = Array.isArray(s.required) ? (s.required as string[]) : [];
  const propKeys = Object.keys(properties);

  if (propKeys.length === 0) {
    return {
      flatSupported: false,
      fields: [],
      guidelines,
      suggestedAssignments: [],
      notes: ["根模式无声明属性，不支持扁平赋值，建议使用 --input-file 或 --input '{}'"],
    };
  }

  const fields: ActionInputFieldAdvice[] = [];
  const suggestedAssignments: string[] = [];
  const notes: string[] = [];

  let hasFlatSafeField = false;

  for (const key of propKeys) {
    const prop = properties[key] || {};
    const typeStr = prop.type ? String(prop.type) : "any";
    const isReq = required.includes(key);
    const isFlatSafe = FLAT_SAFE_KEY_REGEX.test(key);

    let suggestion: string | undefined;

    if (isFlatSafe) {
      hasFlatSafeField = true;
      if (prop.type === "string") {
        suggestion = `${key}=TEXT`;
      } else if (
        prop.type === "number" ||
        prop.type === "integer" ||
        prop.type === "boolean"
      ) {
        suggestion = `${key}:=JSON`;
      } else if (
        prop.type === "array" &&
        prop.items &&
        typeof prop.items === "object" &&
        prop.items.type === "string"
      ) {
        suggestion = `${key}.0=TEXT`;
      } else if (
        prop.type === "array" &&
        prop.items &&
        typeof prop.items === "object" &&
        (prop.items.type === "number" ||
          prop.items.type === "integer" ||
          prop.items.type === "boolean")
      ) {
        suggestion = `${key}.0:=JSON`;
      } else if (prop.type === "array") {
        suggestion = `${key}.0=... (数组元素建议使用 ${key}.0=TEXT 或 --input-file)`;
      } else if (prop.type === "object") {
        suggestion = `${key}.<field>=... (复杂嵌套建议使用 --input 或 --input-file)`;
      } else {
        suggestion = `${key}=... (复杂或未知类型建议使用 --input 或 --input-file)`;
      }
      suggestedAssignments.push(suggestion);
    } else {
      notes.push(`属性 '${key}' 包含非安全字符，不支持扁平赋值，建议使用 --input-file`);
    }

    fields.push({
      name: key,
      type: typeStr,
      required: isReq,
      description: prop.description,
      suggestedAssignment: suggestion,
      flatSafe: isFlatSafe,
    });
  }

  return {
    flatSupported: hasFlatSafeField,
    fields,
    guidelines,
    suggestedAssignments,
    notes,
  };
}

/**
 * 格式化渲染 Action 详情与编码顾问建议文本。
 * CLI 与 Standalone 统一复用该函数，保证输出内容与排版风格完全一致。
 *
 * @param action Action 规格信息
 * @returns 格式化后的说明文本
 */
export function formatActionDetail(action: {
  id: string;
  packageId?: string;
  projectRoot?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}): string {
  const lines: string[] = [];
  lines.push(`Action: ${action.id}`);
  if (action.packageId) {
    const rootDesc = action.projectRoot ? ` (${action.projectRoot})` : "";
    lines.push(`Package: ${action.packageId}${rootDesc}`);
  }
  if (action.description) {
    lines.push(`Description: ${action.description}`);
  }

  if (action.inputSchema && typeof action.inputSchema === "object") {
    const advice = buildActionInputAdvice(action.inputSchema);

    lines.push("\nInput Schema 字段明细:");
    if (advice.fields.length === 0) {
      lines.push("  - 无声明字段属性");
    } else {
      for (const field of advice.fields) {
        const reqStr = field.required ? "必填" : "可选";
        const descStr = field.description ? ` - ${field.description}` : "";
        lines.push(`  - ${field.name} (${field.type}, ${reqStr})${descStr}`);
      }
    }

    lines.push("\nFlat 编码指引:");
    for (const g of advice.guidelines) {
      lines.push(`  - ${g}`);
    }

    lines.push("\n建议赋值样例 (Suggested Assignments):");
    if (!advice.flatSupported || advice.suggestedAssignments.length === 0) {
      if (advice.notes.length > 0) {
        for (const note of advice.notes) {
          lines.push(`  - (${note})`);
        }
      } else {
        lines.push("  - (无输入字段，直接调用或使用 --input '{}')");
      }
    } else {
      for (const item of advice.suggestedAssignments) {
        lines.push(`  - ${item}`);
      }
      for (const note of advice.notes) {
        lines.push(`  - [注意] ${note}`);
      }
    }
  } else {
    lines.push("\nInput Schema: 无");
  }

  if (action.outputSchema) {
    lines.push("\nOutput Schema:");
    lines.push(JSON.stringify(action.outputSchema, null, 2));
  }

  return lines.join("\n");
}
