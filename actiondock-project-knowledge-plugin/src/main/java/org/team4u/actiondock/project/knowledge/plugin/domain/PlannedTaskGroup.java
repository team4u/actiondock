package org.team4u.actiondock.project.knowledge.plugin.domain;

import java.util.List;

/**
 * 扫描阶段规划出的任务分组。
 *
 * @param id           分组标识
 * @param title        分组标题
 * @param templateName 模板名称
 * @param domains      关联域标识
 * @param evidence     关联证据
 */
public record PlannedTaskGroup(
        String id,
        String title,
        String templateName,
        List<String> domains,
        List<String> evidence
) {
}
