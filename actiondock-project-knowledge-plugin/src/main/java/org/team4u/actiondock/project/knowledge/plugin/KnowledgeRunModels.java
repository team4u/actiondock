package org.team4u.actiondock.project.knowledge.plugin;

import java.util.List;
import java.util.Map;

/**
 * 异步知识库任务快照，记录任务的运行状态和结果。
 *
 * @param runId        任务唯一标识（如 "init-a1b2c3d4"）
 * @param mode         流水线模式（init / refresh / ingest）
 * @param status       任务状态（RUNNING / SUCCESS / FAILED / CANCELLED）
 * @param repoPath     仓库根目录的绝对路径
 * @param startedAt    任务开始时间（ISO-8601）
 * @param finishedAt   任务结束时间（ISO-8601），运行中为 null
 * @param result       任务成功时的返回结果，失败时为空 Map
 * @param errorMessage 失败或取消时的错误信息
 */
record KnowledgeRunSnapshot(
        String runId,
        String mode,
        String status,
        String repoPath,
        String startedAt,
        String finishedAt,
        Map<String, Object> result,
        String errorMessage
) {
}

/**
 * Agent 任务请求，描述单个 Agent 调用的输入。
 *
 * @param taskId       任务标识（如 "init-draft"）
 * @param taskType     任务类型（如 "document-pack"）
 * @param systemPrompt 系统提示词
 * @param userPrompt   用户提示词
 * @param input        传递给 Agent 的结构化输入数据
 */
record AgentTask(
        String taskId,
        String taskType,
        String systemPrompt,
        String userPrompt,
        Map<String, Object> input
) {
}

/**
 * Agent 任务执行结果。
 *
 * @param rawText  Agent 的原始文本输出（外部 CLI 模式下完整 stdout）
 * @param json     解析后的结构化 JSON 对象
 * @param warnings 执行过程中产生的警告列表（如外部 CLI 的 stderr）
 */
record AgentTaskResult(
        String rawText,
        Map<String, Object> json,
        List<String> warnings
) {
}
