package org.team4u.actiondock.project.knowledge.plugin;

import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 项目知识库服务。
 *
 * <p>Java 只负责编排异步任务、调用 Agent 和最终校验。知识库文件由 Agent 直接维护。
 */
public class ProjectKnowledgeService {
    private final AgentRunners agentRunners;
    private final KnowledgeValidator validator = new KnowledgeValidator();
    private final java.util.concurrent.ExecutorService executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor();

    public ProjectKnowledgeService(AiAgentRuntime runtime) {
        this.agentRunners = new AgentRunners(runtime);
    }

    /**
     * 异步初始化 OCKB 知识库。
     */
    public Map<String, Object> init(ScriptPluginContext context, Map<String, Object> values) {
        return submit(context, KnowledgeRequests.init(values));
    }

    /** 手工触发异步刷新。 */
    public Map<String, Object> refresh(ScriptPluginContext context, Map<String, Object> values) {
        return submit(context, KnowledgeRequests.refresh(values));
    }

    /** 手工触发异步资料导入。 */
    public Map<String, Object> ingest(ScriptPluginContext context, Map<String, Object> values) {
        return submit(context, KnowledgeRequests.ingest(values));
    }

    /**
     * 提交异步任务并立即返回 ACCEPTED 响应。
     * 任务在虚拟线程中执行，状态通过 {@link KnowledgeAsyncRunStore} 持久化跟踪。
     */
    private Map<String, Object> submit(ScriptPluginContext context, KnowledgeRequest request) {
        String runId = request.mode() + "-" + UUID.randomUUID().toString().substring(0, 8);
        KnowledgeAsyncRunStore asyncStore = new KnowledgeAsyncRunStore(request.repoPath());
        KnowledgeRunSnapshot snapshot = asyncStore.create(runId, request.mode());
        executor.submit(() -> {
            try {
                Map<String, Object> result = runPipeline(context, request, runId);
                if (!asyncStore.cancelled(runId)) {
                    asyncStore.success(snapshot, result);
                }
            } catch (Exception exception) {
                if (!asyncStore.cancelled(runId)) {
                    asyncStore.failed(snapshot, exception.getMessage() == null ? exception.getClass().getName() : exception.getMessage());
                }
            }
        });
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("runId", runId);
        result.put("status", "ACCEPTED");
        result.put("repoPath", request.repoPath().toString());
        return result;
    }

    /**
     * 执行薄编排流程：校验前置条件 → 调用 Agent 直接维护正式文件 → 校验正式知识库。
     */
    private Map<String, Object> runPipeline(ScriptPluginContext context, KnowledgeRequest request, String runId) throws IOException {
        if (!Files.isDirectory(request.repoPath())) {
            throw new PluginRuntimeException("repoPath must be a directory: " + request.repoPath());
        }
        if (!"init".equals(request.mode())) {
            requireInitialized(request.repoPath());
        }

        AgentTaskResult agentResult = agentRunners.resolve(request).run(context, request, task(request, runId));
        KnowledgeValidator.MapValidation validation = validator.validate(request.repoPath());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("repoPath", request.repoPath().toString());
        result.put("mode", request.mode());
        result.put("runId", runId);
        result.put("agent", agentResult.json());
        result.put("warnings", agentResult.warnings());
        result.put("qualityGate", qualityGate(validation));
        result.put("status", validation.ok() ? "SUCCESS" : "NEEDS_REVIEW");
        return result;
    }

    private void requireInitialized(Path repoPath) {
        if (!Files.exists(repoPath.resolve(KnowledgeConstants.ACTIONDOCK_ENTRY))
                || !Files.isDirectory(repoPath.resolve(KnowledgeConstants.KNOWLEDGE_BASE_ROOT))) {
            throw new PluginRuntimeException("Knowledge base is not initialized. Run init first.");
        }
    }

    private AgentTask task(KnowledgeRequest request, String runId) {
        String systemPrompt = """
                你是 ActionDock 项目知识库维护 Agent。
                你是受信任执行者，可以直接读取和修改当前仓库中的知识库文件。
                Java 插件只负责编排和最终校验；哪些文件需要新增、更新、删除，由你根据代码、现有知识库和输入自行决定。
                正式知识库只写中文 Markdown 正文，不要写 YAML frontmatter，不要写 JSON 片段，不要写 touches_tables、tags、commands 等机器字段。
                完成后只返回一个 JSON 对象，说明 status、summary、changedFiles、warnings。
                """;
        String userPrompt = switch (request.mode()) {
            case "init" -> initPrompt();
            case "refresh" -> refreshPrompt(request);
            case "ingest" -> ingestPrompt(request);
            default -> throw new PluginRuntimeException("Unsupported knowledge mode: " + request.mode());
        };
        return new AgentTask(
                runId,
                request.mode(),
                systemPrompt,
                userPrompt,
                Map.of(
                        "repoPath", request.repoPath().toString(),
                        "mode", request.mode(),
                        "changedFiles", request.changedFiles(),
                        "sources", request.sources(),
                        "evidenceFiles", request.evidenceFiles()
                )
        );
    }

