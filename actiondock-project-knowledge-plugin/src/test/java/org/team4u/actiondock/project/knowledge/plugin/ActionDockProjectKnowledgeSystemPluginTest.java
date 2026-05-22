package org.team4u.actiondock.project.knowledge.plugin;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.team4u.actiondock.ai.api.AiAgentRunContext;
import org.team4u.actiondock.ai.api.AiAgentRunRequest;
import org.team4u.actiondock.ai.api.AiAgentRunResult;
import org.team4u.actiondock.ai.api.AiAgentRunSnapshot;
import org.team4u.actiondock.ai.api.AiAgentRunSubmission;
import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.ai.api.AiRunStatus;
import org.team4u.actiondock.ai.api.AiUsage;
import org.team4u.actiondock.plugin.api.PluginManifest;
import org.team4u.actiondock.plugin.api.PluginManifestLoader;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link ActionDockProjectKnowledgeSystemPlugin} 集成测试。
 *
 * <p>验证插件的 generate 和 validate 操作在正常和异常场景下的行为。
 * 使用内存中的 StubAgentRuntime 模拟 AI 响应，无需真实 AI 后端。
 */
class ActionDockProjectKnowledgeSystemPluginTest {

    @TempDir
    Path tempDir;

    private final ActionDockProjectKnowledgeSystemPlugin plugin = new ActionDockProjectKnowledgeSystemPlugin(new StubAgentRuntime());
    private final ActionDockProjectKnowledgeSystemPlugin failingPlugin = new ActionDockProjectKnowledgeSystemPlugin(new MissingCitationStubAgentRuntime());

    /** 验证插件 manifest 正确声明了 generate 和 validate 两个公开操作。 */
    @Test
    void manifestDocumentsPublicActions() {
        PluginManifest manifest = PluginManifestLoader.load(ActionDockProjectKnowledgeSystemPlugin.class, ActionDockProjectKnowledgeSystemPlugin.PLUGIN_ID);

        assertThat(manifest.getPluginId()).isEqualTo(ActionDockProjectKnowledgeSystemPlugin.PLUGIN_ID);
        assertThat(manifest.getActions())
                .extracting("action")
                .containsExactly("generate", "validate");
    }

    /** 验证完整的 generate 流程：扫描 → AI 生成 → 渲染 → 校验通过 → 正式发布文档和状态。 */
    @Test
    void generateWritesFormalDocumentsStateAndReport() throws Exception {
        createDemoRepo(true);

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("generate", null, Map.of(
                "repoPath", tempDir.toString(),
                "aiProfile", "project-knowledge-writer"
        ));

        assertThat(result.get("status")).isEqualTo("SUCCESS");
        assertThat(result.get("published")).isEqualTo(true);
        assertThat(Files.exists(tempDir.resolve("ACTIONDOCK.md"))).isTrue();
        assertThat(Files.exists(tempDir.resolve("KNOWLEDGE_REPORT.md"))).isTrue();
        assertThat(Files.exists(tempDir.resolve(".actiondock/project-knowledge/state.json"))).isTrue();
        assertThat(Files.exists(tempDir.resolve("docs/project/overview.md"))).isTrue();
        assertThat(Files.exists(tempDir.resolve("docs/project/flows.md"))).isTrue();
        assertThat(Files.exists(tempDir.resolve("docs/project/data.md"))).isTrue();
        assertThat(((Map<String, Object>) result.get("qualityGate")).get("ok")).isEqualTo(true);
        assertThat((List<Map<String, Object>>) result.get("documents"))
                .extracting(item -> item.get("documentId"))
                .contains("overview", "flows", "data", "entry", "report");
    }

    /** 验证校验不通过时文档仅输出到 staging，不发布到仓库正式目录。 */
    @Test
    void generateDoesNotPublishFormalDocumentsWhenValidationFails() throws Exception {
        createDemoRepo(false);

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) failingPlugin.invoke("generate", null, Map.of(
                "repoPath", tempDir.toString(),
                "aiProfile", "project-knowledge-writer"
        ));

