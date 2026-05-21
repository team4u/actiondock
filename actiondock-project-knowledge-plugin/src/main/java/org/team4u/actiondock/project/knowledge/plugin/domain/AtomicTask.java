package org.team4u.actiondock.project.knowledge.plugin.domain;

import java.util.List;
import java.util.Map;

/**
 * 知识库维护原子任务。
 *
 * <p>表示知识库工作流中的最小执行单元，每个原子任务对应一个明确的知识域分析目标。
 * 任务执行完成后产出结构化结果，由工作流统一合并写入知识文档。
 *
 * @param id          任务唯一标识（如 {@code outline-1}、{@code data-1}）
 * @param taskType    任务类型（如 {@code draftExplorationOutline}、{@code draftDataIndex}）
 * @param title       任务描述标题
 * @param templateName 渲染输出所使用的模板名称
 * @param outputPath  任务产出文件的相对路径
 * @param evidence    作为输入证据的文件列表
 * @param input       任务附加输入参数
 */
public record AtomicTask(
        String id,
        String taskType,
        String title,
        String templateName,
        String outputPath,
        List<String> evidence,
        Map<String, Object> input
) {
}
