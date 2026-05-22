package org.team4u.actiondock.project.knowledge.plugin;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.team4u.actiondock.ai.api.*;
import org.team4u.actiondock.plugin.api.PluginManifest;
import org.team4u.actiondock.plugin.api.PluginManifestLoader;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;

import static org.assertj.core.api.Assertions.assertThat;

class ActionDockProjectKnowledgeSystemPluginTest {

    private final ActionDockProjectKnowledgeSystemPlugin plugin = new ActionDockProjectKnowledgeSystemPlugin(new StubAgentRuntime(false));
    private final ActionDockProjectKnowledgeSystemPlugin failingPlugin = new ActionDockProjectKnowledgeSystemPlugin(new StubAgentRuntime(true));
    @TempDir
    Path tempDir;

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
        assertThat(Files.exists(tempDir.resolve(".knowledge_base/01_Architecture_Overview/overview.md"))).isTrue();
        assertThat(Files.exists(tempDir.resolve(".knowledge_base/04_Business_Flows/business-flow.md"))).isTrue();
        assertThat(Files.readString(tempDir.resolve(".knowledge_base/01_Architecture_Overview/overview.md"))).doesNotStartWith("---");
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
        assertThat(Files.exists(tempDir.resolve(".knowledge_base/01_Architecture_Overview/overview.md"))).isTrue();
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
    void initLogsExternalCliStartFailuresWithStackTrace() throws Exception {
        createDemoRepo(true);

        List<LogRecord> records = captureLogs(ProjectKnowledgeService.class.getName(), () -> {
            Map<String, Object> accepted = invoke("init", Map.of(
                    "repoPath", tempDir.toString(),
                    "runner", Map.of(
                            "type", "external-cli",
                            "command", List.of("actiondock-missing-ockb-agent"),
                            "envKeys", List.of("PATH"),
                            "timeoutSeconds", 5
                    )
            ));
            Map<String, Object> run = awaitRun(String.valueOf(accepted.get("runId")));

            assertThat(run.get("status")).isEqualTo("FAILED");
            assertThat(String.valueOf(run.get("errorMessage")))
                    .contains("External agent failed to start")
                    .contains("actiondock-missing-ockb-agent");
        });

        assertThat(records)
                .anySatisfy(record -> {
                    assertThat(record.getMessage()).contains("OCKB async run failed").contains("External agent failed to start");
                    assertThat(hasCause(record.getThrown(), IOException.class)).isTrue();
                });
    }

