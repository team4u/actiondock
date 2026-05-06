import { inspect } from "node:util";

import type {
  CapabilityView,
  EventDispatchRecord,
  EventIngestionView,
  EventRecord,
  EventSourceDefinition,
  EventTrigger,
  EventTriggerTestResult,
  ExecutionResponse,
  NormalizedEvent,
  PluginConfigView,
  PluginReferenceView,
  PluginView,
  ProcessorTestResult,
  SchemaFieldDescriptor,
  ScriptScheduleView,
  ScriptDefinition,
  SharedStateDetail,
  SharedStateSummary
} from "./types.js";

export function renderScriptList(items: ScriptDefinition[]): string {
  if (items.length === 0) {
    return "没有可用脚本。";
  }

  return items
    .map((item) => {
      const name = item.name ? ` ${item.name}` : "";
      const type = item.type ? ` [${item.type}]` : "";
      const published = item.publishedSnapshot ? " published" : " draft-only";
      return `${item.id}${name}${type}${published}`;
    })
    .join("\n");
}

export function renderCapabilityList(items: CapabilityView[]): string {
  if (items.length === 0) {
    return "没有可用 capability。";
  }

  return items
    .map((item) => {
      const name = item.name ? ` ${item.name}` : "";
      const runtime = item.runtime ? ` [${item.runtime}]` : "";
      const published = item.publishedBinding ? " published" : " draft-only";
      return `${item.id}${name}${runtime}${published}`;
    })
    .join("\n");
}

export function renderCapabilityDetail(item: CapabilityView): string {
  const lines = [
    `Capability: ${item.id}${item.name ? ` (${item.name})` : ""}`,
    `Kind: ${item.kind ?? "-"}`,
    `Runtime: ${item.runtime ?? "-"}`,
    `Source: ${item.source ?? "-"}`,
    `Status: ${item.status ?? "-"}`,
    `Version: ${item.version ?? "-"}`,
    `Published: ${item.publishedBinding ? "yes" : "no"}`
  ];
  if (item.scope) {
    lines.push(`Scope: ${item.scope}`);
  }
  if (item.description) {
    lines.push(`Description: ${item.description}`);
  }
  if (item.owner) {
    lines.push(`Owner: ${item.owner}`);
  }
  if (item.tags && item.tags.length > 0) {
    lines.push(`Tags: ${item.tags.join(", ")}`);
  }
  return lines.join("\n");
}

export function renderSchemaDetail(params: {
  script: ScriptDefinition;
  target: "published" | "draft";
  fields: SchemaFieldDescriptor[];
}): string {
  const { script, target, fields } = params;
  const lines = [
    `Script: ${script.id}${script.name ? ` (${script.name})` : ""}`,
    `Target: ${target}`,
  ];

  if (fields.length === 0) {
    lines.push("Input schema: none");
    return lines.join("\n");
  }

  lines.push("Flag fields:");
  const flagFields = fields.filter((field) => field.supportsFlag);
  if (flagFields.length === 0) {
    lines.push("  (none)");
  } else {
    for (const field of flagFields) {
      lines.push(`  --${field.name} <${field.kind}>${field.required ? " required" : ""}${formatSupplement(field)}`);
    }
  }

  lines.push("JSON-only fields:");
  const jsonOnlyFields = fields.filter((field) => !field.supportsFlag);
  if (jsonOnlyFields.length === 0) {
    lines.push("  (none)");
  } else {
    for (const field of jsonOnlyFields) {
      lines.push(`  ${field.name} <${field.kind}>${field.required ? " required" : ""}${formatSupplement(field)}`);
    }
  }

  return lines.join("\n");
}

export function renderScriptDetail(script: ScriptDefinition, target: "published" | "draft"): string {
  const lines = [
    `Script: ${script.id}${script.name ? ` (${script.name})` : ""}`,
    `Target: ${target}`,
    `Type: ${script.type ?? "-"}`,
    `Status: ${script.status ?? "-"}`,
    `Version: ${script.version ?? "-"}`,
    `Published: ${script.publishedSnapshot ? "yes" : "no"}`
  ];
  if (script.description) {
    lines.push(`Description: ${script.description}`);
  }
  if (script.owner) {
    lines.push(`Owner: ${script.owner}`);
  }
  if (script.tags && script.tags.length > 0) {
    lines.push(`Tags: ${script.tags.join(", ")}`);
  }
  if (script.pythonRequirements) {
    lines.push("Python requirements: configured");
  }
  return lines.join("\n");
}

