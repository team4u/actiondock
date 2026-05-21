package org.team4u.actiondock.project.knowledge.plugin.domain;

import java.nio.file.Path;
import java.util.List;

/**
 * 仓库扫描结果。
 *
 * <p>封装对目标仓库进行结构扫描后收集的全部信息，包括检测到的文件、激活的知识域、警告信息和证据文件。
 *
 * @param root            仓库根目录的绝对路径
 * @param detectedFiles   检测到的文件列表（格式：{@code label:relativePath}）
 * @param activatedDomains 激活的知识域列表（如 {@code java}、{@code frontend}、{@code data}）
 * @param warnings        扫描过程中产生的警告信息
 * @param evidenceFiles   用户指定的额外证据文件列表
 */
public record RepositoryFacts(
        Path root,
        List<String> detectedFiles,
        List<String> activatedDomains,
        List<String> warnings,
        List<String> evidenceFiles
) {
}
