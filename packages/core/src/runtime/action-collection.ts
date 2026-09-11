import type { ActionDefinition } from "@actiondock/sdk";
import type { ActionSpec } from "../app/types";

/**
 * 归一化 Action 集合的产物结构。
 */
export interface NormalizedActionCollection {
  /** Action 标识到定义的映射表 */
  actionsMap: Map<string, ActionDefinition>;
  /** Action 标识到元数据规范的映射表 */
  actionSpecs: Record<string, ActionSpec>;
}

/**
 * 将任意形态的 Action 集合输入归一化为统一结构。
 *
 * 支持三种输入形态：
 * - Map 映射表：键即 Action 标识。
 * - 对象数组：每项以 id 字段定位，action 字段或自身作为定义。
 * - 普通对象：键值对即标识与定义。
 *
 * 作为 app 层与独立运行分发器的归一化逻辑单一事实源（Runner 构造仅接受 Map 形态，无需归一化）。
 */
export function normalizeActionCollection(
  rawActions?:
    | Map<string, ActionDefinition>
    | Array<
        | ({ id: string; action?: ActionDefinition } & Partial<ActionSpec>)
        | (ActionDefinition & { id: string })
      >
    | Record<string, ActionDefinition>
): NormalizedActionCollection {
  const actionsMap = new Map<string, ActionDefinition>();
  const actionSpecs: Record<string, ActionSpec> = {};

  if (!rawActions) {
    return { actionsMap, actionSpecs };
  }

  if (rawActions instanceof Map) {
    for (const [k, v] of rawActions) {
      actionsMap.set(k, v);
      actionSpecs[k] = {
        id: k,
        description: (v as any).description,
        inputSchema: (v as any).inputSchema,
        outputSchema: (v as any).outputSchema,
      };
    }
    return { actionsMap, actionSpecs };
  }

  if (Array.isArray(rawActions)) {
    for (const item of rawActions as any[]) {
      const id = item.id;
      const act = item.action ?? item;
      if (id) {
        actionsMap.set(id, act);
        actionSpecs[id] = {
          id,
          description: item.description ?? act.description,
          inputSchema: item.inputSchema ?? act.inputSchema,
          outputSchema: item.outputSchema ?? act.outputSchema,
        };
      }
    }
    return { actionsMap, actionSpecs };
  }

  if (typeof rawActions === "object") {
    for (const [k, v] of Object.entries(rawActions)) {
      actionsMap.set(k, v);
      actionSpecs[k] = {
        id: k,
        description: (v as any).description,
        inputSchema: (v as any).inputSchema,
        outputSchema: (v as any).outputSchema,
      };
    }
  }

  return { actionsMap, actionSpecs };
}