export function renderExecution(response: ExecutionResponse): string {
  const lines: string[] = [];
  if (response.id) {
    lines.push(`Execution: ${response.id}`);
  }
  if (response.scriptId) {
    lines.push(`Script: ${response.scriptId}`);
  }
  if (response.status) {
    lines.push(`Status: ${response.status}`);
  }
  if (response.submitMode) {
    lines.push(`Mode: ${response.submitMode}`);
  }
  if (response.triggerSource) {
    lines.push(`Trigger: ${response.triggerSource}`);
  }
  if (response.eventSourceId) {
    lines.push(`EventSource: ${response.eventSourceId}`);
  }
  if (response.eventTriggerId) {
    lines.push(`EventTrigger: ${response.eventTriggerId}`);
  }
  if (response.eventRecordId) {
    lines.push(`EventRecord: ${response.eventRecordId}`);
  }
  if (response.eventDispatchId) {
    lines.push(`EventDispatch: ${response.eventDispatchId}`);
  }
  if (response.errorMessage) {
    lines.push(`Error: ${response.errorMessage}`);
  }
  if (response.input !== undefined) {
    lines.push("Input:");
    lines.push(indent(formatValue(response.input)));
  }
  if (response.output !== undefined) {
    lines.push("Output:");
    lines.push(indent(formatValue(response.output)));
  }
  if (response.debug) {
    lines.push("Debug:");
    lines.push(indent(formatValue(response.debug)));
  }
  if (response.logs && response.logs.length > 0) {
    lines.push(`Logs: ${response.logs.length}`);
  }
  return lines.join("\n");
}

export function renderExecutionList(items: ExecutionResponse[]): string {
  if (items.length === 0) {
    return "没有执行记录。";
  }

  return items
    .map((item) => {
      const script = item.scriptId ? ` ${item.scriptId}` : "";
      const status = item.status ? ` ${item.status}` : "";
      const mode = item.submitMode ? ` ${item.submitMode}` : "";
      return `${item.id ?? "-"}${script}${status}${mode}`;
    })
    .join("\n");
}

export function renderScheduleList(items: ScriptScheduleView[]): string {
  if (items.length === 0) {
    return "没有定时任务。";
  }

  return items
    .map((item) => {
      const script = item.scriptId ? ` ${item.scriptId}` : "";
      const name = item.name ? ` ${item.name}` : "";
      const enabled = typeof item.enabled === "boolean" ? ` ${item.enabled ? "enabled" : "disabled"}` : "";
      const cron = item.cronExpression ? ` ${item.cronExpression}` : "";
      return `${item.id}${script}${name}${enabled}${cron}`;
    })
    .join("\n");
}

export function renderScheduleDetail(item: ScriptScheduleView): string {
  const lines = [
    `Schedule: ${item.id}`,
    `Script: ${item.scriptId}`,
    `Name: ${item.name ?? "-"}`,
    `Enabled: ${item.enabled ? "yes" : "no"}`,
    `Cron: ${item.cronExpression ?? "-"}`
  ];
  if (item.nextRunAt) {
    lines.push(`NextRunAt: ${item.nextRunAt}`);
  }
  if (item.lastTriggeredAt) {
    lines.push(`LastTriggeredAt: ${item.lastTriggeredAt}`);
  }
  if (item.lastExecutionId) {
    lines.push(`LastExecution: ${item.lastExecutionId}${item.lastExecutionStatus ? ` ${item.lastExecutionStatus}` : ""}`);
  }
  if (item.input !== undefined) {
    lines.push("Input:");
    lines.push(indent(formatValue(item.input)));
  }
  return lines.join("\n");
}

export function renderEventSourceList(items: EventSourceDefinition[]): string {
  if (items.length === 0) {
    return "没有事件源。";
  }

  return items
    .map((item) => {
      const key = item.key ? ` ${item.key}` : "";
      const name = item.name ? ` ${item.name}` : "";
      const enabled = typeof item.enabled === "boolean" ? ` ${item.enabled ? "enabled" : "disabled"}` : "";
      const transport = item.transport?.type ? ` ${item.transport.type}` : "";
      return `${item.id}${key}${name}${enabled}${transport}`;
    })
    .join("\n");
}

