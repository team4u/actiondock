package org.team4u.actiondock.project.knowledge.plugin.domain;

/**
 * 证据文件摘要。
 *
 * @param path    证据文件相对路径
 * @param content 摘要内容
 */
public record EvidenceExcerpt(
        String path,
        String content
) {
}
