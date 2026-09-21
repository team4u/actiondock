import type { ActionDefinition, ActionRef } from "@actiondock/sdk";
import { ActionResolver } from "../catalog/action-resolver";

/**
 * Action 注册表（单一职责模块）。
 *
 * 收敛 ActionRunner 原内联的纯注册逻辑：Action 注册与检索、匿名 Action 稳定标识
 * 分配、以及本地注册表阶梯检索（跨包限定标识优先、本包短标识回退）。动态解析
 * （自定义 resolver 委托与全局链接注册表按需加载）属于 Runner 编排职责，仍留在
 * runner.ts 中，仅通过本注册表完成注册副作用。
 */

/** 匿名传入 Action 对象的稳定标识分配表（同一对象跨多次调用复用同一标识） */
const anonymousActionIds = new WeakMap<object, string>();
let anonymousActionCounter = 0;

/**
 * 为匿名传入的 Action 定义对象解析或分配稳定标识。
 */
export function resolveAnonymousActionId(
  actions: Map<string, ActionDefinition>,
  action: ActionDefinition
): string {
  const actObj = action as any;
  let foundId: string | undefined;
  for (const [id, a] of actions) {
    if (a === action) {
      foundId = id;
      break;
    }
  }
  if (foundId) {
    return foundId;
  }
  let anonId = anonymousActionIds.get(action);
  if (!anonId) {
    anonymousActionCounter++;
    anonId = `anonymous-action-${anonymousActionCounter}`;
    anonymousActionIds.set(action, anonId);
  }
  try {
    actObj.id = anonId;
  } catch {}
  return anonId;
}

/**
 * Action 注册表：持有 Action 标识到定义的映射并提供注册与检索能力。
 */
export class ActionRegistry {
  private actions: Map<string, ActionDefinition>;

  constructor(actions?: Map<string, ActionDefinition>) {
    this.actions = actions || new Map();
  }

  /** 底层映射表（调用方只读使用，写入仅经注册入口） */
  public get map(): Map<string, ActionDefinition> {
    return this.actions;
  }

  /**
   * 注册单个 Action。
   */
  public registerAction(id: string, action: ActionDefinition): void;
  public registerAction(
    action: ({ id: string; action?: ActionDefinition } & Partial<ActionDefinition>) | ActionDefinition
  ): void;
  public registerAction(
    idOrAction:
      | string
      | (({ id: string; action?: ActionDefinition } & Partial<ActionDefinition>) | ActionDefinition),
    actionDef?: ActionDefinition
  ): void {
    if (typeof idOrAction === "string") {
      if (actionDef) {
        this.actions.set(idOrAction, actionDef);
      }
    } else {
      const actObj = idOrAction as any;
      const id = actObj.id || "anonymous-action";
      const act = actObj.action || (actObj.run ? actObj : undefined);
      if (act) {
        this.actions.set(id, act);
      }
    }
  }

  /**
   * 根据 ID 检索注册的 Action。
   */
  public getAction(id: string): ActionDefinition | undefined {
    return this.actions.get(id);
  }

  /**
   * 检索全部已注册的 Action 列表。
   */
  public listActions(): ActionDefinition[] {
    return Array.from(this.actions.values());
  }
}

/**
 * 本地注册表阶梯检索：跨包引用查 "pkg/action"，本包引用依次查短标识与限定标识。
 */
export function findLocalAction(
  actions: Map<string, ActionDefinition>,
  parsed: ActionRef,
  currentPackageId: string
): ActionDefinition | undefined {
  const targetActionId = parsed.actionId;
  const targetPackageId = parsed.packageId;
  if (targetPackageId && targetPackageId !== currentPackageId) {
    return actions.get(`${targetPackageId}/${targetActionId}`);
  }
  return (
    actions.get(targetActionId) ||
    (currentPackageId ? actions.get(`${currentPackageId}/${targetActionId}`) : undefined)
  );
}

/**
 * 判定传入对象是否为可执行的 Action 定义对象（含 run 函数）。
 *
 * 判定语义与原内联实现完全一致：null 入参同样在 `in` 运算处抛出 TypeError，
 * 不额外吞异或静默改道，保持边界行为零变化。
 */
export function isActionDefinitionObject(value: unknown): value is ActionDefinition {
  return (
    typeof value === "object" &&
    "run" in (value as object) &&
    typeof (value as any).run === "function"
  );
}

/**
 * 解析 Action 引用或标识符（解析失败抛出原始异常，由调用方分类处理）。
 */
export function parseActionRef(ref: ActionRef | string): ActionRef {
  return ActionResolver.parseRef(ref);
}
