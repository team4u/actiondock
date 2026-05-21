package org.team4u.actiondock.project.knowledge.plugin.domain;

import java.util.Map;

/**
 * 原子任务执行结果。
 *
 * <p>记录单个原子任务的执行状态和产出，包括原始输出、解析后的结构化数据和错误信息。
 *
 * @param taskId      关联的原子任务 ID
 * @param taskType    任务类型
 * @param status      执行状态（{@code done} / {@code needs_review} / {@code skipped}）
 * @param rawOutput   执行器返回的原始输出
 * @param parsedOutput 解析后的结构化输出
 * @param parseError  输出解析失败的错误信息
 * @param outputPath  任务产出文件的相对路径
 */
public record TaskResult(
        String taskId,
        String taskType,
        String status,
        String rawOutput,
        Map<String, Object> parsedOutput,
        String parseError,
        String outputPath
) {
    /**
     * 判断任务是否执行成功。
     *
     * @return 状态为 {@code done} 时返回 {@code true}
     */
    public boolean done() {
        return "done".equals(status);
    }
}