export function renderEventSourceDetail(item: EventSourceDefinition): string {
  const lines = [
    `EventSource: ${item.id}`,
    `Key: ${item.key ?? "-"}`,
    `Name: ${item.name ?? "-"}`,
    `Enabled: ${item.enabled ? "yes" : "no"}`,
    `Transport: ${item.transport?.type ?? "-"}`
  ];
  if (item.transport?.endpointPath) {
    lines.push(`EndpointPath: ${item.transport.endpointPath}`);
  }
  if (item.description) {
    lines.push(`Description: ${item.description}`);
  }
  if (item.auth?.mode) {
    lines.push(`Auth: ${item.auth.mode}`);
  }
  if (item.lastReceivedAt) {
    lines.push(`LastReceivedAt: ${item.lastReceivedAt}`);
  }
  if (item.normalizationProcessor) {
    lines.push(`Normalization: ${item.normalizationProcessor.mode ?? "-"}`);
  }
  if (item.sampleContext && Object.keys(item.sampleContext).length > 0) {
    lines.push("SampleContext:");
    lines.push(indent(formatValue(item.sampleContext)));
  }
  return lines.join("\n");
}

export function renderEventTriggerList(items: EventTrigger[]): string {
  if (items.length === 0) {
    return "没有事件触发器。";
  }

  return items
    .map((item) => {
      const name = item.name ? ` ${item.name}` : "";
      const source = item.sourceId ? ` source=${item.sourceId}` : "";
      const script = item.targetScriptId ? ` script=${item.targetScriptId}` : "";
      const enabled = typeof item.enabled === "boolean" ? ` ${item.enabled ? "enabled" : "disabled"}` : "";
      return `${item.id}${name}${enabled}${source}${script}`;
    })
    .join("\n");
}

export function renderEventTriggerDetail(item: EventTrigger): string {
  const lines = [
    `EventTrigger: ${item.id}`,
    `Name: ${item.name ?? "-"}`,
    `Enabled: ${item.enabled ? "yes" : "no"}`,
    `Source: ${item.sourceId ?? "-"}`,
    `TargetScript: ${item.targetScriptId ?? "-"}`,
    `SubmitMode: ${item.submitMode ?? "-"}`,
    `ResponseView: ${item.responseView ?? "-"}`
  ];
  if (item.description) {
    lines.push(`Description: ${item.description}`);
  }
  if (item.filterProcessor) {
    lines.push(`FilterProcessor: ${item.filterProcessor.mode ?? "-"}`);
  }
  if (item.idempotencyProcessor) {
    lines.push(`IdempotencyProcessor: ${item.idempotencyProcessor.mode ?? "-"}`);
  }
  if (item.inputProcessor) {
    lines.push(`InputProcessor: ${item.inputProcessor.mode ?? "-"}`);
  }
  if (item.lastEventId) {
    lines.push(`LastEventId: ${item.lastEventId}`);
  }
  if (item.lastExecutionId) {
    lines.push(`LastExecution: ${item.lastExecutionId}${item.lastExecutionStatus ? ` ${item.lastExecutionStatus}` : ""}`);
  }
  return lines.join("\n");
}

export function renderEventRecordList(items: EventRecord[]): string {
  if (items.length === 0) {
    return "没有事件记录。";
  }

  return items
    .map((item) => {
      const source = item.sourceKey ? ` ${item.sourceKey}` : item.sourceId ? ` ${item.sourceId}` : "";
      const status = item.status ? ` ${item.status}` : "";
      const eventType = item.eventType ? ` ${item.eventType}` : "";
      return `${item.id}${source}${status}${eventType}`;
    })
    .join("\n");
}

export function renderEventRecordDetail(item: EventRecord): string {
  const lines = [
    `EventRecord: ${item.id}`,
    `SourceId: ${item.sourceId ?? "-"}`,
    `SourceKey: ${item.sourceKey ?? "-"}`,
    `Status: ${item.status ?? "-"}`,
    `EventType: ${item.eventType ?? "-"}`,
    `EventId: ${item.eventId ?? "-"}`
  ];
  if (item.actor) {
    lines.push(`Actor: ${item.actor}`);
  }
  if (item.subject) {
    lines.push(`Subject: ${item.subject}`);
  }
  if (item.errorMessage) {
    lines.push(`Error: ${item.errorMessage}`);
  }
  if (item.rawHeaders) {
    lines.push("RawHeaders:");
    lines.push(indent(formatValue(item.rawHeaders)));
  }
  if (item.rawQuery) {
    lines.push("RawQuery:");
    lines.push(indent(formatValue(item.rawQuery)));
  }
  if (item.rawBody) {
    lines.push("RawBody:");
    lines.push(indent(formatValue(item.rawBody)));
  }
  if (item.normalizedEvent) {
    lines.push("NormalizedEvent:");
    lines.push(indent(renderNormalizedEvent(item.normalizedEvent)));
  }
  return lines.join("\n");
}

