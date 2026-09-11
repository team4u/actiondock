import type { ActionDockTarget } from "@actiondock/core";
import {
  filterWithFallbackInfo,
  listLinkedPackages,
  loadProjectConfig,
} from "@actiondock/core";
import { existsSync } from "node:fs";
import { renderResult, renderStateList } from "../renderer";
import type { CliContext } from "../types";

/**
 * 状态键列表渲染参数视图。
 */
export interface StateListRenderArgs {
  target: ActionDockTarget;
  actionId: string;
  prefix: string;
  options: any;
  effectiveIntent?: string;
  shouldFallback: boolean;
  context?: CliContext;
}

/**
 * 渲染单个项目作用域的状态键列表（含 --detail JSON 明细分支）。
 */
export async function renderProjectScopedStateList(
  args: StateListRenderArgs & { targetRoot: string }
): Promise<void> {
  const { target, targetRoot, actionId, prefix, options, effectiveIntent, shouldFallback, context } = args;
  const projConfig = loadProjectConfig(targetRoot);
  const allKeys = await target.listStateKeys(
    projConfig.id,
    actionId,
    {
      namespace: options.namespace !== undefined ? options.namespace : null,
      prefix,
    }
  );

  if (options.detail && options.json) {
    const entries: Array<{ key: string; namespace?: string; fullKey?: string; value: unknown }> = [];
    for (const k of allKeys) {
      const entry = await target.getState(projConfig.id, actionId, k, {
        namespace: options.namespace,
        detail: true,
      });
      if (entry) {
        entries.push(entry as any);
      }
    }
    const filterRes = filterWithFallbackInfo(
      entries,
      effectiveIntent,
      [(e) => e.fullKey, (e) => e.key, (e) => e.namespace],
      shouldFallback
    );
    renderResult(filterRes.items, {
      json: true,
      envelope: options.envelope,
      context,
    });
    return;
  }

  const filterRes = filterWithFallbackInfo(allKeys, effectiveIntent, [(k) => k], shouldFallback);

  renderResult(filterRes.items, {
    json: options.json,
    envelope: options.envelope,
    humanFormatter: () =>
      renderStateList(
        filterRes.items,
        `${projConfig.name} (${projConfig.id})`,
        filterRes.isFallback,
        effectiveIntent
      ),
    context,
  });
}

/**
 * 渲染全部链接包聚合的状态键列表（跳过磁盘失效与清单损坏的链接项）。
 */
export async function renderLinkedPackagesStateList(args: StateListRenderArgs): Promise<void> {
  const { target, actionId, prefix, options, effectiveIntent, shouldFallback, context } = args;

  // 扫描所有链接的包状态
  const linked = listLinkedPackages();
  if (linked.length === 0) {
    renderResult(
      [],
      {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () => "No ActionDock project in current directory, and no packages linked.",
        context,
      }
    );
    return;
  }

  const aggregatedKeys: string[] = [];
  for (const pkg of linked) {
    if (!existsSync(pkg.path)) continue;
    try {
      const config = loadProjectConfig(pkg.path);
      const keys = await target.listStateKeys(
        config.id,
        actionId,
        {
          namespace: options.namespace !== undefined ? options.namespace : null,
          prefix,
        }
      );
      for (const k of keys) {
        aggregatedKeys.push(`${config.id}/${k}`);
      }
    } catch {
      // 单个链接包清单损坏或状态读取失败时跳过，继续聚合其余包
    }
  }

  const filterRes = filterWithFallbackInfo(
    aggregatedKeys,
    effectiveIntent,
    [(k) => k],
    shouldFallback
  );

  renderResult(filterRes.items, {
    json: options.json,
    envelope: options.envelope,
    humanFormatter: () =>
      renderStateList(
        filterRes.items,
        "Linked Packages State Store",
        filterRes.isFallback,
        effectiveIntent
      ),
    context,
  });
}