    @Test
    void initLogsWorkerRetryFailures() throws Exception {
        createDemoRepo(true);
        ActionDockProjectKnowledgeSystemPlugin workerFailingPlugin =
                new ActionDockProjectKnowledgeSystemPlugin(new StubAgentRuntime(false, true));

        List<LogRecord> records = captureLogs(ProjectKnowledgeService.class.getName(), () -> {
            @SuppressWarnings("unchecked")
            Map<String, Object> accepted = (Map<String, Object>) workerFailingPlugin.invoke("init", null, Map.of(
                    "repoPath", tempDir.toString(),
                    "aiProfile", "project-knowledge-writer"
            ));
            Map<String, Object> run = awaitRun(workerFailingPlugin, String.valueOf(accepted.get("runId")));

            assertThat(run.get("status")).isEqualTo("SUCCESS");
            @SuppressWarnings("unchecked")
            Map<String, Object> result = (Map<String, Object>) run.get("result");
            assertThat(result.get("status")).isEqualTo("NEEDS_REVIEW");
            assertThat(Files.exists(tempDir.resolve(".knowledge_base/07_Maintenance_and_Ops/ERRORS.md"))).isTrue();
        });

        assertThat(records)
                .anySatisfy(record -> {
                    assertThat(record.getMessage()).contains("OCKB worker attempt failed");
                    assertThat(hasCause(record.getThrown(), IllegalStateException.class)).isTrue();
                })
                .anySatisfy(record -> {
                    assertThat(record.getMessage()).contains("OCKB worker exhausted retries");
                    assertThat(hasCause(record.getThrown(), IllegalStateException.class)).isTrue();
                });
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

    private List<LogRecord> captureLogs(String loggerName, ThrowingRunnable action) throws Exception {
        Logger logger = Logger.getLogger(loggerName);
        Level originalLevel = logger.getLevel();
        List<LogRecord> records = new CopyOnWriteArrayList<>();
        Handler handler = new Handler() {
            @Override
            public void publish(LogRecord record) {
                records.add(record);
            }

            @Override
            public void flush() {
            }

            @Override
            public void close() {
            }
        };
        handler.setLevel(Level.ALL);
        logger.setLevel(Level.ALL);
        logger.addHandler(handler);
        try {
            action.run();
            return records;
        } finally {
            logger.removeHandler(handler);
            logger.setLevel(originalLevel);
        }
    }

    private boolean hasCause(Throwable throwable, Class<? extends Throwable> type) {
        Throwable current = throwable;
        while (current != null) {
            if (type.isInstance(current)) {
                return true;
            }
            current = current.getCause();
        }
        return false;
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
        private final boolean failWorker;
        private final List<String> taskTypes = new ArrayList<>();

        StubAgentRuntime(boolean invalid) {
            this(invalid, false);
        }

        StubAgentRuntime(boolean invalid, boolean failWorker) {
            this.invalid = invalid;
            this.failWorker = failWorker;
        }

        @Override
        public AiAgentRunSubmission submit(AiAgentRunRequest request, AiAgentRunContext context) {
            throw new UnsupportedOperationException();
        }

        @Override
        public AiAgentRunResult run(AiAgentRunRequest request, AiAgentRunContext context) {
            String taskType = String.valueOf(request.options().get("phase"));
            Object typed = request.input().get("mode");
            Object inputTaskType = request.options().get("taskType");
            if (inputTaskType != null) {
                taskType = String.valueOf(inputTaskType);
            }
            taskTypes.add(taskType);
            String text = switch (taskType) {
                case "chief-architect" -> chief();
                case "domain-planner" -> planner(request.input());
                case "specialized-worker" -> worker(request.input());
                default -> fallback(typed == null ? "" : String.valueOf(typed));
            };
            return new AiAgentRunResult("run-1", AiRunStatus.SUCCESS, Map.of("text", text), List.of(), AiUsage.empty(), null);
        }

        private String chief() {
            return """
                    {"phases":[
                      {"phase_num":0,"domains_to_activate":["Chief_Architect","Data_Model_Planner","Infra_Env_Planner","Agent_Tool_Planner"]},
                      {"phase_num":1,"domains_to_activate":["Business_Flow_Planner"]}
                    ]}
                    """;
        }

        @SuppressWarnings("unchecked")
        private String planner(Map<String, Object> input) {
            String domain = String.valueOf(input.get("domain"));
            List<Map<String, Object>> tasks = new ArrayList<>();
            switch (domain) {
                case "Chief_Architect" -> tasks.add(Map.of(
                        "action", "UPSERT",
                        "target_path", ".knowledge_base/01_Architecture_Overview/overview.md",
                        "focus_code_entity", "pom.xml",
                        "clue", "更新系统架构总览"
                ));
                case "Data_Model_Planner" -> tasks.add(Map.of(
                        "action", "UPSERT",
                        "target_path", ".knowledge_base/03_Data_Models/orders.md",
                        "focus_code_entity", "db/migration/V1__init.sql",
                        "clue", "更新 orders 表结构"
                ));
                case "Infra_Env_Planner" -> tasks.add(Map.of(
                        "action", "UPSERT",
                        "target_path", ".knowledge_base/06_Infra_and_Env/infra.md",
                        "focus_code_entity", "pom.xml",
                        "clue", "更新构建与环境信息"
                ));
                case "Agent_Tool_Planner" -> tasks.add(Map.of(
                        "action", "UPSERT",
                        "target_path", ".knowledge_base/05_Agent_Tools_and_CLI/cli.md",
                        "focus_code_entity", "README.md",
                        "clue", "沉淀 Agent 工具入口"
                ));
                case "Business_Flow_Planner" -> tasks.add(Map.of(
                        "action", "UPSERT",
                        "target_path", ".knowledge_base/04_Business_Flows/business-flow.md",
                        "focus_code_entity", "src/main/java/demo/OrderController.java",
                        "clue", "更新下单业务流程"
                ));
                default -> {
                }
            }
            return "{\"tasks\":" + toJson(tasks) + "}";
        }

        private String worker(Map<String, Object> input) {
            if (failWorker) {
                throw new IllegalStateException("worker boom");
            }
            writeKnowledge(input);
            String targetPath = String.valueOf(input.get("targetPath"));
            return """
                    {"status":"COMPLETED","target_path":"%s","changedFiles":["%s"],"warnings":[]}
                    """.formatted(targetPath, targetPath);
        }

        private String fallback(String mode) {
            return """
                    {"status":"SUCCESS","summary":"知识库已维护","changedFiles":["ACTIONDOCK.md"],"warnings":[],"mode":"%s"}
                    """.formatted(mode);
        }

        private void writeKnowledge(Map<String, Object> input) {
            Path repo = Path.of(String.valueOf(input.get("repoPath")));
            String boundary = invalid ? "" : "\n\n## 证据与边界\n\n- 依据 README 和代码入口。 [README.md]\n";
            String targetPath = String.valueOf(input.get("targetPath"));
            try {
                Files.writeString(repo.resolve("ACTIONDOCK.md"), "# Demo 项目知识库\n\n## 阅读路径\n\n- `.knowledge_base/SUMMARY.md`\n", StandardCharsets.UTF_8);
                Files.createDirectories(repo.resolve(".knowledge_base/01_Architecture_Overview"));
                Files.createDirectories(repo.resolve(".knowledge_base/02_API_Specifications"));
                Files.createDirectories(repo.resolve(".knowledge_base/03_Data_Models"));
                Files.createDirectories(repo.resolve(".knowledge_base/04_Business_Flows"));
                Files.createDirectories(repo.resolve(".knowledge_base/05_Agent_Tools_and_CLI"));
                Files.createDirectories(repo.resolve(".knowledge_base/06_Infra_and_Env"));
                Files.createDirectories(repo.resolve(".knowledge_base/07_Maintenance_and_Ops"));
                Files.writeString(repo.resolve(".knowledge_base/SUMMARY.md"), "# OCKB 全景知识库目录\n\n- [架构总览](01_Architecture_Overview/overview.md)\n", StandardCharsets.UTF_8);
                if (targetPath.endsWith("/overview.md")) {
                    write(repo, ".knowledge_base/01_Architecture_Overview/overview.md", "# 架构总览\n\n## 关键结论\n\n- 项目以 Java 为主。 [README.md]" + boundary);
                }
                if (targetPath.endsWith("/orders.md")) {
                    write(repo, ".knowledge_base/03_Data_Models/orders.md", "# 数据模型\n\n## 表职责\n\n- 当前仓库包含 orders 表。 [db/migration/V1__init.sql]" + boundary);
                }
                if (targetPath.endsWith("/business-flow.md")) {
                    write(repo, ".knowledge_base/04_Business_Flows/business-flow.md", "# 业务流程\n\n## 触发入口\n\n- 业务入口来自 OrderController。 [src/main/java/demo/OrderController.java]" + boundary);
                }
                if (targetPath.endsWith("/cli.md")) {
                    write(repo, ".knowledge_base/05_Agent_Tools_and_CLI/cli.md", "# Agent 工具与 CLI\n\n## 用途\n\n- 暂未发现项目专属 CLI。 [README.md]" + boundary);
                }
                if (targetPath.endsWith("/infra.md")) {
                    write(repo, ".knowledge_base/06_Infra_and_Env/infra.md", "# 基础设施与环境\n\n## 关键结论\n\n- 当前证据包含 Maven 配置。 [pom.xml]" + boundary);
                }
            } catch (IOException exception) {
                throw new RuntimeException(exception);
            }
        }

        private String toJson(Object value) {
            try {
                return org.team4u.actiondock.plugin.api.PluginObjectMappers.DEFAULT.writeValueAsString(value);
            } catch (Exception exception) {
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

    @FunctionalInterface
    private interface ThrowingRunnable {
        void run() throws Exception;
    }
}
