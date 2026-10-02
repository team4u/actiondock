import { createHash } from "node:crypto";
import { MCP_TOOL_NAME_COLLISION } from "@actiondock/core";
import { parseActionRef } from "@actiondock/core/graph";
import { isActionAllowed } from "@actiondock/core/server";

/**
 * 构造携带结构化错误码的工具名冲突异常。
 *
 * @param toolName 冲突的工具名
 */
export function toolNameCollisionError(toolName: string): Error & { code: string } {
  const err = new Error(`MCP tool name collision detected for tool '${toolName}'`) as Error & {
    code: string;
  };
  err.code = MCP_TOOL_NAME_COLLISION;
  return err;
}

/**
 * 解析 Action 引用字符串为包标识与动作标识（容错语义）。
 *
 * 委派 core 的 parseActionRef 单一事实源完成解析；非法形态（如尾部斜杠、
 * 含冒号等）回退为整体短名处理，与适配层既有的注册容错行为保持一致，
 * 不让目录聚合阶段的脏数据中断服务启动。
 */
export function splitActionRef(ref: string): { packageId?: string; actionId: string } {
  try {
    return parseActionRef(ref);
  } catch {
    return { actionId: ref };
  }
}

export interface MappedAction<T> {
  toolName: string;
  action: T;
  isMultiPackage: boolean;
  description?: string;
}

/**
 * 映射与过滤工具，处理冲突检测、去重、白名单过滤及 SHA-256 截断散列逻辑。
 */
export function mapAndFilterActions<T extends { id: string; packageId?: string; description?: string }>(
  rawActions: T[],
  allowedPackageIds?: string[],
  actionAllowlist?: string[]
): MappedAction<T>[] {
  // 引用解析单点归一：每项仅解析一次，后续各轮（白名单过滤、去重、频次统计、
  // 工具命名）复用同一结果，避免同一列表对 splitActionRef 的三轮重复调用；
  // 显式 packageId 与解析所得 packageId 分别留存，各轮按既有优先级消费
  const parsedRefs = new Map<
    T,
    { explicitPkgId: string; parsedPkgId?: string; baseId: string }
  >();
  
  for (const act of rawActions) {
    if (act.id.includes("/")) {
      const parsed = splitActionRef(act.id);
      parsedRefs.set(act, {
        explicitPkgId: act.packageId || "",
        parsedPkgId: parsed.packageId,
        baseId: parsed.actionId,
      });
    } else {
      parsedRefs.set(act, { explicitPkgId: act.packageId || "", baseId: act.id });
    }
  }

  if (allowedPackageIds && allowedPackageIds.length > 0) {
    // 白名单轮：显式 packageId 优先，缺失时回退解析所得
    rawActions = rawActions.filter((act) => {
      const ref = parsedRefs.get(act)!;
      const pkgId = ref.explicitPkgId || ref.parsedPkgId || "";
      return pkgId ? allowedPackageIds.includes(pkgId) : false;
    });
  }

  if (actionAllowlist && actionAllowlist.length > 0) {
    rawActions = rawActions.filter((act) => {
      const ref = parsedRefs.get(act)!;
      const pkgId = ref.explicitPkgId || ref.parsedPkgId || undefined;
      return isActionAllowed({ packageId: pkgId, actionId: ref.baseId }, actionAllowlist);
    });
  }

  const seenActionKeys = new Map<string, T>();
  for (const act of rawActions) {
    const ref = parsedRefs.get(act)!;
    const pkgId = ref.explicitPkgId || ref.parsedPkgId || "";
    const key = `${pkgId}:${ref.baseId}`;
    const existing = seenActionKeys.get(key);
    if (existing) {
      // 若已存在的项是全限定名（含 /），而当前项是短名（不含 /），优先保留短名项
      if (existing.id.includes("/") && !act.id.includes("/")) {
        seenActionKeys.set(key, act);
      }
    } else {
      seenActionKeys.set(key, act);
    }
  }
  const actions = Array.from(seenActionKeys.values());

  // 统计 Action 基础 ID 出现频次，用于同名冲突命名空间隔离
  const baseCounts = new Map<string, number>();
  for (const act of actions) {
    const baseId = parsedRefs.get(act)!.baseId;
    baseCounts.set(baseId, (baseCounts.get(baseId) || 0) + 1);
  }

  const registeredToolNames = new Set<string>();

  // 多包判定（循环外一次算清）：不同 packageId 去重计数大于 1，
  // 或任一 id 含斜杠（跨包限定名形态），则工具描述需附全限定 id 锚点；
  // 本轮与工具命名轮一致：解析所得 packageId 优先，缺失时回退显式声明
  const distinctPackageIds = new Set(
    actions
      .map((a) => {
        const ref = parsedRefs.get(a)!;
        return ref.parsedPkgId || a.packageId;
      })
      .filter((pkg): pkg is string => Boolean(pkg))
  );
  const isMultiPackage = distinctPackageIds.size > 1 || actions.some((a) => a.id.includes("/"));

  const mappedActions: MappedAction<T>[] = [];

  for (const action of actions) {
    const ref = parsedRefs.get(action)!;
    const baseId = ref.baseId;
    const packageId = ref.parsedPkgId || action.packageId;

    const count = baseCounts.get(baseId) || 1;
    let toolName = baseId;
    if (count > 1 && packageId) {
      const cleanPkgId = packageId.replace(/^@/, "").replace(/[^a-zA-Z0-9_-]+/g, "_");
      toolName = `${cleanPkgId}_${baseId}`;
    } else if (toolName.includes("/") && packageId) {
      const cleanPkgId = packageId.replace(/^@/, "").replace(/[^a-zA-Z0-9_-]+/g, "_");
      toolName = `${cleanPkgId}_${baseId}`;
    }

    if (toolName.length > 64) {
      const hash = createHash("sha256").update(toolName).digest("hex").slice(0, 8);
      toolName = `${toolName.slice(0, 55)}_${hash}`;
    }

    if (registeredToolNames.has(toolName)) {
      throw toolNameCollisionError(toolName);
    }
    registeredToolNames.add(toolName);

    const description = isMultiPackage
      ? `[${action.id}] ${action.description || ""}`.trim()
      : action.description;

    mappedActions.push({ toolName, action, isMultiPackage, description });
  }

  return mappedActions;
}
