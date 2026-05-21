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
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.project.knowledge.plugin.domain.AtomicTask;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ActionDockProjectKnowledgeSystemPluginTest {

    @TempDir
    Path tempDir;

    private final ActionDockProjectKnowledgeSystemPlugin plugin = new ActionDockProjectKnowledgeSystemPlugin(new StubAgentRuntime());

    @Test
    void manifestDocumentsPublicActions() {
        PluginManifest manifest = PluginManifestLoader.load(ActionDockProjectKnowledgeSystemPlugin.class, ActionDockProjectKnowledgeSystemPlugin.PLUGIN_ID);

        assertThat(manifest.getPluginId()).isEqualTo(ActionDockProjectKnowledgeSystemPlugin.PLUGIN_ID);
        assertThat(manifest.getActions())
                .extracting("action")
                .containsExactly("planMaintenance", "runMaintenance", "getRun", "validateKnowledge");
    }

    @Test
    void planMaintenanceReturnsWorkflowAndAtomicTasks() throws Exception {
        Files.writeString(tempDir.resolve("pom.xml"), "<project/>", StandardCharsets.UTF_8);

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("planMaintenance", null, Map.of(
                "repoPath", tempDir.toString(),
                "agentProfile", "project-knowledge-scanner"
        ));

        assertThat(result.get("status")).isEqualTo("PLANNED");
        assertThat((List<String>) result.get("workflowNodes")).contains("collectInventory", "classifyDomains", "executeAtomicTasks");
        assertThat((Map<String, Object>) result.get("taskPlan")).containsEntry("taskCount", 2);
        assertThat(result.get("projectShape")).isEqualTo("single-service");
        assertThat((List<String>) result.get("detectedStacks")).contains("java");
        assertThat((List<Map<String, Object>>) result.get("domains"))
                .extracting("id")
                .contains("code-structure", "dev-test");
    }

    @Test
    void runMaintenanceWritesEntryReportCheckpointAndAtomicOutputs() throws Exception {
        Files.writeString(tempDir.resolve("pom.xml"), "<project/>", StandardCharsets.UTF_8);

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("runMaintenance", null, Map.of(
                "repoPath", tempDir.toString(),
                "operation", "init",
                "agentProfile", "project-knowledge-scanner"
        ));

        assertThat(result.get("status")).isEqualTo("SUCCESS");
        assertThat(Files.exists(tempDir.resolve("ACTIONDOCK.md"))).isTrue();
        assertThat(Files.exists(tempDir.resolve("docs/project-knowledge-overview.md"))).isTrue();
        assertThat(Files.exists(tempDir.resolve("KNOWLEDGE_INIT_REPORT.md"))).isTrue();
        assertThat(Files.exists(tempDir.resolve(".actiondock/.knowledge-tmp/checkpoint.json"))).isTrue();
        assertThat(Files.exists(tempDir.resolve(".actiondock/.knowledge-tmp/domain-drafts/common.json"))).isTrue();
        assertThat(Files.readString(tempDir.resolve(".actiondock/.knowledge-tmp/checkpoint.json"))).contains("executeAtomicTasks", "taskStats");
    }

    @Test
    void planMaintenanceFailsWithoutAgentProfile() {
        assertThatThrownBy(() -> plugin.invoke("planMaintenance", null, Map.of("repoPath", tempDir.toString())))
                .isInstanceOf(PluginRuntimeException.class)
                .hasMessageContaining("agentProfile is required");
    }

    @Test
    void validateKnowledgeReportsMissingEntry() {
        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("validateKnowledge", null, Map.of("repoPath", tempDir.toString()));

        assertThat(result.get("ok")).isEqualTo(false);
        assertThat((List<Map<String, Object>>) result.get("issues"))
                .extracting("code")
                .contains("missing-entry");
    }

    @Test
    void getRunReturnsLatestCheckpoint() {
        @SuppressWarnings("unchecked")
        Map<String, Object> run = (Map<String, Object>) plugin.invoke("runMaintenance", null, Map.of(
                "repoPath", tempDir.toString(),
                "agentProfile", "project-knowledge-scanner"
        ));

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("getRun", null, Map.of("repoPath", tempDir.toString()));

        assertThat(result.get("status")).isEqualTo("FOUND");
        assertThat(result.get("content")).asString().contains((String) run.get("runId"));
    }

    private static final class StubAgentRuntime implements AiAgentRuntime {
        @Override
        public AiAgentRunSubmission submit(AiAgentRunRequest request, AiAgentRunContext context) {
            throw new UnsupportedOperationException();
        }

        @Override
        public AiAgentRunResult run(AiAgentRunRequest request, AiAgentRunContext context) {
            String phase = request.options() == null ? null : String.valueOf(request.options().get("scanPhase"));
            String text = "repository-classification".equals(phase) ? scanJson() : taskJson(request);
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

        private static String scanJson() {
            return """
                    {
                      "scanSummary": "Single Java service with Maven build and local development docs.",
                      "projectShape": "single-service",
                      "detectedStacks": ["java"],
                      "modules": [
                        {
                          "path": ".",
                          "role": "root",
                          "stacks": ["java"],
                          "evidence": ["pom.xml"]
                        }
                      ],
                      "domains": [
                        {
                          "id": "code-structure",
                          "priority": "high",
                          "reason": "Root pom.xml indicates a Java service.",
                          "evidence": ["pom.xml"]
                        },
                        {
                          "id": "dev-test",
                          "priority": "medium",
                          "reason": "Maven build implies local development and test workflows.",
                          "evidence": ["pom.xml"]
                        }
                      ],
                      "taskGroups": [
                        {
                          "id": "common",
                          "title": "Draft code structure and developer onboarding",
                          "templateName": "template-common.md",
                          "domains": ["code-structure", "dev-test"],
                          "evidence": ["pom.xml"]
                        },
                        {
                          "id": "agent",
                          "title": "Draft agent operating notes",
                          "templateName": "template-agent.md",
                          "domains": ["dev-test"],
                          "evidence": ["pom.xml"]
                        }
                      ],
                      "scanWarnings": []
                    }
                    """;
        }

        private static String taskJson(AiAgentRunRequest request) {
            Object taskValue = request.input() == null ? null : request.input().get("task");
            String taskType = taskValue instanceof AtomicTask task ? task.taskType() : "unknown";
            return """
                    {
                      "title": "%s",
                      "summary": "Generated by stub agent runtime.",
                      "evidence": ["pom.xml"],
                      "uncertainty": [],
                      "draftMarkdown": "# %s\\n\\nStub output."
                    }
                    """.formatted(taskType, taskType);
        }
    }
}
