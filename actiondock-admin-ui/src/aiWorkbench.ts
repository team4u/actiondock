import type { AiWorkbenchResult, AiWorkbenchTaskType } from "./types";
import { prettyJson } from "./utils";

export type WorkbenchTaskKey = "generate" | "improve" | "schema" | "diagnose" | "review" | "releaseNotes";

export interface WorkbenchTaskDefinition {
  key: WorkbenchTaskKey;
  taskType: AiWorkbenchTaskType;
  title: string;
  description: string;
  needsScript?: boolean;
  needsExecution?: boolean;
}

export const WORKBENCH_TASKS: WorkbenchTaskDefinition[] = [
  { key: "generate", taskType: "GENERATE_SCRIPT", title: "生成脚本", description: "从目标描述生成脚本草稿、输入和输出 Schema" },
  { key: "improve", taskType: "IMPROVE_SCRIPT", title: "修复脚本", description: "基于现有脚本生成源码 patch 提案", needsScript: true },
  { key: "schema", taskType: "IMPROVE_SCHEMA", title: "补全 Schema", description: "补齐或改进输入输出 Schema", needsScript: true },
  { key: "diagnose", taskType: "DIAGNOSE_EXECUTION", title: "诊断执行失败", description: "读取失败执行记录、日志和脚本并给出诊断", needsExecution: true },
  { key: "review", taskType: "REVIEW_BEFORE_PUBLISH", title: "发布前 Review", description: "发布前检查风险、兼容性和遗漏", needsScript: true },
  { key: "releaseNotes", taskType: "GENERATE_RELEASE_NOTES", title: "Release Notes", description: "基于草稿和发布快照生成发布说明", needsScript: true }
];

export function normalizeWorkbenchTask(value: string | null): WorkbenchTaskKey {
  return WORKBENCH_TASKS.some((task) => task.key === value) ? (value as WorkbenchTaskKey) : "generate";
}

export function buildGeneratedScriptImportText(result: Record<string, unknown>): string {
  return [
    "### 脚本 ID",
    String(result.id ?? ""),
    "",
    "### 脚本名称",
    String(result.name ?? ""),
    "",
    "### 源码",
    "```groovy",
    String(result.source ?? ""),
    "```",
    "",
    "### inputSchema",
    "```json",
    JSON.stringify(result.inputSchema ?? {}, null, 2),
    "```",
    "",
    "### outputSchema",
    "```json",
    JSON.stringify(result.outputSchema ?? {}, null, 2),
    "```"
  ].join("\n");
}

export function workbenchResultCopyText(task: WorkbenchTaskKey, result?: AiWorkbenchResult | null): string {
  if (!result) return "";
  if (task === "generate") {
    return buildGeneratedScriptImportText(result.result);
  }
  if (task === "releaseNotes" && typeof result.result.notes === "string") {
    return String(result.result.notes);
  }
  return prettyJson(result.result);
}
