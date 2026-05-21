package org.team4u.actiondock.project.knowledge.plugin.domain;

import java.nio.file.Path;
import java.util.List;

/**
 * 仓库扫描结果。
 *
 * <p>封装递归 inventory 和 AI 判域后的仓库事实，用于任务规划、文档写入和报告输出。
 *
 * @param root             仓库根目录绝对路径
 * @param scanSummary      扫描摘要
 * @param projectShape     项目形态
 * @param detectedStacks   识别出的技术栈列表
 * @param modules          模块清单
 * @param domains          激活的知识域清单
 * @param taskGroups       扫描阶段建议的任务分组
 * @param inventorySignals inventory 收集到的证据列表
 * @param scanWarnings     扫描阶段告警
 * @param evidenceFiles    用户指定的额外证据文件
 */
public record RepositoryFacts(
        Path root,
        String scanSummary,
        String projectShape,
        List<String> detectedStacks,
        List<DetectedModule> modules,
        List<DetectedDomain> domains,
        List<PlannedTaskGroup> taskGroups,
        List<String> inventorySignals,
        List<String> scanWarnings,
        List<String> evidenceFiles
) {
}
