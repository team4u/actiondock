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

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ActionDockProjectKnowledgeSystemPluginTest {

    @TempDir
    Path tempDir;

    private final ActionDockProjectKnowledgeSystemPlugin plugin = new ActionDockProjectKnowledgeSystemPlugin(new StubAgentRuntime(false));
    private final ActionDockProjectKnowledgeSystemPlugin failingPlugin = new ActionDockProjectKnowledgeSystemPlugin(new StubAgentRuntime(true));

    @Test
    void manifestDocumentsPublicActions() {
        PluginManifest manifest = PluginManifestLoader.load(ActionDockProjectKnowledgeSystemPlugin.class, ActionDockProjectKnowledgeSystemPlugin.PLUGIN_ID);

        assertThat(manifest.getPluginId()).isEqualTo(ActionDockProjectKnowledgeSystemPlugin.PLUGIN_ID);
        assertThat(manifest.getActions())
                .extracting("action")
                .containsExactly("init", "refresh", "ingest", "validate", "getRun", "cancelRun");
    }

    @Test
    void initLetsAgentWriteFormalDocumentsAndDoesNotCreateStateOrReport() throws Exception {
        createDemoRepo(true);

        Map<String, Object> accepted = invoke("init", Map.of(
                "repoPath", tempDir.toString(),
                "aiProfile", "project-knowledge-writer"
        ));
        Map<String, Object> run = awaitRun(String.valueOf(accepted.get("runId")));
        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) run.get("result");

        assertThat(run.get("status")).isEqualTo("SUCCESS");
        assertThat(result.get("status")).isEqualTo("SUCCESS");
        assertThat(Files.exists(tempDir.resolve("ACTIONDOCK.md"))).isTrue();
        assertThat(Files.exists(tempDir.resolve("KNOWLEDGE_REPORT.md"))).isFalse();
        assertThat(Files.exists(tempDir.resolve(".actiondock/project-knowledge/state.json"))).isFalse();
        assertThat(Files.exists(tempDir.resolve(".knowledge_base/SUMMARY.md"))).isTrue();
        assertThat(Files.exists(tempDir.resolve(".knowledge_base/00_Overview_and_Domain/overview.md"))).isTrue();
        assertThat(Files.exists(tempDir.resolve(".knowledge_base/04_Business_Flows/business-flows.md"))).isTrue();
        assertThat(Files.readString(tempDir.resolve(".knowledge_base/00_Overview_and_Domain/overview.md"))).doesNotStartWith("---");
        assertThat(((Map<String, Object>) result.get("qualityGate")).get("ok")).isEqualTo(true);
    }

    @Test
    void initKeepsAgentFilesWhenValidationFails() throws Exception {
        createDemoRepo(false);

        Map<String, Object> accepted = failingPluginInvoke("init", Map.of(
                "repoPath", tempDir.toString(),
                "aiProfile", "project-knowledge-writer"
        ));
        Map<String, Object> run = awaitRun(failingPlugin, String.valueOf(accepted.get("runId")));
        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) run.get("result");

        assertThat(run.get("status")).isEqualTo("SUCCESS");
        assertThat(result.get("status")).isEqualTo("NEEDS_REVIEW");
        assertThat(Files.exists(tempDir.resolve("ACTIONDOCK.md"))).isTrue();
        assertThat(Files.exists(tempDir.resolve(".knowledge_base/00_Overview_and_Domain/overview.md"))).isTrue();
        assertThat(Files.exists(tempDir.resolve(".actiondock/project-knowledge/state.json"))).isFalse();
        assertThat(((Map<String, Object>) result.get("qualityGate")).get("ok")).isEqualTo(false);
    }

    @Test
    void refreshFailsWhenKnowledgeBaseIsNotInitialized() throws Exception {
        createDemoRepo(true);

        Map<String, Object> accepted = invoke("refresh", Map.of(
                "repoPath", tempDir.toString(),
                "aiProfile", "project-knowledge-writer",
                "changedFiles", List.of("src/main/java/demo/OrderController.java")
        ));
        Map<String, Object> run = awaitRun(String.valueOf(accepted.get("runId")));

        assertThat(run.get("status")).isEqualTo("FAILED");
        assertThat(run.get("errorMessage")).isEqualTo("Knowledge base is not initialized. Run init first.");
    }

    @Test
    void validateReportsMissingEntryWhenNothingGenerated() {
        Map<String, Object> result = invoke("validate", Map.of("repoPath", tempDir.toString()));

        assertThat(result.get("ok")).isEqualTo(false);
        assertThat((List<Map<String, Object>>) result.get("issues"))
                .extracting(item -> item.get("code"))
                .contains("missing-entry");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> invoke(String action, Map<String, Object> args) {
        return (Map<String, Object>) plugin.invoke(action, null, args);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> failingPluginInvoke(String action, Map<String, Object> args) {
        return (Map<String, Object>) failingPlugin.invoke(action, null, args);
    }

    private Map<String, Object> awaitRun(String runId) throws Exception {
        return awaitRun(plugin, runId);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> awaitRun(ActionDockProjectKnowledgeSystemPlugin target, String runId) throws Exception {
        for (int i = 0; i < 50; i++) {
            Map<String, Object> run = (Map<String, Object>) target.invoke("getRun", null, Map.of("repoPath", tempDir.toString(), "runId", runId));
            if (!"RUNNING".equals(run.get("status"))) {
                return run;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Run did not finish: " + runId);
    }

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

    private static class StubAgentRuntime implements AiAgentRuntime {
        private final boolean invalid;

        StubAgentRuntime(boolean invalid) {
            this.invalid = invalid;
        }

        @Override
        public AiAgentRunSubmission submit(AiAgentRunRequest request, AiAgentRunContext context) {
            throw new UnsupportedOperationException();
        }

        @Override
        public AiAgentRunResult run(AiAgentRunRequest request, AiAgentRunContext context) {
            writeKnowledge(request.input());
            String text = "{\"status\":\"SUCCESS\",\"summary\":\"知识库已维护\",\"changedFiles\":[\"ACTIONDOCK.md\"],\"warnings\":[]}";
            return new AiAgentRunResult("run-1", AiRunStatus.SUCCESS, Map.of("text", text), List.of(), AiUsage.empty(), null);
        }

        private void writeKnowledge(Map<String, Object> input) {
            Path repo = Path.of(String.valueOf(input.get("repoPath")));
            String boundary = invalid ? "" : "\n\n## 证据与边界\n\n- 依据 README 和代码入口。 [README.md]\n";
            try {
                Files.writeString(repo.resolve("ACTIONDOCK.md"), "# Demo 项目知识库\n\n## 阅读路径\n\n- `.knowledge_base/SUMMARY.md`\n", StandardCharsets.UTF_8);
                Files.createDirectories(repo.resolve(".knowledge_base/00_Overview_and_Domain"));
                Files.createDirectories(repo.resolve(".knowledge_base/01_Coding_Guidelines"));
                Files.createDirectories(repo.resolve(".knowledge_base/02_Infra_and_Env"));
                Files.createDirectories(repo.resolve(".knowledge_base/03_Data_Models"));
                Files.createDirectories(repo.resolve(".knowledge_base/04_Business_Flows"));
                Files.createDirectories(repo.resolve(".knowledge_base/05_Agent_Tools_and_CLI"));
                Files.createDirectories(repo.resolve(".knowledge_base/06_Runbooks_and_Ops"));
                Files.writeString(repo.resolve(".knowledge_base/SUMMARY.md"), "# OCKB 全景知识库目录\n\n- [架构总览](00_Overview_and_Domain/overview.md)\n", StandardCharsets.UTF_8);
                write(repo, ".knowledge_base/00_Overview_and_Domain/overview.md", "# 架构总览与领域\n\n## 关键结论\n\n- 项目以 Java 为主。 [README.md]" + boundary);
                write(repo, ".knowledge_base/01_Coding_Guidelines/guidelines.md", "# 编码规范\n\n## 关键结论\n\n- 暂未发现项目专属规范。 [README.md]" + boundary);
                write(repo, ".knowledge_base/02_Infra_and_Env/infra-and-env.md", "# 基础设施与环境\n\n## 关键结论\n\n- 当前证据包含 Maven 配置。 [pom.xml]" + boundary);
                write(repo, ".knowledge_base/03_Data_Models/data-models.md", "# 数据模型\n\n## 表职责\n\n- 当前仓库包含 orders 表。 [db/migration/V1__init.sql]" + boundary);
                write(repo, ".knowledge_base/04_Business_Flows/business-flows.md", "# 业务流程\n\n## 触发入口\n\n- 业务入口来自 OrderController。 [src/main/java/demo/OrderController.java]" + boundary);
                write(repo, ".knowledge_base/05_Agent_Tools_and_CLI/agent-tools-and-cli.md", "# Agent 工具与 CLI\n\n## 用途\n\n- 暂未发现项目专属 CLI。 [README.md]" + boundary);
                write(repo, ".knowledge_base/06_Runbooks_and_Ops/runbooks-and-ops.md", "# Runbook 与运维\n\n## 适用场景\n\n- 暂未沉淀真实故障场景。 [README.md]" + boundary);
            } catch (IOException exception) {
                throw new RuntimeException(exception);
            }
        }

        private void write(Path repo, String rel, String content) throws IOException {
            Files.writeString(repo.resolve(rel), content, StandardCharsets.UTF_8);
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
}
