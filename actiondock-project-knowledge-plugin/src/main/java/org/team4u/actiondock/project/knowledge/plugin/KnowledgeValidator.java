package org.team4u.actiondock.project.knowledge.plugin;

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
     *
     * @param root 仓库根目录
     * @return 校验结果，包含是否通过和问题列表
     */
    MapValidation validate(Path root) throws IOException {
        return validate(root, defaultDocumentIds());
    }

    /**
     * 校验指定目录下的知识库文档质量。
     *
     * @param scanRoot 待校验的仓库根目录
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
        Path summary = scanRoot.resolve(KnowledgeConstants.SUMMARY_PATH);
        if (!Files.exists(summary)) {
            issues.add(new ValidationIssue("missing-summary", KnowledgeConstants.SUMMARY_PATH, "OCKB SUMMARY.md is missing.", "summary", "summary", true));
        } else {
            checkMarkdown(scanRoot, summary, documentIdsByPath, issues);
        }
        for (String rel : List.of(
                KnowledgeConstants.OVERVIEW_PATH,
                KnowledgeConstants.CODING_GUIDELINES_PATH,
                KnowledgeConstants.INFRA_ENV_PATH,
                KnowledgeConstants.DATA_PATH,
                KnowledgeConstants.FLOWS_PATH,
                KnowledgeConstants.AGENT_TOOLS_PATH,
                KnowledgeConstants.RUNBOOKS_PATH)) {
            Path path = scanRoot.resolve(rel);
            if (!Files.exists(path)) {
                issues.add(new ValidationIssue("missing-pillar", rel, "OCKB pillar document is missing.", documentIdsByPath.getOrDefault(rel, documentIdOf(rel)), documentIdOf(rel), true));
            } else {
                checkMarkdown(scanRoot, path, documentIdsByPath, issues);
            }
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
            if (content.startsWith("---\n")) {
                issues.add(new ValidationIssue("frontmatter", rel, "Formal document must be pure Markdown without YAML frontmatter.", documentId, documentId, true));
            }
            if (content.contains("```json") || content.contains("\"bodyMarkdown\"") || content.contains("touches_tables:") || content.contains("tags:")) {
                issues.add(new ValidationIssue("machine-metadata", rel, "Formal document contains machine metadata or JSON fragments.", documentId, documentId, true));
            }
            if (content.contains("## 关键结论") && !content.contains("[")) {
                issues.add(new ValidationIssue("missing-citation", rel, "Document contains conclusions without citations.", documentId, documentId, true));
            }
            if (rel.startsWith(KnowledgeConstants.KNOWLEDGE_BASE_ROOT + "/") && !rel.equals(KnowledgeConstants.SUMMARY_PATH)
                    && !content.contains("## 证据与边界")) {
                issues.add(new ValidationIssue("missing-evidence-boundary", rel, "OCKB document must include ## 证据与边界.", documentId, documentId, true));
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

    /** 返回默认的 "相对路径 → 文档 ID" 映射，覆盖所有标准 OCKB 文档。 */
    private Map<String, String> defaultDocumentIds() {
        Map<String, String> ids = new LinkedHashMap<>();
        ids.put(KnowledgeConstants.ACTIONDOCK_ENTRY, "entry");
        ids.put(KnowledgeConstants.SUMMARY_PATH, "summary");
        ids.put(KnowledgeConstants.OVERVIEW_PATH, "overview");
        ids.put(KnowledgeConstants.CODING_GUIDELINES_PATH, "coding-guidelines");
        ids.put(KnowledgeConstants.INFRA_ENV_PATH, "infra-env");
        ids.put(KnowledgeConstants.FLOWS_PATH, "flows");
        ids.put(KnowledgeConstants.DATA_PATH, "data");
        ids.put(KnowledgeConstants.AGENT_TOOLS_PATH, "agent-tools");
        ids.put(KnowledgeConstants.RUNBOOKS_PATH, "runbooks");
        return ids;
    }

    /** 从相对路径推断文档 ID，已知路径返回固定 ID，未知路径用冒号替换斜杠。 */
    private String documentIdOf(String rel) {
        if (rel.equals(KnowledgeConstants.ACTIONDOCK_ENTRY)) {
            return "entry";
        }
        if (rel.equals(KnowledgeConstants.SUMMARY_PATH)) {
            return "summary";
        }
        return defaultDocumentIds().getOrDefault(rel, rel.replace('/', ':'));
    }

    /** 校验结果，包含是否通过和所有发现的问题列表。 */
    record MapValidation(boolean ok, List<ValidationIssue> issues) {
    }
}
