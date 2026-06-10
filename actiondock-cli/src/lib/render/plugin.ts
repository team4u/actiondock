import { extractSchemaFields, splitSchemaFields } from "../schema.js";
import type {
  PluginActionDefinition,
  PluginConfigView,
  PluginReferenceView,
  PluginSummaryView,
  PluginView
} from "../types.js";
import { formatSupplement, formatValue, indent } from "./shared.js";

export function renderPluginList(items: Array<PluginSummaryView | PluginReferenceView>): string {
  if (items.length === 0) {
    return "没有插件。";
  }

  return items
    .map((item) => {
      const name = item.name ? ` ${item.name}` : "";
      const version = item.version ? `@${item.version}` : "";
      const actionCount = "actionCount" in item
        ? item.actionCount
        : Array.isArray(item.actions)
          ? item.actions.length
          : undefined;
      const actions = typeof actionCount === "number" ? ` actions=${actionCount}` : "";
      const source = item.sourceType ? ` ${item.sourceType}` : "";
      return `${item.pluginId}${version}${name}${source}${actions}`;
    })
    .join("\n");
}

export function renderPluginDetail(plugin: PluginView | PluginReferenceView): string {
  const lines = [
    `Plugin: ${plugin.pluginId}${plugin.name ? ` (${plugin.name})` : ""}`,
  ];
  if (plugin.description) {
    lines.push(`Description: ${plugin.description}`);
  }
  if (plugin.version) {
    lines.push(`Version: ${plugin.version}`);
  }
  if ("sourceType" in plugin && plugin.sourceType) {
    lines.push(`Source: ${plugin.sourceType}`);
  }
  if ("state" in plugin && plugin.state) {
    lines.push(`State: ${plugin.state}`);
  }
  if ("started" in plugin && typeof plugin.started === "boolean") {
    lines.push(`Started: ${plugin.started ? "yes" : "no"}`);
  }
  if (plugin.actions.length === 0) {
    lines.push("Actions: none");
  } else {
    lines.push("Actions:");
    for (const action of plugin.actions) {
      lines.push(`  ${action.action}${action.title ? ` (${action.title})` : ""}${action.description ? ` - ${action.description}` : ""}`);
    }
  }
  return lines.join("\n");
}

export function renderPluginActionDetail(action: PluginActionDefinition, exampleCliCommand?: string): string {
  const lines: string[] = [
    `Action: ${action.action}${action.title ? ` (${action.title})` : ""}`
  ];
  if (action.description) {
    lines.push(`Description: ${action.description}`);
  }

  if (action.inputSchema) {
    const fields = extractSchemaFields(action.inputSchema);
    if (fields.length > 0) {
      const { flagFields, jsonOnlyFields } = splitSchemaFields(fields);
      if (flagFields.length > 0) {
        lines.push("Input:");
        for (const f of flagFields) {
          const req = f.required ? " required" : "";
          const supp = formatSupplement(f);
          lines.push(`  --${f.name} <${f.kind}>${req}${supp}`);
        }
      }
      if (jsonOnlyFields.length > 0) {
        lines.push("JSON-only fields:");
        for (const f of jsonOnlyFields) {
          const supp = formatSupplement(f);
          lines.push(`  ${f.name} <${f.kind}>${supp}`);
        }
      }
    } else {
      lines.push("Input: (none)");
    }
  }

  if (action.outputSchema && Object.keys(action.outputSchema).length > 0) {
    lines.push("Output:");
    lines.push(indent(formatValue(action.outputSchema)));
  }

  if (action.exampleArgs && Object.keys(action.exampleArgs).length > 0) {
    lines.push("Example:");
    lines.push(indent(formatValue(action.exampleArgs)));
  }

  if (exampleCliCommand) {
    lines.push("Example CLI:");
    lines.push(`  ${exampleCliCommand}`);
  }

  return lines.join("\n");
}

export function renderPluginConfig(config: PluginConfigView): string {
  return [
    `Plugin: ${config.pluginId}`,
    `ConfigName: ${config.configName ?? "default"}`,
    "Config:",
    indent(formatValue(config.config ?? {}))
  ].join("\n");
}

export function renderPluginConfigList(configs: PluginConfigView[]): string {
  if (configs.length === 0) {
    return "没有插件配置。";
  }
  return configs.map((config) => `${config.configName ?? "default"}`).join("\n");
}
