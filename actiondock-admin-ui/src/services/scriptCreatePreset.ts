import type { AiAgentProfile, ScriptPackaging, ScriptType } from "../shared/types";

export interface ScriptCreatePreset {
  idHint?: string;
  nameHint: string;
  description?: string;
  type?: ScriptType;
  packaging?: ScriptPackaging;
  pythonRequirements?: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  source: string;
}

const SESSION_STORAGE_KEY = "actiondock_script_preset";

function escapeGroovyString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function slugifyScriptId(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "agent";
}

export function suggestPresetScriptId(idHint: string | undefined, existingIds: Iterable<string>): string {
  const baseId = slugifyScriptId(idHint ?? "script");
  const knownIds = new Set(existingIds);
  if (!knownIds.has(baseId)) {
    return baseId;
  }

  let index = 2;
  while (knownIds.has(`${baseId}-${index}`)) {
    index += 1;
  }
  return `${baseId}-${index}`;
}

export function buildAgentWrapperScriptPreset(agent: Pick<AiAgentProfile, "id" | "name" | "description">): ScriptCreatePreset {
  const agentLabel = agent.name.trim() || agent.id;
  const escapedAgentId = escapeGroovyString(agent.id);

  return {
    idHint: `agent-${slugifyScriptId(agent.id)}`,
    nameHint: `${agentLabel} 脚本`,
    description: `将 Agent Profile ${agent.id} 封装为可执行脚本。`,
    type: "GROOVY",
    packaging: "TOOL",
    inputSchema: {
      type: "object",
      properties: {
        instruction: {
          type: "string",
          title: "指令",
          description: "传给 Agent 的用户指令",
          "x-ui": { widget: "textarea", rows: 4 }
        },
        context: {
          type: "string",
          title: "上下文",
          description: "补充给 Agent 的上下文，可留空",
          "x-ui": { widget: "textarea", rows: 6 }
        }
      },
      required: ["instruction"]
    },
    outputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", title: "Run ID" },
        status: { type: "string", title: "状态" },
        text: { type: "string", title: "文本结果", "x-ui": { widget: "textarea", rows: 8 } },
        data: { type: "object", title: "原始数据" },
        usage: { type: "object", title: "用量" },
        errorMessage: { type: "string", title: "错误信息" }
      }
    },
    source: `def instruction = (input.instruction ?: "").toString()
def contextText = (input.context ?: "").toString()

def messages = [[role: "user", content: contextText ? instruction + "\\n\\n上下文:\\n" + contextText : instruction]]
def result = plugins.invoke('actiondock-ai', 'agentRun', [
    agentProfile: '${escapedAgentId}',
    messages: messages,
    input: [
        instruction: instruction,
        context: contextText
    ],
    options: [:]
])

def data = result.data() ?: [:]
def status = result.status()?.name()
def output = [
    runId: result.runId(),
    status: status,
    text: (data.text ?: "").toString(),
    data: data,
    usage: result.usage(),
    errorMessage: result.errorMessage()
]

if (status != "SUCCESS") {
    throw new IllegalStateException("Agent Run failed: " + output.runId + " " + status + " " + (output.errorMessage ?: ""))
}

return output`
  };
}

export interface WebhookScriptPresetOptions {
  key?: string;
  name?: string;
}

export function buildWebhookScriptPreset(options?: WebhookScriptPresetOptions): ScriptCreatePreset {
  const normalizedKey = options?.key?.trim();
  const normalizedName = options?.name?.trim();
  const label = normalizedName || normalizedKey || "Webhook";

  return {
    idHint: normalizedKey ? `webhook-${slugifyScriptId(normalizedKey)}` : "webhook-script",
    nameHint: `${label} 脚本`,
    description: "处理 Webhook 请求并直接返回 HTTP 响应。",
    type: "GROOVY",
    packaging: "TOOL",
    inputSchema: {
      type: "object",
      properties: {
        request: {
          type: "object",
          title: "请求",
          properties: {
            method: { type: "string", title: "Method", description: "HTTP 方法" },
            path: { type: "string", title: "Path", description: "请求路径" },
            headers: {
              type: "object",
              title: "Headers",
              description: "请求头，多值头为 string[]",
              additionalProperties: {
                type: "array",
                items: { type: "string" }
              }
            },
            query: {
              type: "object",
              title: "Query",
              description: "查询参数，多值参数为 string[]",
              additionalProperties: {
                type: "array",
                items: { type: "string" }
              }
            },
            rawBody: {
              type: "string",
              title: "Raw Body",
              description: "原始请求体字符串",
              "x-ui": { widget: "textarea", rows: 8 }
            },
            contentType: { type: "string", title: "Content-Type", description: "请求 Content-Type" }
          },
          required: ["method", "path", "headers", "query"]
        },
        webhook: {
          type: "object",
          title: "Webhook",
          properties: {
            id: { type: "string", title: "ID" },
            key: { type: "string", title: "Key" },
            name: { type: "string", title: "Name" }
          },
          required: ["id", "key", "name"]
        }
      },
      required: ["request", "webhook"]
    },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "integer", title: "HTTP Status", description: "返回的 HTTP 状态码" },
        headers: {
          type: "object",
          title: "Response Headers",
          description: "响应头，值可以是 string 或 string[]"
        },
        body: {
          title: "Response Body",
          description: "响应体，可以是字符串、对象或 null"
        }
      },
      required: ["status"]
    },
    source: `def request = input.request instanceof Map ? input.request : [:]
def webhook = input.webhook instanceof Map ? input.webhook : [:]
def method = (request.method ?: "POST").toString()
def path = (request.path ?: "").toString()
def headers = request.headers instanceof Map ? request.headers : [:]
def query = request.query instanceof Map ? request.query : [:]
def rawBody = request.rawBody?.toString()
def contentType = (request.contentType ?: "").toString()

// TODO: 在这里实现鉴权、验签、幂等和业务逻辑
return [
    status : 200,
    headers: [
        "Content-Type": ["application/json;charset=UTF-8"]
    ],
    body   : [
        ok        : true,
        webhook   : [
            id  : webhook.id,
            key : webhook.key,
            name: webhook.name
        ],
        request   : [
            method     : method,
            path       : path,
            contentType: contentType,
            headers    : headers,
            query      : query,
            rawBody    : rawBody
        ]
    ]
]`
  };
}

export function writeScriptCreatePreset(preset: ScriptCreatePreset): void {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(preset));
}

export function readAndClearScriptCreatePreset(): ScriptCreatePreset | null {
  const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  try {
    return JSON.parse(raw) as ScriptCreatePreset;
  } catch {
    return null;
  }
}