        assertThat(result.get("status")).isEqualTo("NEEDS_REVIEW");
        assertThat(result.get("published")).isEqualTo(false);
        assertThat(Files.exists(tempDir.resolve("ACTIONDOCK.md"))).isFalse();
        assertThat(Files.exists(tempDir.resolve("docs/project/overview.md"))).isFalse();
        assertThat(Files.exists(tempDir.resolve(".actiondock/project-knowledge/state.json"))).isFalse();
        assertThat(((Map<String, Object>) result.get("qualityGate")).get("ok")).isEqualTo(false);
        assertThat((String) result.get("reportPath")).contains("KNOWLEDGE_REPORT.md");
    }

    /** 验证对空仓库执行 validate 时正确报告 missing-entry 问题。 */
    @Test
    void validateReportsMissingEntryWhenNothingGenerated() throws Exception {
        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("validate", null, Map.of("repoPath", tempDir.toString()));

        assertThat(result.get("ok")).isEqualTo(false);
        assertThat((List<Map<String, Object>>) result.get("issues"))
                .extracting(item -> item.get("code"))
                .contains("missing-entry");
    }

    /** 在临时目录中创建一个包含 pom.xml、README、Controller 和 SQL migration 的演示仓库。 */
    private void createDemoRepo(boolean includeReadme) throws Exception {
        Files.writeString(tempDir.resolve("pom.xml"), "<project/>", StandardCharsets.UTF_8);
        if (includeReadme) {
            Files.writeString(tempDir.resolve("README.md"), "# Demo", StandardCharsets.UTF_8);
        }
        Files.createDirectories(tempDir.resolve("src/main/java/demo"));
        Files.writeString(tempDir.resolve("src/main/java/demo/OrderController.java"), "class OrderController {}", StandardCharsets.UTF_8);
        Files.createDirectories(tempDir.resolve("db/migration"));
        Files.writeString(tempDir.resolve("db/migration/V1__init.sql"), "create table orders(id bigint primary key);", StandardCharsets.UTF_8);
    }

    /** 模拟 AI 运行时，返回包含完整引用的合规文档 JSON。 */
    private static class StubAgentRuntime implements AiAgentRuntime {
        @Override
        public AiAgentRunSubmission submit(AiAgentRunRequest request, AiAgentRunContext context) {
            throw new UnsupportedOperationException();
        }

        @Override
        public AiAgentRunResult run(AiAgentRunRequest request, AiAgentRunContext context) {
            String text = """
                    {
                      "projectSummary": "Demo service with one flow and one SQL-backed table.",
                      "documents": [
                        {
                          "id": "overview",
                          "title": "项目总览",
                          "outputPath": "docs/project/overview.md",
                          "body": "# 项目总览\\n\\n## 关键结论\\n\\n- 项目以 Java 为主。 [README.md]\\n"
                        },
                        {
                          "id": "flows",
                          "title": "业务流程",
                          "outputPath": "docs/project/flows.md",
                          "body": "# 业务流程\\n\\n## 关键结论\\n\\n- 业务入口来自 OrderController。 [src/main/java/demo/OrderController.java]\\n"
                        },
                        {
                          "id": "data",
                          "title": "数据模型",
                          "outputPath": "docs/project/data.md",
                          "body": "# 数据模型\\n\\n## 关键结论\\n\\n- 当前仓库包含 orders 表。 [db/migration/V1__init.sql]\\n"
                        }
                      ]
                    }
                    """;
            return new AiAgentRunResult("run-1", AiRunStatus.SUCCESS, Map.of("text", text), List.of(), AiUsage.empty(), null);
        }

        @Override
        public AiAgentRunResult resume(String runId, org.team4u.actiondock.ai.api.AiAgentResumeCommand command) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void cancel(String runId) {
        }

        @Override
        public AiAgentRunSnapshot getRun(String runId) {
            throw new UnsupportedOperationException();
        }
    }

    /** 模拟 AI 运行时，故意返回缺少引用标记的文档 JSON，用于触发校验失败。 */
    private static final class MissingCitationStubAgentRuntime extends StubAgentRuntime {
        @Override
        public AiAgentRunResult run(AiAgentRunRequest request, AiAgentRunContext context) {
            String text = """
                    {
                      "projectSummary": "Demo service with one flow and one SQL-backed table.",
                      "documents": [
                        {
                          "id": "overview",
                          "title": "项目总览",
                          "outputPath": "docs/project/overview.md",
                          "body": "# 项目总览\\n\\n## 关键结论\\n\\n- 项目以 Java 为主。\\n"
                        },
                        {
                          "id": "flows",
                          "title": "业务流程",
                          "outputPath": "docs/project/flows.md",
                          "body": "# 业务流程\\n\\n## 关键结论\\n\\n- 业务入口来自 OrderController。\\n"
                        },
                        {
                          "id": "data",
                          "title": "数据模型",
                          "outputPath": "docs/project/data.md",
                          "body": "# 数据模型\\n\\n## 关键结论\\n\\n- 当前仓库包含 orders 表。\\n"
                        }
                      ]
                    }
                    """;
            return new AiAgentRunResult("run-1", AiRunStatus.SUCCESS, Map.of("text", text), List.of(), AiUsage.empty(), null);
        }
    }
}
