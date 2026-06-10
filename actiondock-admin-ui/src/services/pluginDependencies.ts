import type { PluginDependency, PluginSummaryView, RepositoryScriptDescriptor, ScriptDefinition } from "../shared/types";

const PLUGIN_INVOKE_PATTERN = /plugins\s*\.\s*invoke\s*\(\s*(["'`])([^"'`]+)\1\s*,\s*(["'`])([^"'`]+)\3/g;

export function extractPluginDependenciesFromSource(source: string, plugins: PluginSummaryView[]): PluginDependency[] {
  if (!source.trim()) {
    return [];
  }

  const installedPlugins = plugins.filter((plugin) => plugin.sourceType !== "SYSTEM");
  const versions = new Map(installedPlugins.map((plugin) => [plugin.pluginId, plugin.version]));
  const systemPluginIds = new Set(plugins.filter((plugin) => plugin.sourceType === "SYSTEM").map((plugin) => plugin.pluginId));
  const actionsByPlugin = new Map<string, Set<string>>();
  let match: RegExpExecArray | null;

  while ((match = PLUGIN_INVOKE_PATTERN.exec(source)) !== null) {
    const pluginId = match[2].trim();
    const action = match[4].trim();
    if (pluginId === "actiondock-ai" || systemPluginIds.has(pluginId)) {
      continue;
    }
    if (!pluginId || !action) {
      continue;
    }
    const actions = actionsByPlugin.get(pluginId) ?? new Set<string>();
    actions.add(action);
    actionsByPlugin.set(pluginId, actions);
  }

  return [...actionsByPlugin.entries()].map(([pluginId, actions]) => {
    const version = versions.get(pluginId);
    return {
      pluginId,
      versionRange: version ? `>= ${version}` : undefined,
      requiredActions: [...actions]
    };
  });
}

export function resolveEffectivePluginDependencies(
  script: ScriptDefinition,
  descriptor: RepositoryScriptDescriptor | undefined,
  plugins: PluginSummaryView[]
): PluginDependency[] {
  if (descriptor?.pluginDependencies.length) {
    return descriptor.pluginDependencies;
  }

  if (script.pluginDependencies?.length) {
    return script.pluginDependencies;
  }

  return extractPluginDependenciesFromSource(script.source, plugins);
}
