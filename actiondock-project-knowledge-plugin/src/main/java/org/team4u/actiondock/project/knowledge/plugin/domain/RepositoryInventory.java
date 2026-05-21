package org.team4u.actiondock.project.knowledge.plugin.domain;

import java.nio.file.Path;
import java.util.List;

/**
 * 仓库递归 inventory 结果。
 *
 * @param root             仓库根目录
 * @param inventorySignals inventory 证据
 * @param directorySnapshot 目录快照
 * @param modules          基于规则推导的模块清单
 * @param readmeExcerpt    README 摘要
 * @param evidenceContents 额外证据文件内容摘要
 * @param scanWarnings     inventory 阶段告警
 */
public record RepositoryInventory(
        Path root,
        List<String> inventorySignals,
        List<String> directorySnapshot,
        List<DetectedModule> modules,
        String readmeExcerpt,
        List<EvidenceExcerpt> evidenceContents,
        List<String> scanWarnings
) {
}
