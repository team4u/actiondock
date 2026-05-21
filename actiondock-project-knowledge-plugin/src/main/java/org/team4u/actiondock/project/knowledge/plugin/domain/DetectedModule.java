package org.team4u.actiondock.project.knowledge.plugin.domain;

import java.util.List;

/**
 * inventory 阶段识别出的模块信息。
 *
 * @param path     模块相对路径
 * @param role     模块角色
 * @param stacks   模块技术栈
 * @param evidence 证据路径
 */
public record DetectedModule(
        String path,
        String role,
        List<String> stacks,
        List<String> evidence
) {
}
