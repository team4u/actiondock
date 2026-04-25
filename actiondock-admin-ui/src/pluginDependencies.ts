import type { PluginDependency, PluginView, RepositoryToolDescriptor, ScriptDefinition } from "./types";

const PLUGIN_INVOKE_PATTERN = /plugins\s*\.\s*invoke\s*\(\s*(["'`])([^"'`]+)\1\s*,\s*(["'`])([^"'`]+)\3/g;

export function extractPluginDependenciesFromSource(source: string, plugins: PluginView[]): PluginDependency[] {
  if (!source.trim()) {
    return [];
  }

  const versions = new Map(plugins.map((plugin) => [plugin.pluginId, plugin.version]));
  const actionsByPlugin = new Map<string, Set<string>>();
  let match: RegExpExecArray | null;

  while ((match = PLUGIN_INVOKE_PATTERN.exec(source)) !== null) {
    const pluginId = match[2].trim();
    const action = match[4].trim();
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
  descriptor: RepositoryToolDescriptor | undefined,
  plugins: PluginView[]
): PluginDependency[] {
  if (descriptor?.pluginDependencies.length) {
    return descriptor.pluginDependencies;
  }

  if (script.pluginDependencies?.length) {
    return script.pluginDependencies;
  }

  if (script.type !== "GROOVY") {
    return [];
  }

  return extractPluginDependenciesFromSource(script.source, plugins);
}
