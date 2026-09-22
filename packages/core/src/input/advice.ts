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

export const FLAT_ENCODING_GUIDELINES: readonly string[] = [
  "字符串: path=TEXT",
  "JSON 标量与结构: path:=JSON (例如 count:=1, enabled:=true)",
  "数组元素: path.INDEX=... (例如 items.0=first)",
  "提示: 复杂嵌套或大段文本建议使用 --input 或 --input-file",
];

/**
 * 单个字段的输入建议明细。
 */
export interface ActionInputFieldAdvice {
  /** 字段路径（属性名） */
  path: string;
  /** 字段类型字符串 */
  type: string;
  /** 是否为必填字段 */
  required: boolean;
  /** 字段名是否满足扁平编码安全规范 */
  flatSafe: boolean;
  /** 编码模板（如 "name=TEXT"、"age:=NUMBER"、"meta:=JSON"），非直接可执行 token */
  assignmentTemplate?: string;
  /** 人类说明文字，如 "大型结构建议使用 --input-file" */
  hint?: string;
  /** 字段描述信息 */
  description?: string;
}

/**
 * Action 输入模式整体编码顾问分析报告。
 */
export interface ActionInputAdvice {
  /** 根模式是否支持扁平入参赋值（仅当根模式为对象且所有 required 字段均具备 flatSafe 赋值方案时为 true） */
  flatSupported: boolean;
  /** 是否存在至少一个可扁平化的字段 */
  hasFlatFields: boolean;
  /** 字段明细清单 */
  fields: ActionInputFieldAdvice[];
  /** 所有必填字段的编码模板数组 */
  requiredTemplates: string[];
  /** 可选字段的编码模板数组 */
  optionalTemplates: string[];
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
  if (!schema || typeof schema !== "object") {
    return {
      flatSupported: false,
      hasFlatFields: false,
      fields: [],
      requiredTemplates: [],
      optionalTemplates: [],
      notes: ["根模式未声明输入字段，直接调用或使用 --input-file / --input '{}'"],
    };
  }

  const s = schema as Record<string, any>;

  // 校验根模式是否为 object 类型
  if (s.type !== undefined && s.type !== "object") {
    return {
      flatSupported: false,
      hasFlatFields: false,
      fields: [],
      requiredTemplates: [],
      optionalTemplates: [],
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
      hasFlatFields: false,
      fields: [],
      requiredTemplates: [],
      optionalTemplates: [],
      notes: ["根模式无声明属性，不支持扁平赋值，建议使用 --input-file 或 --input '{}'"],
    };
  }

  const fields: ActionInputFieldAdvice[] = [];
  const requiredTemplates: string[] = [];
  const optionalTemplates: string[] = [];
  const notes: string[] = [];

  for (const key of propKeys) {
    const prop = properties[key] || {};
    const typeStr = prop.type ? String(prop.type) : "any";
    const isReq = required.includes(key);
    const isFlatSafe = FLAT_SAFE_KEY_REGEX.test(key);

    let assignmentTemplate: string | undefined;
    let hint: string | undefined;

    if (isFlatSafe) {
      if (prop.type === "string") {
        assignmentTemplate = `${key}=TEXT`;
      } else if (prop.type === "number" || prop.type === "integer") {
        assignmentTemplate = `${key}:=NUMBER`;
      } else if (prop.type === "boolean") {
        assignmentTemplate = `${key}:=BOOLEAN`;
      } else if (
        prop.type === "array" &&
        prop.items &&
        typeof prop.items === "object" &&
        prop.items.type === "string"
      ) {
        assignmentTemplate = `${key}.0=TEXT`;
      } else if (
        prop.type === "array" &&
        prop.items &&
        typeof prop.items === "object" &&
        (prop.items.type === "number" || prop.items.type === "integer")
      ) {
        assignmentTemplate = `${key}.0:=NUMBER`;
      } else if (
        prop.type === "array" &&
        prop.items &&
        typeof prop.items === "object" &&
        prop.items.type === "boolean"
      ) {
        assignmentTemplate = `${key}.0:=BOOLEAN`;
      } else if (prop.type === "array") {
        assignmentTemplate = `${key}:=JSON`;
        hint = "数组结构建议使用 --input-file";
      } else if (prop.type === "object") {
        assignmentTemplate = `${key}:=JSON`;
        hint = "大型结构建议使用 --input-file";
      } else {
        assignmentTemplate = `${key}:=JSON`;
        hint = "复杂或未知类型建议使用 --input-file";
      }

      if (isReq) {
        if (assignmentTemplate) {
          requiredTemplates.push(assignmentTemplate);
        }
      } else {
        if (assignmentTemplate) {
          optionalTemplates.push(assignmentTemplate);
        }
      }
    } else {
      hint = "包含非安全字符，建议使用 --input-file";
      notes.push(`属性 '${key}' 包含非安全字符，不支持扁平赋值，建议使用 --input-file`);
    }

    fields.push({
      path: key,
      type: typeStr,
      required: isReq,
      flatSafe: isFlatSafe,
      assignmentTemplate,
      hint,
      description: prop.description,
    });
  }

  const hasFlatFields = fields.some((f) => f.flatSafe && f.assignmentTemplate !== undefined);

  // 仅当根模式为对象且所有 required 字段均具备 flatSafe 赋值方案时为 true
  const allRequiredFlatSafe = required.every((reqKey) => {
    const f = fields.find((field) => field.path === reqKey);
    return f !== undefined && f.flatSafe && f.assignmentTemplate !== undefined;
  });

  const flatSupported = hasFlatFields && allRequiredFlatSafe;

  return {
    flatSupported,
    hasFlatFields,
    fields,
    requiredTemplates,
    optionalTemplates,
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
        const hintStr = field.hint ? ` (${field.hint})` : "";
        lines.push(`  - ${field.path} (${field.type}, ${reqStr})${descStr}${hintStr}`);
      }
    }

    lines.push("\nFlat 编码指引:");
    for (const g of FLAT_ENCODING_GUIDELINES) {
      lines.push(`  - ${g}`);
    }

    if (!advice.flatSupported) {
      lines.push("\n调用模式引导:");
      lines.push(
        `  - 不支持扁平传参，建议使用 --input-file: ad run ${action.id} --json --input-file input.json`
      );
      for (const note of advice.notes) {
        lines.push(`  - [注意] ${note}`);
      }
    } else {
      if (advice.requiredTemplates.length > 0) {
        lines.push("\n必填赋值模板:");
        for (const tmpl of advice.requiredTemplates) {
          lines.push(`  - ${tmpl}`);
        }
      }
      if (advice.optionalTemplates.length > 0) {
        lines.push("\n可选赋值模板:");
        for (const tmpl of advice.optionalTemplates) {
          lines.push(`  - ${tmpl}`);
        }
      }

      lines.push("\n调用模式引导:");
      lines.push(`  - ad run ${action.id} --json -- [assignments...]`);
      lines.push(`  - 复杂输入: ad run ${action.id} --json --input-file input.json`);

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
