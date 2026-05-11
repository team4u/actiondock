import { readAndClearScriptCreatePreset, writeScriptCreatePreset, type ScriptCreatePreset } from "../../services/scriptCreatePreset";

export type ProcessorPurpose = "normalization" | "filter" | "idempotency" | "input";

export type ProcessorScriptPreset = ScriptCreatePreset;

const NORMALIZATION_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    event: {
      type: "object",
      properties: {
        headers: { type: "object", description: "请求头" },
        query: { type: "object", description: "查询参数" },
        body: { type: "object", description: "请求体" },
        sourceId: { type: "string", description: "事件源 ID" },
        sourceKey: { type: "string", description: "事件源 Key" }
      }
    },
    source: {
      type: "object",
      properties: {
        id: { type: "string" },
        key: { type: "string" },
        name: { type: "string" }
      }
    },
    trigger: { type: "object" },
    variables: { type: "object" }
  }
};

const NORMALIZATION_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    eventType: { type: "string", description: "事件类型" },
    eventId: { type: "string", description: "事件唯一标识" },
    actor: { type: "string", description: "触发者" },
    subject: { type: "string", description: "事件主体" },
    timestamp: { type: "string", description: "事件时间" }
  },
  required: ["eventType", "eventId"]
};

const NORMALIZATION_SOURCE = `// 标准化处理器: 从原始请求中提取标准事件字段
// input.event 包含 headers, query, body
// input.source 包含 { id, key, name }
def event = input.event ?: [:]
def headers = event.headers ?: [:]
def query = event.query ?: [:]
def body = event.body ?: [:]

return [
    eventType: headers['X-Event-Type'] ?: body.action ?: "",
    eventId: body.id ?: "",
    actor: body.user?.name ?: "",
    subject: body.subject ?: "",
    timestamp: body.timestamp ?: new Date().toString()
]`;

const EVENT_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    event: {
      type: "object",
      properties: {
        eventType: { type: "string", description: "事件类型" },
        eventId: { type: "string", description: "事件唯一标识" },
        actor: { type: "string", description: "触发者" },
        subject: { type: "string", description: "事件主体" },
        timestamp: { type: "string", description: "事件时间" },
        headers: { type: "object", description: "原始请求头" },
        query: { type: "object", description: "原始查询参数" },
        body: { type: "object", description: "原始请求体" }
      }
    },
    source: {
      type: "object",
      properties: {
        id: { type: "string" },
        key: { type: "string" },
        name: { type: "string" }
      }
    },
    trigger: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        targetScriptId: { type: "string" }
      }
    },
    variables: { type: "object" }
  }
};

const FILTER_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    matched: { type: "boolean", description: "是否匹配触发条件" }
  },
  required: ["matched"]
};

const FILTER_SOURCE = `// 过滤处理器: 检查事件是否匹配触发条件
// input.event 包含标准化事件字段
def event = input.event ?: [:]
def eventType = event.eventType ?: ""

// TODO: 修改过滤条件
return [
    matched: eventType != ""
]`;

const IDEMPOTENCY_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    key: { type: "string", description: "幂等唯一键，相同 key 不会重复触发" }
  },
  required: ["key"]
};

const IDEMPOTENCY_SOURCE = `// 幂等处理器: 提取唯一键，相同 key 的事件不会重复触发
// input.event 包含标准化事件字段
def event = input.event ?: [:]

// TODO: 修改幂等键的组合逻辑
return [
    key: (event.sourceId ?: "") + ":" + (event.eventId ?: "")
]`;

const INPUT_SOURCE = `// 入参映射处理器: 将标准事件转换为目标脚本的输入
// input.event 包含标准化事件字段
// input.source 包含 { id, key, name }
// input.trigger 包含 { id, name, targetScriptId }
def event = input.event ?: [:]
def body = event.body ?: [:]

// TODO: 根据目标脚本的输入结构修改映射
return [
    // message: body.issue?.title ?: ""
]`;

const PRESETS: Record<ProcessorPurpose, ProcessorScriptPreset> = {
  normalization: {
    nameHint: "标准化处理脚本",
    inputSchema: NORMALIZATION_INPUT_SCHEMA,
    outputSchema: NORMALIZATION_OUTPUT_SCHEMA,
    source: NORMALIZATION_SOURCE
  },
  filter: {
    nameHint: "事件过滤脚本",
    inputSchema: EVENT_INPUT_SCHEMA,
    outputSchema: FILTER_OUTPUT_SCHEMA,
    source: FILTER_SOURCE
  },
  idempotency: {
    nameHint: "幂等处理脚本",
    inputSchema: EVENT_INPUT_SCHEMA,
    outputSchema: IDEMPOTENCY_OUTPUT_SCHEMA,
    source: IDEMPOTENCY_SOURCE
  },
  input: {
    nameHint: "入参映射脚本",
    inputSchema: EVENT_INPUT_SCHEMA,
    outputSchema: { type: "object", properties: {} },
    source: INPUT_SOURCE
  }
};

export function writePreset(purpose?: ProcessorPurpose): void {
  const preset = purpose ? PRESETS[purpose] : PRESETS.normalization;
  writeScriptCreatePreset(preset);
}

export function readAndClearPreset(): ProcessorScriptPreset | null {
  return readAndClearScriptCreatePreset();
}
