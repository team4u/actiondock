package org.team4u.actiondock.project.knowledge.plugin;

import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 知识库文档生成器。
 *
 * <p>根据仓库扫描结果，优先使用 AI 生成高质量文档；AI 不可用或失败时回退到确定性模板策略。
 * 生成的文档包含项目总览、业务流程、数据模型和运行排查四类。
 */
final class KnowledgeGenerator {
    private final AiJsonSupport aiSupport;

    KnowledgeGenerator(AiJsonSupport aiSupport) {
        this.aiSupport = aiSupport;
    }

    /**
     * 生成知识库草稿。优先尝试 AI 生成，失败时回退到确定性策略并附带警告。
     */
    KnowledgeDraft generate(ScriptPluginContext context, KnowledgeRequest request, ScanResult scan) {
        List<DocumentSpec> specs = specs(scan);
        if (!aiSupport.available(request.aiProfile())) {
            return deterministicDraft(scan, specs);
        }
        try {
            return aiDraft(context, request, scan, specs);
        } catch (Exception exception) {
            List<String> warnings = new ArrayList<>(scan.warnings());
            warnings.add("AI generation fallback: " + exception.getMessage());
            KnowledgeDraft draft = deterministicDraft(scan, specs);
            return new KnowledgeDraft(draft.projectName(), draft.projectSummary(), draft.stacks(), draft.documents(), warnings);
        }
    }

    /**
     * 调用 AI 生成结构化文档，并严格校验返回结果是否包含所有必需文档。
     */
    private KnowledgeDraft aiDraft(ScriptPluginContext context,
                                   KnowledgeRequest request,
                                   ScanResult scan,
                                   List<DocumentSpec> specs) {
        Map<String, Object> ai = aiSupport.runJson(
                context,
                request.aiProfile(),
                "You generate a small, evidence-bound project knowledge pack. Return JSON only.",
                """
                        Project:
                        - name: %s
                        - audience: %s
                        - detailLevel: %s
                        - stacks: %s
                        - summary: %s

                        Evidence index:
                        %s

                        Required documents:
                        %s

                        Return JSON with:
                        - projectSummary
                        - documents[{id,title,outputPath,body}]

                        Constraints:
                        - Use exactly the required document ids and output paths.
                        - Each document body must be markdown and include evidence references in square brackets when making conclusions.
                        - Do not invent files, tables, or flows outside the evidence list.
                        """.formatted(
                        scan.projectName(),
                        request.audience(),
                        request.detailLevel(),
                        scan.stacks(),
                        scan.summary(),
                        scan.evidence().stream()
                                .limit(80)
                                .map(item -> item.id() + " -> " + item.path() + " [" + item.type() + "]")
                                .collect(Collectors.joining("\n")),
                        specs.stream()
                                .map(spec -> "- " + spec.documentId() + " | " + spec.outputPath() + " | " + spec.promptHint())
                                .collect(Collectors.joining("\n"))
                ),
                Map.of("repoPath", scan.repoPath().toString(), "documentCount", specs.size()),
                Map.of("phase", "generate"),
                Map.of("pluginId", "actiondock-project-knowledge", "phase", "generate")
        );
        String projectSummary = string(ai.get("projectSummary"));
        if (projectSummary == null || projectSummary.isBlank()) {
            projectSummary = scan.summary();
        }
        Map<String, DocumentSpec> specById = specs.stream()
                .collect(Collectors.toMap(DocumentSpec::documentId, spec -> spec, (left, right) -> left, LinkedHashMap::new));
        if (!(ai.get("documents") instanceof List<?> documents)) {
            throw new PluginRuntimeException("AI output missing documents");
        }
        List<KnowledgeDocument> generated = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (Object item : documents) {
            if (!(item instanceof Map<?, ?> map)) {
                continue;
            }
            String id = string(map.get("id"));
            String outputPath = string(map.get("outputPath"));
            String title = string(map.get("title"));
            String body = string(map.get("body"));
            DocumentSpec spec = specById.get(id);
            if (spec == null) {
                throw new PluginRuntimeException("AI returned unknown document id: " + id);
            }
            if (!spec.outputPath().equals(outputPath)) {
                throw new PluginRuntimeException("AI returned unexpected outputPath for " + id);
            }
            if (title == null || title.isBlank() || body == null || body.isBlank()) {
                throw new PluginRuntimeException("AI returned incomplete document: " + id);
            }
            generated.add(new KnowledgeDocument(id, title, outputPath, normalizeBody(title, body), RepositoryScanner.fingerprint(List.of(outputPath, body))));
            seen.add(id);
        }
        if (!seen.equals(specById.keySet())) {
            throw new PluginRuntimeException("AI did not return the full required document set");
        }
        return new KnowledgeDraft(scan.projectName(), projectSummary, scan.stacks(), generated, scan.warnings());
    }

