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