export function renderEventDispatchList(items: EventDispatchRecord[]): string {
  if (items.length === 0) {
    return "没有事件分发记录。";
  }

  return items
    .map((item) => {
      const trigger = item.triggerId ? ` trigger=${item.triggerId}` : "";
      const status = item.status ? ` ${item.status}` : "";
      const execution = item.executionId ? ` execution=${item.executionId}` : "";
      return `${item.id}${status}${trigger}${execution}`;
    })
    .join("\n");
}

export function renderEventDispatchDetail(item: EventDispatchRecord): string {
  const lines = [
    `EventDispatch: ${item.id}`,
    `EventRecord: ${item.eventId ?? "-"}`,
    `SourceId: ${item.sourceId ?? "-"}`,
    `TriggerId: ${item.triggerId ?? "-"}`,
    `TargetScript: ${item.targetScriptId ?? "-"}`,
    `Status: ${item.status ?? "-"}`
  ];
  if (item.filterMatched !== undefined) {
    lines.push(`FilterMatched: ${item.filterMatched ? "yes" : "no"}`);
  }
  if (item.idempotencyKey) {
    lines.push(`IdempotencyKey: ${item.idempotencyKey}`);
  }
  if (item.executionId) {
    lines.push(`Execution: ${item.executionId}${item.executionStatus ? ` ${item.executionStatus}` : ""}`);
  }
  if (item.errorMessage) {
    lines.push(`Error: ${item.errorMessage}`);
  }
  if (item.mappedInput && Object.keys(item.mappedInput).length > 0) {
    lines.push("MappedInput:");
    lines.push(indent(formatValue(item.mappedInput)));
  }
  return lines.join("\n");
}

export function renderProcessorTestResult(result: ProcessorTestResult): string {
  const lines = [
    `Success: ${result.success ? "yes" : "no"}`,
    `SchemaValid: ${result.schemaValid === false ? "no" : "yes"}`
  ];
  if (typeof result.durationMs === "number") {
    lines.push(`DurationMs: ${result.durationMs}`);
  }
  if (result.errorMessage) {
    lines.push(`Error: ${result.errorMessage}`);
  }
  if (result.output !== undefined) {
    lines.push("Output:");
    lines.push(indent(formatValue(result.output)));
  }
  if (result.fieldErrors && result.fieldErrors.length > 0) {
    lines.push("FieldErrors:");
    lines.push(indent(formatValue(result.fieldErrors)));
  }
  if (result.logs && result.logs.length > 0) {
    lines.push(`Logs: ${result.logs.length}`);
  }
  return lines.join("\n");
}

export function renderEventTriggerTestResult(result: EventTriggerTestResult): string {
  const lines: string[] = [];
  if (result.event) {
    lines.push("Event:");
    lines.push(indent(renderNormalizedEvent(result.event)));
  }
  lines.push(`FilterMatched: ${result.filterMatched ? "yes" : "no"}`);
  if (result.idempotencyKey) {
    lines.push(`IdempotencyKey: ${result.idempotencyKey}`);
  }
  lines.push(`SchemaValid: ${result.schemaValid === false ? "no" : "yes"}`);
  if (result.filterResult) {
    lines.push("FilterResult:");
    lines.push(indent(renderProcessorTestResult(result.filterResult)));
  }
  if (result.idempotencyResult) {
    lines.push("IdempotencyResult:");
    lines.push(indent(renderProcessorTestResult(result.idempotencyResult)));
  }
  if (result.inputResult) {
    lines.push("InputResult:");
    lines.push(indent(renderProcessorTestResult(result.inputResult)));
  }
  if (result.mappedInput !== undefined) {
    lines.push("MappedInput:");
    lines.push(indent(formatValue(result.mappedInput)));
  }
  if (result.fieldErrors && result.fieldErrors.length > 0) {
    lines.push("FieldErrors:");
    lines.push(indent(formatValue(result.fieldErrors)));
  }
  if (result.execution) {
    lines.push("Execution:");
    lines.push(indent(renderExecution(result.execution)));
  }
  return lines.join("\n");
}