    /**
     * 确定性模板策略：根据证据类型填充预设的 Markdown 模板，不依赖 AI。
     */
    private KnowledgeDraft deterministicDraft(ScanResult scan, List<DocumentSpec> specs) {
        List<KnowledgeDocument> documents = new ArrayList<>();
        for (DocumentSpec spec : specs) {
            String body = switch (spec.documentId()) {
                case "overview" -> overviewBody(scan, spec);
                case "flows" -> flowsBody(scan, spec);
                case "data" -> dataBody(scan, spec);
                case "operations" -> operationsBody(scan, spec);
                default -> spec.title();
            };
            documents.add(new KnowledgeDocument(
                    spec.documentId(),
                    spec.title(),
                    spec.outputPath(),
                    normalizeBody(spec.title(), body),
                    RepositoryScanner.fingerprint(List.of(spec.outputPath(), body))
            ));
        }
        return new KnowledgeDraft(scan.projectName(), scan.summary(), scan.stacks(), documents, scan.warnings());
    }

    /**
     * 根据扫描结果决定需要生成哪些文档规格，仅在存在对应证据时才生成可选文档。
     */
    private List<DocumentSpec> specs(ScanResult scan) {
        List<DocumentSpec> specs = new ArrayList<>();
        specs.add(new DocumentSpec("overview", "项目总览", KnowledgeConstants.OVERVIEW_PATH, leading(scan.evidence(), 8), "project structure and reading order"));
        if (!scan.flowPaths().isEmpty()) {
            specs.add(new DocumentSpec("flows", "业务流程", KnowledgeConstants.FLOWS_PATH, scan.flowPaths(), "business entrypoints and main request flows"));
        }
        if (!scan.tableNames().isEmpty() || !scan.sqlPaths().isEmpty()) {
            specs.add(new DocumentSpec("data", "数据模型", KnowledgeConstants.DATA_PATH, !scan.sqlPaths().isEmpty() ? scan.sqlPaths() : leading(scan.evidence(), 6), "tables, migrations, and schema hints"));
        }
        if (!scan.operationPaths().isEmpty()) {
            specs.add(new DocumentSpec("operations", "运行与排查", KnowledgeConstants.OPERATIONS_PATH, scan.operationPaths(), "runtime, config, integration, and diagnosis guidance"));
        }
        return specs;
    }

    private String overviewBody(ScanResult scan, DocumentSpec spec) {
        return """
                ## 摘要

                %s

                ## 技术栈

                - %s

                ## 阅读顺序

                - 先读 `ACTIONDOCK.md`
                - 再读 `docs/project/overview.md`
                %s

                ## 关键结论

                - 项目当前的主要实现线索已收敛到仓库证据中。 [%s]
                - 文档优先覆盖结构、业务入口和数据模型。 [%s]
                """.formatted(
                fallbackText(scan.readmeExcerpt(), scan.summary()),
                scan.stacks().isEmpty() ? "未识别" : String.join("\n- ", scan.stacks()),
                scan.flowPaths().isEmpty() ? "" : "- 如需理解业务入口，再读 `docs/project/flows.md`\n",
                citationFor(spec),
                citationFor(spec)
        );
    }

    private String flowsBody(ScanResult scan, DocumentSpec spec) {
        String flows = scan.flowPaths().stream().map(path -> "- `" + path + "`").collect(Collectors.joining("\n"));
        return """
                ## 摘要

                本文档汇总仓库中的业务入口与主要调用起点。

                ## 关键结论

                - 业务流程入口主要来自 Controller、Router、Handler 或 Job。 [%s]

                ## 入口列表

                %s
                """.formatted(citationFor(spec), flows);
    }

    private String dataBody(ScanResult scan, DocumentSpec spec) {
        String tables = scan.tableNames().isEmpty()
                ? "- 未从 SQL 中解析出显式表名"
                : scan.tableNames().stream().map(table -> "- `" + table + "`").collect(Collectors.joining("\n"));
        String sqlPaths = scan.sqlPaths().stream().map(path -> "- `" + path + "`").collect(Collectors.joining("\n"));
        return """
                ## 摘要

                本文档汇总数据库迁移和表结构线索。

                ## 关键结论

                - 数据模型优先以 SQL migration 和 schema 文件为准。 [%s]

                ## 表

                %s

                ## 证据文件

                %s
                """.formatted(citationFor(spec), tables, sqlPaths.isBlank() ? "- 无" : sqlPaths);
    }

    private String operationsBody(ScanResult scan, DocumentSpec spec) {
        String ops = scan.operationPaths().stream().map(path -> "- `" + path + "`").collect(Collectors.joining("\n"));
        return """
                ## 摘要

                本文档汇总运行配置、外部依赖与排查入口。

                ## 关键结论

                - 运行与排查线索主要来自配置、集成客户端、日志和安全相关文件。 [%s]

                ## 证据入口

                %s
                """.formatted(citationFor(spec), ops);
    }

    private String citationFor(DocumentSpec spec) {
        return spec.evidencePaths().isEmpty() ? spec.outputPath() : spec.evidencePaths().getFirst();
    }

    private List<String> leading(List<EvidenceRecord> evidence, int max) {
        return evidence.stream().limit(max).map(EvidenceRecord::path).toList();
    }

    /** 标准化文档正文：确保以 # 标题开头、尾部有换行符。 */
    private String normalizeBody(String title, String body) {
        String normalized = body.strip();
        if (!normalized.startsWith("# ")) {
            normalized = "# " + title + "\n\n" + normalized;
        }
        return normalized.endsWith("\n") ? normalized : normalized + "\n";
    }

    /** 返回首选文本，为空时回退到默认值。 */
    private String fallbackText(String preferred, String fallback) {
        return preferred == null || preferred.isBlank() ? fallback : preferred;
    }

    private String string(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
