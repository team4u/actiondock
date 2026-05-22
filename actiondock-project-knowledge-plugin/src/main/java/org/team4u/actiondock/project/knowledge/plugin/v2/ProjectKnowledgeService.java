package org.team4u.actiondock.project.knowledge.plugin.v2;

import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.io.IOException;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 项目知识库服务。
 *
 * <p>编排知识库生成的完整流程：扫描 → 生成草稿 → 渲染到 staging → 质量校验 → 发布。
 * 校验不通过时仅输出到 staging 并标记 NEEDS_REVIEW，不污染仓库正式目录。
 * 也支持独立的 validate 操作，对已存在的知识库文档执行质量检查。
 */
public class ProjectKnowledgeService {
    private final RepositoryScanner scanner = new RepositoryScanner();
    private final AiJsonSupport aiSupport;
    private final KnowledgeGenerator generator;
    private final KnowledgeRenderer renderer = new KnowledgeRenderer();
    private final KnowledgePublisher publisher = new KnowledgePublisher();
    private final KnowledgeValidator validator = new KnowledgeValidator();

    public ProjectKnowledgeService(AiAgentRuntime runtime) {
        this.aiSupport = new AiJsonSupport(runtime);
        this.generator = new KnowledgeGenerator(aiSupport);
    }

    /**
     * 执行完整的项目知识库生成流程。
     *
     * <p>流程：扫描仓库 → 生成草稿（AI/确定性） → 渲染到 staging → 校验 → 发布或标记待审查。
     */
    public Map<String, Object> generate(ScriptPluginContext context, Map<String, Object> values) throws IOException {
        KnowledgeRequest request = KnowledgeRequests.generate(values);
        ScanResult scan = scanner.scan(request);
        KnowledgeDraft draft = generator.generate(context, request, scan);
        String sessionId = "gen-" + UUID.randomUUID().toString().substring(0, 8);
        RenderBundle render = renderer.render(scan, draft, sessionId);
        KnowledgeValidator.MapValidation validation = validator.validate(
                render.stagingRoot(),
                validator.documentIdsByPath(render.documents())
        );

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("repoPath", request.repoPath().toString());
        result.put("workspacePath", request.repoPath().relativize(render.stagingRoot()).toString().replace('\\', '/'));
        result.put("documents", render.documents().stream().map(document -> Map.of(
                "documentId", document.documentId(),
                "title", document.title(),
                "outputPath", document.outputPath()
        )).toList());
        result.put("qualityGate", qualityGate(validation));
        result.put("warnings", draft.warnings());

        if (!validation.ok()) {
            result.put("status", "NEEDS_REVIEW");
            result.put("published", false);
            result.put("changedFiles", List.of());
            result.put("reportPath", result.get("workspacePath") + "/" + KnowledgeConstants.REPORT_FILE);
            return result;
        }

        KnowledgeRunStore store = new KnowledgeRunStore(request.repoPath());
        KnowledgeState previousState = store.loadState();
        PublishResult publish = publisher.publish(request.repoPath(), render, previousState);
        store.saveState(publish.state());

        List<String> changedFiles = new java.util.ArrayList<>(publish.changedFiles());
        changedFiles.addAll(publish.removedFiles());
        changedFiles.add(KnowledgeConstants.STATE_FILE);
        result.put("status", "SUCCESS");
        result.put("published", true);
        result.put("changedFiles", changedFiles);
        result.put("reportPath", KnowledgeConstants.REPORT_FILE);
        return result;
    }

    /**
     * 对已存在的知识库文档执行独立的质量校验。
     */
    public Map<String, Object> validate(Map<String, Object> values) throws IOException {
        Path repoPath = KnowledgeRequests.validate(values);
        KnowledgeValidator.MapValidation validation = validator.validate(repoPath);
        return qualityGate(validation);
    }

    /** 将校验结果转换为可序列化的 Map 结构，供插件返回值使用。 */
    private Map<String, Object> qualityGate(KnowledgeValidator.MapValidation validation) {
        Map<String, Object> gate = new LinkedHashMap<>();
        gate.put("ok", validation.ok());
        gate.put("issues", validation.issues().stream().map(issue -> {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("code", issue.code());
            map.put("path", issue.path());
            map.put("message", issue.message());
            map.put("documentId", issue.documentId());
            map.put("repairable", issue.repairable());
            return map;
        }).toList());
        return gate;
    }
}
