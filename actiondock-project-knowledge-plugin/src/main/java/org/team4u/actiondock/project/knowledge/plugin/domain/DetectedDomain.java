package org.team4u.actiondock.project.knowledge.plugin.domain;

import java.util.List;

/**
 * AI 扫描识别出的知识域。
 *
 * @param id       域标识
 * @param priority 优先级
 * @param reason   激活原因
 * @param evidence 关键证据
 */
public record DetectedDomain(
        String id,
        String priority,
        String reason,
        List<String> evidence
) {
}
