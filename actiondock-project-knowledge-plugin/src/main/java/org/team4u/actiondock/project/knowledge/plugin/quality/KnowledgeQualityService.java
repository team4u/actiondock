package org.team4u.actiondock.project.knowledge.plugin.quality;

import org.team4u.actiondock.project.knowledge.plugin.domain.KnowledgeConstants;
import org.team4u.actiondock.project.knowledge.plugin.domain.QualityIssue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Stream;

/**
 * 知识库质量检查服务。
 *
 * <p>对知识库文档执行静态质量校验，检查入口文件完整性、文档内容有效性，并检测常见的质量问题：
 * <ul>
 *   <li>{@code missing-entry} — ACTIONDOCK.md 入口文件缺失</li>
 *   <li>{@code empty-document} — 空文档</li>
 *   <li>{@code temp-reference} — 正式文档引用了临时目录</li>
 *   <li>{@code placeholder} — 文档包含占位符文本（TODO、placeholder 等）</li>
 * </ul>
 *
 * @author ActionDock
 */
public class KnowledgeQualityService {

    /**
     * 校验仓库根目录下的知识库文档质量。
     *
     * <p>检查入口文件 ACTIONDOCK.md 和 {@code docs/} 目录下所有 Markdown 文件。
     *
     * @param root 仓库根目录
     * @return 校验结果，包含 {@code ok}（是否通过）和 {@code issues}（问题列表）
     * @throws IOException 文件读取失败
     */
    public Map<String, Object> validate(Path root) throws IOException {
        List<QualityIssue> issues = new ArrayList<>();

        // 优先检查入口文件
        Path entry = root.resolve(KnowledgeConstants.ENTRY_PATH);
        if (!Files.exists(entry)) {
            issues.add(new QualityIssue("missing-entry", KnowledgeConstants.ENTRY_PATH, "ACTIONDOCK.md is missing."));
        } else {
            checkMarkdown(root, entry, issues);
        }

        // 遍历 docs/ 目录下所有 Markdown 文件
        Path docs = root.resolve("docs");
        if (Files.isDirectory(docs)) {
            try (Stream<Path> stream = Files.walk(docs)) {
                stream.filter(Files::isRegularFile)
                        .filter(path -> path.getFileName().toString().endsWith(".md"))
                        .forEach(path -> checkMarkdown(root, path, issues));
            }
        }

        return Map.of(
                "ok", issues.isEmpty(),
                "issues", issues.stream().map(QualityIssue::toMap).toList()
        );
    }

    /**
     * 检查单个 Markdown 文件的质量问题。
     */
    private static void checkMarkdown(Path root, Path path, List<QualityIssue> issues) {
        String relative = root.equals(path) ? path.toString() : root.relativize(path).toString();
        try {
            String content = Files.readString(path, StandardCharsets.UTF_8);
            // 检查空文档
            if (content.isBlank()) {
                issues.add(new QualityIssue("empty-document", relative, "Document is empty."));
            }
            // 检查是否引用了临时目录（正式文档不应包含 .knowledge-tmp 引用）
            if (content.contains(KnowledgeConstants.TEMP_ROOT)) {
                issues.add(new QualityIssue("temp-reference", relative, "Formal document references .knowledge-tmp."));
            }
            // 检查是否包含未完成的占位符
            if (containsPlaceholder(content)) {
                issues.add(new QualityIssue("placeholder", relative, "Formal document contains placeholder text."));
            }
        } catch (IOException exception) {
            issues.add(new QualityIssue("read-failed", relative, exception.getMessage()));
        }
    }

    /**
     * 检测文档内容是否包含占位符文本。
     */
    private static boolean containsPlaceholder(String content) {
        String lower = content.toLowerCase(Locale.ROOT);
        return lower.contains("todo") || lower.contains("[todo") || lower.contains("placeholder");
    }
}
