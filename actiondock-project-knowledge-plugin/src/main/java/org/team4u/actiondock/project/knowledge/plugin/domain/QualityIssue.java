package org.team4u.actiondock.project.knowledge.plugin.domain;

import java.util.Map;

/**
 * 知识库质量检查问题。
 *
 * <p>表示知识库质量校验过程中发现的单个问题，包含问题类型、文件位置和描述信息。
 *
 * @param code    问题类型编码（如 {@code missing-entry}、{@code empty-document}、{@code placeholder}）
 * @param path    问题所在文件的相对路径
 * @param message 问题描述
 */
public record QualityIssue(String code, String path, String message) {
    /**
     * 转换为可序列化的 Map 结构。
     *
     * @return 包含 code、path、message 键的 Map
     */
    public Map<String, Object> toMap() {
        return Map.of("code", code, "path", path, "message", message);
    }
}