    private String initPrompt() {
        return """
                任务：初始化 OCKB 项目知识库。

                请直接在仓库中创建或覆盖：
                - ACTIONDOCK.md
                - .knowledge_base/SUMMARY.md
                - .knowledge_base/00_Overview_and_Domain/overview.md
                - .knowledge_base/01_Coding_Guidelines/guidelines.md
                - .knowledge_base/02_Infra_and_Env/infra-and-env.md
                - .knowledge_base/03_Data_Models/data-models.md
                - .knowledge_base/04_Business_Flows/business-flows.md
                - .knowledge_base/05_Agent_Tools_and_CLI/agent-tools-and-cli.md
                - .knowledge_base/06_Runbooks_and_Ops/runbooks-and-ops.md

                要求：
                - 自己搜索 README、构建文件、源码入口、SQL、配置、脚本和现有文档。
                - 正文必须是中文 Markdown。
                - 每个主文档必须包含“## 证据与边界”章节。
                - SUMMARY.md 维护知识库目录。
                - ACTIONDOCK.md 作为项目知识入口，给出阅读路径。
                """;
    }

    private String refreshPrompt(KnowledgeRequest request) {
        return """
                任务：刷新已有 OCKB 项目知识库。

                changedFiles:
                %s

                请自行搜索变更文件、相关代码和现有 .knowledge_base 文档，决定哪些知识文件需要新增、更新或删除。
                你可以维护 7 大目录下的子文档，也需要同步维护 SUMMARY.md 和必要时的 ACTIONDOCK.md。
                不要等待 Java 告诉你 dirty docs；这是你的职责。
                """.formatted(request.changedFiles().isEmpty() ? "- 未提供，按当前仓库状态自行判断" : "- " + String.join("\n- ", request.changedFiles()));
    }

    private String ingestPrompt(KnowledgeRequest request) {
        return """
                任务：融合手工资料到已有 OCKB 项目知识库。

                sources:
                %s

                请读取 sources 指定的文件或目录，自行决定将资料融合到已有正文，还是在 7 大目录下新增子文档。
                可以自由改写正文以提高可读性，但正式内容必须保持中文 Markdown。
                完成后维护 SUMMARY.md 和必要时的 ACTIONDOCK.md。
                """.formatted(request.sources().isEmpty() ? "- 未提供，请根据请求上下文自行判断" : "- " + String.join("\n- ", request.sources()));
    }

    /**
     * 对已存在的知识库文档执行独立的质量校验。
     */
    public Map<String, Object> validate(Map<String, Object> values) throws IOException {
        Path repoPath = KnowledgeRequests.validate(values);
        KnowledgeValidator.MapValidation validation = validator.validate(repoPath);
        return qualityGate(validation);
    }

    /** 查询异步任务。 */
    public Map<String, Object> getRun(Map<String, Object> values) {
        Path repoPath = KnowledgeRequests.validate(values);
        String runId = String.valueOf(values.get("runId"));
        if (runId == null || runId.isBlank() || "null".equals(runId)) {
            throw new org.team4u.actiondock.plugin.api.PluginRuntimeException("runId is required");
        }
        KnowledgeRunSnapshot snapshot = new KnowledgeAsyncRunStore(repoPath).load(runId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("runId", snapshot.runId());
        result.put("mode", snapshot.mode());
        result.put("status", snapshot.status());
        result.put("repoPath", snapshot.repoPath());
        result.put("startedAt", snapshot.startedAt());
        result.put("finishedAt", snapshot.finishedAt());
        result.put("result", snapshot.result());
        result.put("errorMessage", snapshot.errorMessage());
        return result;
    }

    /**
     * 标记取消异步任务。
     * 当前实现仅将状态更新为 CANCELLED，不强杀正在运行的虚拟线程。
     */
    public Map<String, Object> cancelRun(Map<String, Object> values) {
        Path repoPath = KnowledgeRequests.validate(values);
        String runId = String.valueOf(values.get("runId"));
        if (runId == null || runId.isBlank() || "null".equals(runId)) {
            throw new org.team4u.actiondock.plugin.api.PluginRuntimeException("runId is required");
        }
        KnowledgeAsyncRunStore store = new KnowledgeAsyncRunStore(repoPath);
        KnowledgeRunSnapshot snapshot = store.load(runId);
        store.cancelled(snapshot);
        return Map.of("runId", runId, "status", "CANCELLED");
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
