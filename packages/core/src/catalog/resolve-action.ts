import type { ActionContract, ActionRef, ResolvedActionRef } from "@actiondock/sdk";
import type { PackageIdentity } from "../runtime/identity";
import type { ActionCatalog } from "./action-catalog";
import type { PackageGraph } from "./graph";

/**
 * ActionRef 解析上下文。
 */
export interface ResolveActionContext {
  /** 当前调用方包身份或包标识（可选） */
  caller?: PackageIdentity | string;
  /** 包拓扑图单一事实源 */
  graph: PackageGraph;
  /** 动作目录索引单一事实源 */
  catalog: ActionCatalog;
}

/**
 * Action 解析最终结果。
 */
export interface ResolvedAction {
  /** 规范化解析引用值对象 */
  readonly ref: ResolvedActionRef;
  /** 目标包身份标识值对象 */
  readonly package: PackageIdentity;
  /** 动作入口文件相对路径 */
  readonly entry: string;
  /** 动作契约元数据规范 */
  readonly contract: ActionContract;
}

/**
 * 规范化解析动作引用字符串或对象为 ActionRef。
 * 铁律：ActionRef 解析只有一个事实源。
 */
export function parseActionRef(ref: ActionRef | string): ActionRef {
  if (typeof ref === "object" && ref !== null) {
    if (!ref.actionId) {
      throw new Error("Invalid action identifier: actionId is required");
    }
    return ref;
  }

  const str = String(ref).trim();
  if (!str) {
    throw new Error("Invalid action identifier: cannot be empty");
  }

  if (str.includes("/")) {
    const lastSlashIndex = str.lastIndexOf("/");
    const packageId = str.slice(0, lastSlashIndex);
    const actionId = str.slice(lastSlashIndex + 1);

    if (!packageId || !actionId || actionId.includes(":") || actionId.includes("/") || actionId.includes("..")) {
      throw new Error(`Invalid action identifier: '${str}'`);
    }
    return { packageId, actionId };
  }

  // 检查旧语法兼容提示
  if (str.includes(":")) {
    const parts = str.split(":");
    throw new Error(
      `Legacy syntax '${str}' is deprecated. Please use '${parts.join("/")}' instead.`
    );
  }

  return { actionId: str };
}

/**
 * 纯领域动作解析函数 resolveAction。
 * 铁律：ActionRef 解析只有一个事实源，禁止各模块各自编写短名匹配或启发式搜索。
 * 
 * 解析次序：
 * 1. 显式包限定标识符精确查找目标包与动作
 * 2. 裸标识符优先查找 caller 调用者所在包
 * 3. 裸标识符全局搜索：单命中返回、多命中抛出歧义异常、零命中抛出未找到异常
 */
export function resolveAction(
  ref: ActionRef | string,
  context: ResolveActionContext
): ResolvedAction {
  const parsed = parseActionRef(ref);

  // 1. 显式指定 packageId
  if (parsed.packageId) {
    const node = context.graph.packages.get(parsed.packageId);
    if (!node) {
      const err: any = new Error(`PACKAGE_NOT_FOUND: Package '${parsed.packageId}' not found`);
      err.code = "PACKAGE_NOT_FOUND";
      throw err;
    }

    const matches = context.catalog.find({
      packageId: parsed.packageId,
      actionId: parsed.actionId,
    });
    if (matches.length === 0) {
      const err: any = new Error(
        `ACTION_NOT_FOUND: Action '${parsed.actionId}' not found in package '${parsed.packageId}'`
      );
      err.code = "ACTION_NOT_FOUND";
      throw err;
    }

    const candidate = matches[0];
    return {
      ref: {
        packageId: node.identity.id,
        packageInstanceId: node.identity.instanceId,
        actionId: parsed.actionId,
        generationId: node.identity.generation,
      },
      package: node.identity,
      entry: candidate.entry,
      contract: candidate.contract,
    };
  }

  // 2. 裸标识符优先匹配 caller 当前包
  if (context.caller) {
    const callerId =
      typeof context.caller === "string" ? context.caller : context.caller.id;
    const inCaller = context.catalog.find({
      packageId: callerId,
      actionId: parsed.actionId,
    });
    if (inCaller.length > 0) {
      const candidate = inCaller[0];
      const node = context.graph.packages.get(callerId)!;
      return {
        ref: {
          packageId: node.identity.id,
          packageInstanceId: node.identity.instanceId,
          actionId: parsed.actionId,
          generationId: node.identity.generation,
        },
        package: node.identity,
        entry: candidate.entry,
        contract: candidate.contract,
      };
    }
  }

  // 3. 全局唯一匹配检查
  const allMatches = context.catalog.find(parsed.actionId);
  if (allMatches.length === 0) {
    const message = context.caller
      ? `ACTION_NOT_FOUND: Action '${parsed.actionId}' not found in current project or any registered package`
      : `ACTION_NOT_FOUND: Action '${parsed.actionId}' not found in any registered package`;
    const err: any = new Error(message);
    err.code = "ACTION_NOT_FOUND";
    throw err;
  }

  if (allMatches.length > 1) {
    const candidates = allMatches.map((m) => `${m.packageId}/${m.actionId}`).join(", ");
    const err: any = new Error(
      `INVALID_ACTION_REF: Action '${parsed.actionId}' is ambiguous and provided by multiple packages: ${candidates}. Please specify '<package-id>/${parsed.actionId}'. (AMBIGUOUS_ACTION_REF)`
    );
    err.code = "INVALID_ACTION_REF";
    err.details = {
      alias: "AMBIGUOUS_ACTION_REF",
      candidates: allMatches.map((m) => m.packageId),
    };
    throw err;
  }

  const candidate = allMatches[0];
  const node = context.graph.packages.get(candidate.packageId)!;
  return {
    ref: {
      packageId: node.identity.id,
      packageInstanceId: node.identity.instanceId,
      actionId: parsed.actionId,
      generationId: node.identity.generation,
    },
    package: node.identity,
    entry: candidate.entry,
    contract: candidate.contract,
  };
}
