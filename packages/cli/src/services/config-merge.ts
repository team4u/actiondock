import {
  isConfigTemplate,
  isSecretConfigKey,
  resolveConfigDeclaration,
  type ConfigItemDefinition,
} from "@actiondock/core/project";
import {
  loadProjectConfig,
  type ActionDockService,
  type ConfigValueView,
} from "@actiondock/core";
import type { ConfigSource } from "@actiondock/core";

/**
 * 配置合并视图条目：跨作用域合并后的键值展示结构。
 * source 与核心 ConfigSource 契约一致：override/package/global/env/default/null，
 * 不另起显示别名。
 */
export interface MergedConfigEntry {
  key: string;
  value?: unknown;
  source: ConfigSource | null;
  secret: boolean;
  configured: boolean;
  redactedPaths: string[];
  description?: string;
}

/**
 * 解析单个配置键的合并视图。
 *
 * 核心管理 view 已是唯一值与来源事实源，杜绝二次解析 env、本地 default 兜底与重复打码。
 *
 * @param key 配置键名
 * @param packageId 包标识（用于包级作用域寻址）
 * @param declaredItem 工程声明的配置项定义（可选）
 * @param service 已创建的 Service 服务实例
 */
export async function resolveMergedConfigEntry(
  key: string,
  packageId: string,
  declaredItem: ConfigItemDefinition | undefined,
  service: ActionDockService
): Promise<{
  value?: unknown;
  source: ConfigSource | null;
  secret: boolean;
  configured: boolean;
  redactedPaths: string[];
  description?: string;
}> {
  const confView = await service.management?.config.get(packageId, key);

  const source: ConfigSource | null = confView?.source ?? null;
  const isSecret = confView?.secret ?? isSecretConfigKey(key, declaredItem);
  const configured = Boolean(confView?.configured);
  const redactedPaths = confView?.redactedPaths ?? [];
  const value = confView?.value;

  return {
    value,
    source,
    secret: isSecret,
    configured,
    redactedPaths,
    ...(declaredItem?.description !== undefined ? { description: declaredItem.description } : {}),
  };
}

/**
 * 构造工程范围的完整配置合并视图（config list 单一事实源）。
 *
 * 优先信任包 scope view，不用全局 view 覆盖它自己的 env/default 结果；
 * 合并服务范围时不改变优先级、secret 与 paths。
 * 键名包含通配符的模板声明不作为具体配置条目加入列表。
 *
 * @param root 工程根目录
 * @param service 已创建的 Service 服务实例
 */
export async function buildMergedConfigEntries(
  root: string,
  service: ActionDockService
): Promise<MergedConfigEntry[]> {
  const projConfig = loadProjectConfig(root);
  const declared = projConfig.config || {};

  const projectConfigList: ConfigValueView[] = (await service.management?.config.list(projConfig.id)) ?? [];
  const globalConfigList: ConfigValueView[] = (await service.management?.config.list("global")) ?? [];

  const projectConfigMap = new Map(projectConfigList.map((c) => [c.key, c]));
  const globalConfigMap = new Map(globalConfigList.map((c) => [c.key, c]));

  // 收集所有具体键（过滤通配模板）
  const allKeys = new Set([
    ...projectConfigList.map((c) => c.key),
    ...globalConfigList.map((c) => c.key),
    ...Object.keys(declared).filter((k) => !isConfigTemplate(k)),
  ]);

  const entries: MergedConfigEntry[] = [];
  for (const key of allKeys) {
    const projItem = projectConfigMap.get(key);
    const globItem = globalConfigMap.get(key);

    const resolved = resolveConfigDeclaration(declared, key);
    const declaredItem = resolved?.item;

    let view: ConfigValueView | undefined;
    let source: ConfigSource | null;

    // 优先信任包 scope view，不用全局 view 覆盖它自己的 env/default 结果
    if (projItem) {
      view = projItem;
      source = projItem.source;
    } else if (globItem) {
      view = globItem;
      source = globItem.source;
    } else {
      source = null;
    }

    const secret = view?.secret ?? isSecretConfigKey(key, declaredItem);
    const configured = view?.configured ?? false;
    const redactedPaths = view?.redactedPaths ?? [];
    const value = view?.value;

    entries.push({
      key,
      value,
      source,
      secret,
      configured,
      redactedPaths,
      ...(declaredItem?.description !== undefined ? { description: declaredItem.description } : {}),
    });
  }

  return entries;
}
