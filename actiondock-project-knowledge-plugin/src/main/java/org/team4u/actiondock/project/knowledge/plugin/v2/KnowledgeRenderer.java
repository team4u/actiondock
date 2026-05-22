package org.team4u.actiondock.project.knowledge.plugin.v2;

import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 知识库文档渲染器。
 *
 * <p>将生成的草稿写入 staging 临时目录，同时生成 ACTIONDOCK.md 入口文档和 KNOWLEDGE_REPORT.md 报告。
 * 渲染完成后进行质量校验，校验通过才进入发布阶段。
 */
final class KnowledgeRenderer {

    /**
     * 渲染所有文档到 staging 目录，生成入口文档和报告，并构建持久化状态。
     */
    RenderBundle render(ScanResult scan, KnowledgeDraft draft, String sessionId) throws IOException {
        Path stagingRoot = scan.repoPath().resolve(KnowledgeConstants.stagingDir(sessionId));
        resetDirectory(stagingRoot);
        List<DocumentRef> documents = new ArrayList<>();
        Map<String, StoredDocumentState> states = new LinkedHashMap<>();

        for (KnowledgeDocument document : draft.documents()) {
            write(stagingRoot.resolve(document.outputPath()), document.body());
            documents.add(new DocumentRef(document.documentId(), document.title(), document.outputPath()));
            states.put(document.documentId(), new StoredDocumentState(document.documentId(), document.outputPath(), document.fingerprint()));
        }

        String entry = renderEntry(draft);
        write(stagingRoot.resolve(KnowledgeConstants.ACTIONDOCK_ENTRY), entry);
        documents.add(new DocumentRef("entry", "ACTIONDOCK", KnowledgeConstants.ACTIONDOCK_ENTRY));
        states.put("entry", new StoredDocumentState("entry", KnowledgeConstants.ACTIONDOCK_ENTRY, RepositoryScanner.fingerprint(List.of(entry))));

        String report = renderReport(scan, draft, documents);
        write(stagingRoot.resolve(KnowledgeConstants.REPORT_FILE), report);
        documents.add(new DocumentRef("report", "Knowledge Report", KnowledgeConstants.REPORT_FILE));
        states.put("report", new StoredDocumentState("report", KnowledgeConstants.REPORT_FILE, RepositoryScanner.fingerprint(List.of(report))));

        List<String> generatedFiles = documents.stream().map(DocumentRef::outputPath).toList();
        return new RenderBundle(
                stagingRoot,
                List.copyOf(documents),
                KnowledgeConstants.REPORT_FILE,
                new KnowledgeState(states, generatedFiles, Instant.now().toString())
        );
    }

    /** 生成 ACTIONDOCK.md 入口文档，包含项目摘要和各文档的阅读链接。 */
    private String renderEntry(KnowledgeDraft draft) {
        Map<String, String> links = draft.documents().stream()
                .collect(Collectors.toMap(KnowledgeDocument::documentId, KnowledgeDocument::outputPath, (left, right) -> left, LinkedHashMap::new));
        List<String> bullets = new ArrayList<>();
        bullets.add("- 项目总览: `" + links.getOrDefault("overview", KnowledgeConstants.OVERVIEW_PATH) + "`");
        if (links.containsKey("flows")) {
            bullets.add("- 业务流程: `" + links.get("flows") + "`");
        }
        if (links.containsKey("data")) {
            bullets.add("- 数据模型: `" + links.get("data") + "`");
        }
        if (links.containsKey("operations")) {
            bullets.add("- 运行与排查: `" + links.get("operations") + "`");
        }
        return """
                # %s 项目知识库

                ## 项目摘要

                %s

                ## 阅读路径

                %s
                """.formatted(
                draft.projectName(),
                draft.projectSummary(),
                String.join("\n", bullets)
        ).strip() + "\n";
    }

    /** 生成 KNOWLEDGE_REPORT.md 报告，包含扫描摘要、生成文件列表和警告。 */
    private String renderReport(ScanResult scan, KnowledgeDraft draft, List<DocumentRef> documents) {
        String warnings = draft.warnings().isEmpty()
                ? "- 无"
                : draft.warnings().stream().map(item -> "- " + item).collect(Collectors.joining("\n"));
        String outputs = documents.stream()
                .map(document -> "- `" + document.outputPath() + "`")
                .collect(Collectors.joining("\n"));
        return """
                # 项目知识生成报告

                ## 摘要

                - 仓库: `%s`
                - 项目: `%s`
                - 技术栈: %s

                ## 生成文件

                %s

                ## 警告

                %s
                """.formatted(
                scan.repoPath(),
                draft.projectName(),
                draft.stacks().isEmpty() ? "未识别" : String.join(", ", draft.stacks()),
                outputs,
                warnings
        ).strip() + "\n";
    }

    private void write(Path path, String content) throws IOException {
        Path parent = path.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Files.writeString(path, content, StandardCharsets.UTF_8);
    }

    /** 清空并重建 staging 目录，确保每次生成从干净状态开始。 */
    private void resetDirectory(Path directory) throws IOException {
        if (Files.exists(directory)) {
            Files.walk(directory)
                    .sorted(java.util.Comparator.reverseOrder())
                    .forEach(path -> {
                        try {
                            Files.deleteIfExists(path);
                        } catch (IOException exception) {
                            throw new PluginRuntimeException("Cannot clear staging directory: " + path, exception);
                        }
                    });
        }
        Files.createDirectories(directory);
    }
}
