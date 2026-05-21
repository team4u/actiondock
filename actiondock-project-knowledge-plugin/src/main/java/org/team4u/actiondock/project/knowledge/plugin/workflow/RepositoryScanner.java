package org.team4u.actiondock.project.knowledge.plugin.workflow;

import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.project.knowledge.plugin.domain.KnowledgeConstants;
import org.team4u.actiondock.project.knowledge.plugin.domain.MaintenanceRequest;
import org.team4u.actiondock.project.knowledge.plugin.domain.RepositoryFacts;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * 仓库结构扫描器。
 *
 * <p>扫描目标仓库的目录结构，检测关键文件（pom.xml、package.json、README.md 等），
 * 推断激活的知识域（Java、前端、数据），并收集用户指定的证据文件。
 *
 * @author ActionDock
 */
public class RepositoryScanner {

    /**
     * 扫描仓库结构并返回仓库事实信息。
     *
     * <p>检测规则：
     * <ul>
     *   <li>存在 {@code pom.xml} → 激活 {@code java} 域</li>
     *   <li>存在 {@code package.json} → 激活 {@code frontend} 域</li>
     *   <li>存在 {@code db/migration} → 激活 {@code data} 域</li>
     *   <li>始终激活 {@code actiondock} 和 {@code common} 域</li>
     * </ul>
     *
     * @param request 维护请求
     * @return 仓库扫描结果
     * @throws IOException 仓库路径无效或文件系统操作失败
     * @throws PluginRuntimeException 仓库路径不存在或不是目录
     */
    public RepositoryFacts scan(MaintenanceRequest request) throws IOException {
        Path root = request.repoPath();
        if (!Files.exists(root)) {
            throw new PluginRuntimeException("repoPath does not exist: " + root);
        }
        if (!Files.isDirectory(root)) {
            throw new PluginRuntimeException("repoPath must be a directory: " + root);
        }

        List<String> detected = new ArrayList<>();
        List<String> domains = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        // 检测关键项目文件
        detect(root, detected, "pom.xml", "java-maven");
        detect(root, detected, "package.json", "node");
        detect(root, detected, "README.md", "readme");
        detect(root, detected, KnowledgeConstants.ENTRY_PATH, "actiondock-entry");
        detect(root, detected, "src/main/resources/db/migration", "database");

        // 根据检测到的文件推断激活的知识域
        if (detected.stream().anyMatch(item -> item.endsWith("pom.xml"))) {
            domains.add("java");
        }
        if (detected.stream().anyMatch(item -> item.endsWith("package.json"))) {
            domains.add("frontend");
        }
        if (detected.stream().anyMatch(item -> item.contains("db/migration"))) {
            domains.add("data");
        }
        // actiondock 和 common 域始终激活
        domains.add("actiondock");
        domains.add("common");

        // 入口文件缺失时给出提示
        if (!Files.exists(root.resolve(KnowledgeConstants.ENTRY_PATH))) {
            warnings.add("ACTIONDOCK.md is missing and will be initialized.");
        }

        // 校验用户指定的证据文件
        for (String evidenceFile : request.evidenceFiles()) {
            Path evidencePath = root.resolve(evidenceFile).normalize();
            if (Files.exists(evidencePath)) {
                detected.add("evidence:" + evidenceFile);
            } else {
                warnings.add("Evidence file not found: " + evidenceFile);
            }
        }
        return new RepositoryFacts(root, detected, distinct(domains), warnings, request.evidenceFiles());
    }

    private static void detect(Path root, List<String> detected, String relativePath, String label) {
        if (Files.exists(root.resolve(relativePath))) {
            detected.add(label + ":" + relativePath);
        }
    }

    private static List<String> distinct(List<String> values) {
        return values.stream().distinct().toList();
    }
}
