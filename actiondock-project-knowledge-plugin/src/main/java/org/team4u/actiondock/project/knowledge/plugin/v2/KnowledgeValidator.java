package org.team4u.actiondock.project.knowledge.plugin.v2;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 知识库文档质量校验器。
 *
 * <p>校验已渲染的文档是否符合质量门槛，包括：入口文件是否存在、文档是否为空、
 * 是否包含临时路径引用、是否包含占位符文本、关键结论是否附带引用。
 */
final class KnowledgeValidator {

    /**
     * 使用默认文档 ID 映射校验仓库中已发布的知识库文档。
     */
    MapValidation validate(Path root) throws IOException {
        return validate(root, defaultDocumentIds());
    }

    /**
     * 校验指定目录下的知识库文档质量。
     *
     * @param scanRoot 待校验的根目录（staging 或仓库根目录）
     * @param documentIdsByPath 文件路径到文档 ID 的映射
     */
    MapValidation validate(Path scanRoot, Map<String, String> documentIdsByPath) throws IOException {
        List<ValidationIssue> issues = new ArrayList<>();
        Path entry = scanRoot.resolve(KnowledgeConstants.ACTIONDOCK_ENTRY);
        if (!Files.exists(entry)) {
            issues.add(new ValidationIssue("missing-entry", KnowledgeConstants.ACTIONDOCK_ENTRY, "ACTIONDOCK.md is missing.", "entry", "entry", true));
        } else {
            checkMarkdown(scanRoot, entry, documentIdsByPath, issues);
        }
        for (String rel : List.of(KnowledgeConstants.OVERVIEW_PATH, KnowledgeConstants.FLOWS_PATH, KnowledgeConstants.DATA_PATH, KnowledgeConstants.OPERATIONS_PATH)) {
            Path path = scanRoot.resolve(rel);
            if (Files.exists(path)) {
                checkMarkdown(scanRoot, path, documentIdsByPath, issues);
            }
        }
        Path report = scanRoot.resolve(KnowledgeConstants.REPORT_FILE);
        if (Files.exists(report)) {
            checkMarkdown(scanRoot, report, documentIdsByPath, issues);
        }
        return new MapValidation(issues.isEmpty(), issues);
    }

    /**
     * 对单个 Markdown 文件执行质量检查规则。
     *
     * <p>检查项包括：空文档、临时路径引用、占位符文本（todo/placeholder）、
     * 关键结论段落缺少引用标记。
     */
    private void checkMarkdown(Path scanRoot, Path path, Map<String, String> documentIdsByPath, List<ValidationIssue> issues) {
        try {
            String rel = scanRoot.relativize(path).toString().replace('\\', '/');
            String content = Files.readString(path, StandardCharsets.UTF_8);
            String documentId = documentIdsByPath.getOrDefault(rel, documentIdOf(rel));
            if (content.isBlank()) {
                issues.add(new ValidationIssue("empty-document", rel, "Document is empty.", documentId, documentId, true));
            }
            if (content.contains(".actiondock/project-knowledge") || content.contains(".knowledge-tmp")) {
                issues.add(new ValidationIssue("temp-reference", rel, "Formal document references temporary workspace.", documentId, documentId, true));
            }
            String lower = content.toLowerCase(Locale.ROOT);
            if (lower.contains("todo") || lower.contains("placeholder")) {
                issues.add(new ValidationIssue("placeholder", rel, "Formal document contains placeholder text.", documentId, documentId, true));
            }
            if (content.contains("## 关键结论") && !content.contains("[")) {
                issues.add(new ValidationIssue("missing-citation", rel, "Document contains conclusions without citations.", documentId, documentId, true));
            }
        } catch (IOException exception) {
            String rel = scanRoot.relativize(path).toString().replace('\\', '/');
            issues.add(new ValidationIssue(
                    "read-failed",
                    rel,
                    exception.getMessage(),
                    documentIdsByPath.getOrDefault(rel, documentIdOf(rel)),
                    documentIdsByPath.getOrDefault(rel, documentIdOf(rel)),
                    false
            ));
        }
    }

    Map<String, String> documentIdsByPath(List<DocumentRef> documents) {
        Map<String, String> values = new LinkedHashMap<>();
        for (DocumentRef document : documents) {
            values.put(document.outputPath(), document.documentId());
        }
        return values;
    }

    private Map<String, String> defaultDocumentIds() {
        Map<String, String> ids = new LinkedHashMap<>();
        ids.put(KnowledgeConstants.ACTIONDOCK_ENTRY, "entry");
        ids.put(KnowledgeConstants.REPORT_FILE, "report");
        ids.put(KnowledgeConstants.OVERVIEW_PATH, "overview");
        ids.put(KnowledgeConstants.FLOWS_PATH, "flows");
        ids.put(KnowledgeConstants.DATA_PATH, "data");
        ids.put(KnowledgeConstants.OPERATIONS_PATH, "operations");
        return ids;
    }

    private String documentIdOf(String rel) {
        if (rel.equals(KnowledgeConstants.ACTIONDOCK_ENTRY)) {
            return "entry";
        }
        if (rel.equals(KnowledgeConstants.REPORT_FILE)) {
            return "report";
        }
        return defaultDocumentIds().getOrDefault(rel, rel.replace('/', ':'));
    }

    /** 校验结果，包含是否通过和所有发现的问题列表。 */
    record MapValidation(boolean ok, List<ValidationIssue> issues) {
    }
}