export function renderEventIngestionResult(result: EventIngestionView): string {
  const lines: string[] = [];
  if (result.event) {
    lines.push("Event:");
    lines.push(indent(renderEventRecordDetail(result.event)));
  }
  lines.push(`Dispatches: ${result.dispatches?.length ?? 0}`);
  if (result.dispatches && result.dispatches.length > 0) {
    lines.push(indent(renderEventDispatchList(result.dispatches)));
  }
  return lines.join("\n");
}

export function renderPluginList(items: Array<PluginView | PluginReferenceView>): string {
  if (items.length === 0) {
    return "没有插件。";
  }

  return items
    .map((item) => {
      const name = item.name ? ` ${item.name}` : "";
      const version = item.version ? `@${item.version}` : "";
      const actions = Array.isArray(item.actions) ? ` actions=${item.actions.length}` : "";
      const source = "sourceType" in item && item.sourceType ? ` ${item.sourceType}` : "";
      return `${item.pluginId}${version}${name}${source}${actions}`;
    })
    .join("\n");
}

export function renderPluginDetail(plugin: PluginView | PluginReferenceView): string {
  const lines = [
    `Plugin: ${plugin.pluginId}${plugin.name ? ` (${plugin.name})` : ""}`,
  ];
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
      lines.push(`  ${action.action}${action.title ? ` (${action.title})` : ""}`);
    }
  }
  return lines.join("\n");
}

export function renderPluginConfig(config: PluginConfigView): string {
  return [
    `Plugin: ${config.pluginId}`,
    "Config:",
    indent(formatValue(config.config ?? {}))
  ].join("\n");
}

export function renderSharedStateNamespaces(items: string[]): string {
  if (items.length === 0) {
    return "没有共享状态命名空间。";
  }
  return items.join("\n");
}

export function renderSharedStateList(items: SharedStateSummary[]): string {
  if (items.length === 0) {
    return "没有共享状态条目。";
  }

  return items
    .map((item) => {
      const secret = item.secret ? " secret" : "";
      const version = item.version != null ? ` v${item.version}` : "";
      return `${item.namespace}/${item.key}${version}${secret}`;
    })
    .join("\n");
}

export function renderSharedStateDetail(item: SharedStateDetail): string {
  const lines = [
    `Entry: ${item.namespace}/${item.key}`,
    `Secret: ${item.secret ? "yes" : "no"}`,
    `Version: ${item.version ?? "-"}`
  ];
  if (item.expiresAt) {
    lines.push(`ExpiresAt: ${item.expiresAt}`);
  }
  if (item.value !== undefined) {
    lines.push("Value:");
    lines.push(indent(formatValue(item.value)));
  }
  return lines.join("\n");
}

function formatSupplement(field: SchemaFieldDescriptor): string {
  const fragments: string[] = [];
  if (field.enumValues.length > 0) {
    fragments.push(`enum=${field.enumValues.join("|")}`);
  }
  if (field.defaultValue !== undefined) {
    fragments.push(`default=${JSON.stringify(field.defaultValue)}`);
  }
  if (field.description) {
    fragments.push(field.description);
  }
  return fragments.length > 0 ? ` (${fragments.join("; ")})` : "";
}

function renderNormalizedEvent(event: NormalizedEvent): string {
  const lines = [
    `Id: ${event.id ?? "-"}`,
    `SourceId: ${event.sourceId ?? "-"}`,
    `SourceKey: ${event.sourceKey ?? "-"}`,
    `EventType: ${event.eventType ?? "-"}`,
    `EventId: ${event.eventId ?? "-"}`,
    `Actor: ${event.actor ?? "-"}`,
    `Subject: ${event.subject ?? "-"}`
  ];
  if (event.timestamp) {
    lines.push(`Timestamp: ${event.timestamp}`);
  }
  if (event.receivedAt) {
    lines.push(`ReceivedAt: ${event.receivedAt}`);
  }
  if (event.headers) {
    lines.push("Headers:");
    lines.push(indent(formatValue(event.headers)));
  }
  if (event.query) {
    lines.push("Query:");
    lines.push(indent(formatValue(event.query)));
  }
  if (event.body) {
    lines.push("Body:");
    lines.push(indent(formatValue(event.body)));
  }
  return lines.join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return inspect(value, { depth: 6, colors: false });
  }
}
