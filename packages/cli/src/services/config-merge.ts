import {
  isSecretConfigKey,
  loadProjectConfig,
  maskSecretValue,
  resolveEnvValue,
  type ActionDockTarget,
  type ConfigItemDefinition,
  type ConfigValueView,
} from "@actiondock/core";

/**
 * 配置合并视图条目：跨作用域合并后的键值展示结构。
 * source 标签语义：project（包级持久化）> global（全局持久化）> env（环境变量）> default（声明默认值）。
 */
export interface MergedConfigEntry {
  key: string;
  value: unknown;
  source: "project" | "global" | "env" | "default";
  secret: boolean;
  description?: string;
}

/**
 * 解析单个配置键的合并视图（项目包级 > 全局持久化 > 环境变量 > 声明默认值）。
 *
 * 与 config list 的整表合并保持同一优先级链：包级持久化命中即短路，
 * 全局持久化次之，环境变量再次，最后回退声明默认值。
 *
 * @param key 配置键名
 * @param packageId 包标识（用于包级作用域寻址与环境变量解析）
 * @param declaredItem 工程声明的配置项定义
 * @param target 已创建的 Target 门面实例
 * @param reveal 是否揭示敏感值明文（为假且敏感键时打码）
 */
export async function resolveMergedConfigEntry(
  key: string,
  packageId: string,
  declaredItem: ConfigItemDefinition | undefined,
  target: ActionDockTarget,
  reveal: boolean
): Promise<{ value: unknown; source: MergedConfigEntry["source"]; secret: boolean }> {
  const confView = await target.getConfig(packageId, key);
  const envResolved = resolveEnvValue(key, declaredItem, packageId);

  let rawValue: unknown;
  let source: MergedConfigEntry["source"];
  if (confView && confView.configured) {
    rawValue = confView.value;
    source = confView.source === "package" ? "project" : (confView.source as MergedConfigEntry["source"]);
  } else if (envResolved !== undefined) {
    rawValue = envResolved.value;
    source = "env";
  } else {
    rawValue = declaredItem?.default;
    source = "default";
  }

  const isSecret = confView?.secret ?? isSecretConfigKey(key, declaredItem);
  const displayValue = !reveal && isSecret && rawValue !== undefined ? maskSecretValue(rawValue) : rawValue;
  return { value: displayValue, source, secret: isSecret };
}

/**
 * 构造工程范围的完整配置合并视图（config list 单一事实源）。
 *
 * 键全集 = 工程声明键 ∪ 包级持久化键 ∪ 全局持久化键，
 * 每个键按 resolveMergedConfigEntry 相同的优先级链取值，
 * 消除 config get 与 config list 两命令间的合并实现差异。
 *
 * @param root 工程根目录
 * @param target 已创建的 Target 门面实例
 * @param reveal 是否揭示敏感值明文
 */
export async function buildMergedConfigEntries(
  root: string,
  target: ActionDockTarget,
  reveal: boolean
): Promise<MergedConfigEntry[]> {
  const projConfig = loadProjectConfig(root);
  const declared = projConfig.config || {};

  const projectConfigList: ConfigValueView[] = await target.listConfig(projConfig.id);
  const globalConfigList: ConfigValueView[] = await target.listConfig("global");

  const projectConfigMap = new Map(projectConfigList.map((c) => [c.key, c]));
  const globalConfigMap = new Map(globalConfigList.map((c) => [c.key, c]));

  const allKeys = new Set([
    ...Object.keys(declared),
    ...projectConfigList.map((c) => c.key),
    ...globalConfigList.map((c) => c.key),
  ]);

  const entries: MergedConfigEntry[] = [];
  for (const key of allKeys) {
    const declaredItem = declared[key];
    const envResolved = resolveEnvValue(key, declaredItem, projConfig.id);
    const projItem = projectConfigMap.get(key);
    const globItem = globalConfigMap.get(key);

    let rawValue: unknown;
    let source: MergedConfigEntry["source"];
    if (projItem && projItem.configured && projItem.source === "package") {
      rawValue = projItem.value;
      source = "project";
    } else if (globItem && globItem.configured) {
      rawValue = globItem.value;
      source = "global";
    } else if (envResolved !== undefined) {
      rawValue = envResolved.value;
      source = "env";
    } else {
      rawValue = declaredItem?.default;
      source = "default";
    }

    const isSecret = isSecretConfigKey(key, declaredItem);
    const displayValue = !reveal && isSecret && rawValue !== undefined ? maskSecretValue(rawValue) : rawValue;
    entries.push({
      key,
      value: displayValue,
      source,
      secret: isSecret,
      ...(declaredItem?.description !== undefined ? { description: declaredItem.description } : {}),
    });
  }
  return entries;
}
