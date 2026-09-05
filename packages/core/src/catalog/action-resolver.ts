import type { ActionRef, ResolvedActionRef } from "@actiondock/sdk";
import { ActionIndex } from "./action-index";
import type { CatalogSnapshot, IndexedAction } from "./types";

export interface ResolveOptions {
  currentPackageId?: string;
}

export class ActionResolver {
  private snapshot: CatalogSnapshot;
  private index: ActionIndex;

  constructor(snapshot: CatalogSnapshot, index?: ActionIndex) {
    this.snapshot = snapshot;
    this.index = index || new ActionIndex(snapshot);
  }

  /**
   * 解析字符串或 ActionRef 为规范化的 ActionRef。
   * 支持 greet、my-tools/greet、@team/github/issues.list。
   */
  public static parseRef(refStringOrObj: string | ActionRef): ActionRef {
    if (typeof refStringOrObj === "object") {
      return refStringOrObj;
    }

    const str = refStringOrObj.trim();
    if (str.includes("/")) {
      const lastSlashIndex = str.lastIndexOf("/");
      const packageId = str.slice(0, lastSlashIndex);
      const actionId = str.slice(lastSlashIndex + 1);

      if (actionId.includes(":") || actionId.includes("/") || actionId.includes("..")) {
        throw new Error(`Invalid action identifier: '${actionId}'`);
      }
      return { packageId, actionId };
    }

    // 处理旧语法 package:action 的兼容提醒
    if (str.includes(":")) {
      const parts = str.split(":");
      throw new Error(
        `Legacy syntax '${str}' is deprecated. Please use '${parts.join("/")}' instead.`
      );
    }

    return { actionId: str };
  }

  public resolve(
    refStringOrObj: string | ActionRef,
    options: ResolveOptions = {}
  ): { resolved: ResolvedActionRef; action: IndexedAction } {
    const ref = ActionResolver.parseRef(refStringOrObj);

    // 1. 若指定了 packageId，直接精确匹配
    if (ref.packageId) {
      const matches = this.index.find(ref.actionId, ref.packageId);
      if (matches.length === 0) {
        throw new Error(
          `ACTION_NOT_FOUND: Action '${ref.actionId}' not found in package '${ref.packageId}'`
        );
      }
      const matched = matches[0];
      const pkg = this.snapshot.packages.get(matched.packageId);
      return {
        resolved: {
          packageId: matched.packageId,
          packageInstanceId: pkg?.packageInstanceId || matched.packageId,
          actionId: matched.actionId,
          generationId: this.snapshot.generationId,
        },
        action: matched,
      };
    }

    // 2. 未指定 packageId：优先查找当前调用者包
    if (options.currentPackageId) {
      const inCurrent = this.index.find(ref.actionId, options.currentPackageId);
      if (inCurrent.length > 0) {
        const matched = inCurrent[0];
        const pkg = this.snapshot.packages.get(matched.packageId);
        return {
          resolved: {
            packageId: matched.packageId,
            packageInstanceId: pkg?.packageInstanceId || matched.packageId,
            actionId: matched.actionId,
            generationId: this.snapshot.generationId,
          },
          action: matched,
        };
      }
    }

    // 3. 全局唯一匹配检查
    const allMatches = this.index.find(ref.actionId);
    if (allMatches.length === 0) {
      throw new Error(`ACTION_NOT_FOUND: Action '${ref.actionId}' not found in any linked package`);
    }

    if (allMatches.length > 1) {
      const candidates = allMatches.map((m) => `${m.packageId}/${m.actionId}`).join(", ");
      throw new Error(
        `AMBIGUOUS_ACTION_REF: Action '${ref.actionId}' is provided by multiple packages: ${candidates}. Please specify the package name.`
      );
    }

    const matched = allMatches[0];
    const pkg = this.snapshot.packages.get(matched.packageId);
    return {
      resolved: {
        packageId: matched.packageId,
        packageInstanceId: pkg?.packageInstanceId || matched.packageId,
        actionId: matched.actionId,
        generationId: this.snapshot.generationId,
      },
      action: matched,
    };
  }
}
