package org.team4u.actiondock.project.knowledge.plugin;

import org.team4u.actiondock.ai.api.AiAgentRunContext;
import org.team4u.actiondock.ai.api.AiAgentRunRequest;
import org.team4u.actiondock.ai.api.AiAgentRunResult;
import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.ai.api.AiCallerType;
import org.team4u.actiondock.ai.api.AiMessage;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Stream;

public class ActionDockProjectKnowledgeSystemPlugin implements ActionDockPlugin {
    public static final String PLUGIN_ID = "actiondock-project-knowledge";

    private static final String ENTRY_PATH = "ACTIONDOCK.md";
    private static final String INIT_REPORT_PATH = "KNOWLEDGE_INIT_REPORT.md";
    private static final String REFRESH_REPORT_PATH = "KNOWLEDGE_UPDATE_REPORT.md";
    private static final String TEMP_ROOT = ".knowledge-tmp";
    private static final String CHECKPOINT_FILE = "checkpoint.json";
    private static final String LATEST_RUN_FILE = "latest-run.json";
    private static final List<String> PHASES = List.of(
            "validate-repo",
            "discover",
            "activate-domains",
            "draft",
            "merge-write",
            "quality-check"
    );

    private final AiAgentRuntime aiAgentRuntime;

    public ActionDockProjectKnowledgeSystemPlugin() {
        this(null);
    }

    public ActionDockProjectKnowledgeSystemPlugin(AiAgentRuntime aiAgentRuntime) {
        this.aiAgentRuntime = aiAgentRuntime;
    }

    @Override
    public String id() {
        return PLUGIN_ID;
    }

    @Override
    public Object invoke(String action, ScriptPluginContext context, Map<String, Object> args) {
        Map<String, Object> values = args == null ? Map.of() : args;
        try {
            return switch (action) {
                case "planMaintenance" -> planMaintenance(values);
                case "runMaintenance" -> runMaintenance(context, values);
                case "getRun" -> getRun(values);
                case "validateKnowledge" -> validateKnowledge(values);
                default -> throw new IllegalArgumentException("Unsupported project knowledge action: " + action);
            };
        } catch (PluginRuntimeException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new PluginRuntimeException("Project knowledge action failed: " + exception.getMessage(), exception);
        }
    }

    private Map<String, Object> planMaintenance(Map<String, Object> values) throws IOException {
        MaintenanceRequest request = request(values);
        RepositoryFacts facts = inspect(request.repoPath());
        return buildPlan(request, facts, newRunId());
    }

    private Map<String, Object> runMaintenance(ScriptPluginContext context, Map<String, Object> values) throws IOException, InterruptedException {
        MaintenanceRequest request = request(values);
        RepositoryFacts facts = inspect(request.repoPath());
        String runId = newRunId();
        Map<String, Object> plan = buildPlan(request, facts, runId);
        if (request.dryRun()) {
            plan.put("status", "PLANNED");
            plan.put("dryRun", true);
            return plan;
        }

        Path tempRoot = facts.root().resolve(TEMP_ROOT);
        Files.createDirectories(tempRoot);

        Map<String, Object> checkpoint = new LinkedHashMap<>();
        checkpoint.put("runId", runId);
        checkpoint.put("status", "RUNNING");
        checkpoint.put("operation", request.operation());
        checkpoint.put("phaseOrder", PHASES);
        checkpoint.put("completedPhases", new ArrayList<>());
        checkpoint.put("startedAt", Instant.now().toString());
        checkpoint.put("repoPath", facts.root().toString());
        checkpoint.put("executor", request.executor());
        checkpoint.put("activatedDomains", facts.activatedDomains());
        writeJson(tempRoot.resolve(CHECKPOINT_FILE), checkpoint);

        List<String> changedFiles = new ArrayList<>();
        Map<String, Object> executorResult = runExecutor(context, request, facts, plan);
        writeBaselineKnowledge(facts, request, executorResult, changedFiles);

        Map<String, Object> quality = validateKnowledge(Map.of("repoPath", facts.root().toString()));
        String reportPath = writeReport(facts, request, plan, executorResult, quality, changedFiles);
        changedFiles.add(reportPath);

        checkpoint.put("status", Boolean.TRUE.equals(quality.get("ok")) ? "SUCCESS" : "NEEDS_REVIEW");
        checkpoint.put("completedPhases", PHASES);
        checkpoint.put("finishedAt", Instant.now().toString());
        checkpoint.put("reportPath", reportPath);
        checkpoint.put("changedFiles", changedFiles);
        checkpoint.put("qualityGateResult", quality);
        writeJson(tempRoot.resolve(CHECKPOINT_FILE), checkpoint);
        writeJson(tempRoot.resolve(LATEST_RUN_FILE), checkpoint);

        Map<String, Object> result = new LinkedHashMap<>(checkpoint);
        result.put("entryPath", ENTRY_PATH);
        result.put("checkpointPath", tempRoot.resolve(CHECKPOINT_FILE).toString());
        result.put("needsReviewItems", quality.get("issues"));
        return result;
    }

    private Map<String, Object> getRun(Map<String, Object> values) throws IOException {
        Path root = repoPath(values);
        String runId = optionalString(values.get("runId"));
        Path tempRoot = root.resolve(TEMP_ROOT);
        Path path = tempRoot.resolve(CHECKPOINT_FILE);
        if (runId == null || runId.isBlank()) {
            path = tempRoot.resolve(LATEST_RUN_FILE);
            if (!Files.exists(path)) {
                path = tempRoot.resolve(CHECKPOINT_FILE);
            }
        }
        if (!Files.exists(path)) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("runId", runId);
            result.put("status", "NOT_FOUND");
            result.put("checkpointPath", path.toString());
            return result;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("runId", runId);
        result.put("status", "FOUND");
        result.put("checkpointPath", path.toString());
        result.put("content", Files.readString(path, StandardCharsets.UTF_8));
        return result;
    }

    private Map<String, Object> validateKnowledge(Map<String, Object> values) throws IOException {
        Path root = repoPath(values);
        List<Map<String, Object>> issues = new ArrayList<>();
        Path entry = root.resolve(ENTRY_PATH);
        if (!Files.exists(entry)) {
            issues.add(issue("missing-entry", ENTRY_PATH, "ACTIONDOCK.md is missing."));
        } else {
            String content = Files.readString(entry, StandardCharsets.UTF_8);
            if (content.isBlank()) {
                issues.add(issue("empty-entry", ENTRY_PATH, "ACTIONDOCK.md is empty."));
            }
            if (content.contains(TEMP_ROOT)) {
                issues.add(issue("temp-reference", ENTRY_PATH, "Formal entry references .knowledge-tmp."));
            }
            if (containsPlaceholder(content)) {
                issues.add(issue("placeholder", ENTRY_PATH, "Formal entry contains placeholder text."));
            }
        }

        Path docs = root.resolve("docs");
        if (Files.isDirectory(docs)) {
            try (Stream<Path> stream = Files.walk(docs)) {
                stream.filter(Files::isRegularFile)
                        .filter(path -> path.getFileName().toString().endsWith(".md"))
                        .forEach(path -> checkMarkdown(root, path, issues));
            }
        }

        return Map.of(
                "ok", issues.isEmpty(),
                "issues", issues
        );
    }

    private Map<String, Object> buildPlan(MaintenanceRequest request, RepositoryFacts facts, String runId) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("runId", runId);
        result.put("status", "PLANNED");
        result.put("operation", request.operation());
        result.put("repoPath", facts.root().toString());
        result.put("entryPath", ENTRY_PATH);
        result.put("reportPath", reportPath(request.operation()));
        result.put("tempRoot", TEMP_ROOT);
        result.put("checkpointPath", TEMP_ROOT + "/" + CHECKPOINT_FILE);
        result.put("phaseOrder", PHASES);
        result.put("activatedDomains", facts.activatedDomains());
        result.put("detectedFiles", facts.detectedFiles());
        result.put("expectedOutputs", List.of(ENTRY_PATH, "docs/", reportPath(request.operation())));
        result.put("warnings", facts.warnings());
        result.put("executor", request.executor());
        result.put("agentProfile", request.agentProfile());
        result.put("externalCommandProfile", request.externalCommandProfile());
        return result;
    }

    private Map<String, Object> runExecutor(ScriptPluginContext context,
                                            MaintenanceRequest request,
                                            RepositoryFacts facts,
                                            Map<String, Object> plan) throws IOException, InterruptedException {
        return switch (request.executor()) {
            case "builtin-agent", "auto" -> runBuiltinAgent(context, request, facts, plan);
            case "external-cli" -> runExternalCommand(request, facts, plan);
            default -> Map.of("executor", request.executor(), "status", "SKIPPED", "message", "Unsupported executor; baseline knowledge was generated without AI.");
        };
    }

    private Map<String, Object> runBuiltinAgent(ScriptPluginContext context,
                                                MaintenanceRequest request,
                                                RepositoryFacts facts,
                                                Map<String, Object> plan) {
        if (aiAgentRuntime == null || request.agentProfile() == null || request.agentProfile().isBlank()) {
            return Map.of(
                    "executor", "builtin-agent",
                    "status", "SKIPPED",
                    "message", "No aiAgentRuntime or agentProfile configured; baseline knowledge was generated."
            );
        }
        AiAgentRunRequest agentRequest = new AiAgentRunRequest(
                request.agentProfile(),
                List.of(
                        new AiMessage("system", "Maintain an evidence-bound ActionDock project knowledge base."),
                        new AiMessage("user", "Use the provided maintenance plan and repository facts to produce concise project knowledge updates.")
                ),
                Map.of("plan", plan, "detectedFiles", facts.detectedFiles(), "activatedDomains", facts.activatedDomains()),
                Map.of("repoPath", facts.root().toString())
        );
        AiAgentRunContext agentContext = new AiAgentRunContext(
                AiCallerType.SCRIPT,
                context == null ? null : context.getScriptId(),
                context == null ? null : context.getExecutionId(),
                null,
                Map.of("pluginId", PLUGIN_ID)
        );
        AiAgentRunResult agentResult = aiAgentRuntime.run(agentRequest, agentContext);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("executor", "builtin-agent");
        result.put("status", agentResult.status() == null ? "UNKNOWN" : agentResult.status().name());
        result.put("runId", agentResult.runId());
        result.put("data", agentResult.data() == null ? Map.of() : agentResult.data());
        result.put("errorMessage", agentResult.errorMessage());
        return result;
    }

    private Map<String, Object> runExternalCommand(MaintenanceRequest request,
                                                   RepositoryFacts facts,
                                                   Map<String, Object> plan) throws IOException, InterruptedException {
        String profile = request.externalCommandProfile();
        if (profile == null || profile.isBlank()) {
            return Map.of(
                    "executor", "external-cli",
                    "status", "SKIPPED",
                    "message", "externalCommandProfile is required for external-cli executor."
            );
        }
        List<String> command = switch (profile) {
            case "claude-code" -> List.of("claude", "-p", "Maintain ActionDock project knowledge for " + facts.root() + ". Plan: " + plan);
            default -> List.of();
        };
        if (command.isEmpty()) {
            return Map.of(
                    "executor", "external-cli",
                    "status", "SKIPPED",
                    "profile", profile,
                    "message", "External command profile is not allowed."
            );
        }
        Process process = new ProcessBuilder(command)
                .directory(facts.root().toFile())
                .redirectErrorStream(true)
                .start();
        boolean finished = process.waitFor(120, java.util.concurrent.TimeUnit.SECONDS);
        if (!finished) {
            process.destroyForcibly();
            return Map.of("executor", "external-cli", "status", "TIMEOUT", "profile", profile);
        }
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        return Map.of(
                "executor", "external-cli",
                "status", process.exitValue() == 0 ? "SUCCESS" : "FAILED",
                "profile", profile,
                "exitCode", process.exitValue(),
                "output", truncate(output, 8000)
        );
    }

    private void writeBaselineKnowledge(RepositoryFacts facts,
                                        MaintenanceRequest request,
                                        Map<String, Object> executorResult,
                                        List<String> changedFiles) throws IOException {
        Path docs = facts.root().resolve("docs");
        Files.createDirectories(docs);

        Path entry = facts.root().resolve(ENTRY_PATH);
        if (!Files.exists(entry) || request.operation().equals("init")) {
            Files.writeString(entry, entryContent(facts), StandardCharsets.UTF_8);
            changedFiles.add(ENTRY_PATH);
        }

        Path overview = docs.resolve("project-knowledge-overview.md");
        Files.writeString(overview, overviewContent(facts, request, executorResult), StandardCharsets.UTF_8);
        changedFiles.add("docs/project-knowledge-overview.md");
    }

    private String writeReport(RepositoryFacts facts,
                               MaintenanceRequest request,
                               Map<String, Object> plan,
                               Map<String, Object> executorResult,
                               Map<String, Object> quality,
                               List<String> changedFiles) throws IOException {
        String reportPath = reportPath(request.operation());
        String content = "# Project Knowledge " + ("init".equals(request.operation()) ? "Init" : "Update") + " Report\n\n"
                + "- Run ID: `" + plan.get("runId") + "`\n"
                + "- Operation: `" + request.operation() + "`\n"
                + "- Repository: `" + facts.root() + "`\n"
                + "- Executor: `" + request.executor() + "`\n"
                + "- Executor status: `" + executorResult.getOrDefault("status", "UNKNOWN") + "`\n"
                + "- Quality gate: `" + (Boolean.TRUE.equals(quality.get("ok")) ? "PASS" : "NEEDS_REVIEW") + "`\n\n"
                + "## Activated Domains\n\n"
                + bulletList(facts.activatedDomains())
                + "\n## Changed Files\n\n"
                + bulletList(changedFiles)
                + "\n## Warnings\n\n"
                + bulletList(facts.warnings())
                + "\n## Quality Issues\n\n"
                + issueList(quality.get("issues"))
                + "\n";
        Files.writeString(facts.root().resolve(reportPath), content, StandardCharsets.UTF_8);
        return reportPath;
    }

    private RepositoryFacts inspect(Path root) throws IOException {
        if (!Files.exists(root)) {
            throw new PluginRuntimeException("repoPath does not exist: " + root);
        }
        if (!Files.isDirectory(root)) {
            throw new PluginRuntimeException("repoPath must be a directory: " + root);
        }
        List<String> detected = new ArrayList<>();
        List<String> domains = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        detect(root, detected, "pom.xml", "java-maven");
        detect(root, detected, "package.json", "node");
        detect(root, detected, "README.md", "readme");
        detect(root, detected, ENTRY_PATH, "actiondock-entry");
        detect(root, detected, "src/main/resources/db/migration", "database");

        if (detected.stream().anyMatch(item -> item.endsWith("pom.xml"))) {
            domains.add("java");
        }
        if (detected.stream().anyMatch(item -> item.endsWith("package.json"))) {
            domains.add("frontend");
        }
        if (detected.stream().anyMatch(item -> item.contains("db/migration"))) {
            domains.add("data");
        }
        domains.add("actiondock");
        domains.add("common");
        if (!Files.exists(root.resolve(ENTRY_PATH))) {
            warnings.add("ACTIONDOCK.md is missing and will be initialized.");
        }
        return new RepositoryFacts(root, detected, distinct(domains), warnings);
    }

    private static void detect(Path root, List<String> detected, String relativePath, String label) {
        Path path = root.resolve(relativePath);
        if (Files.exists(path)) {
            detected.add(label + ":" + relativePath);
        }
    }

    private MaintenanceRequest request(Map<String, Object> values) throws IOException {
        Path root = repoPath(values);
        String operation = optionalString(values.get("operation"));
        if (operation == null || operation.isBlank()) {
            operation = Files.exists(root.resolve(ENTRY_PATH)) ? "refresh" : "init";
        }
        operation = operation.toLowerCase(Locale.ROOT);
        if (!operation.equals("init") && !operation.equals("refresh")) {
            throw new PluginRuntimeException("operation must be init or refresh");
        }
        String executor = optionalString(values.get("executor"));
        if (executor == null || executor.isBlank()) {
            executor = "builtin-agent";
        }
        return new MaintenanceRequest(
                root,
                operation,
                booleanValue(values.get("resume"), true),
                booleanValue(values.get("dryRun"), false),
                executor,
                optionalString(values.get("agentProfile")),
                optionalString(values.get("externalCommandProfile")),
                stringList(values.get("evidenceFiles"))
        );
    }

    private static Path repoPath(Map<String, Object> values) {
        String repoPath = optionalString(values.get("repoPath"));
        if (repoPath == null || repoPath.isBlank()) {
            throw new PluginRuntimeException("repoPath is required");
        }
        try {
            return Paths.get(repoPath).toAbsolutePath().normalize();
        } catch (InvalidPathException exception) {
            throw new PluginRuntimeException("Invalid repoPath: " + repoPath, exception);
        }
    }

    private static void checkMarkdown(Path root, Path path, List<Map<String, Object>> issues) {
        try {
            String relative = root.relativize(path).toString();
            String content = Files.readString(path, StandardCharsets.UTF_8);
            if (content.contains(TEMP_ROOT)) {
                issues.add(issue("temp-reference", relative, "Formal document references .knowledge-tmp."));
            }
            if (containsPlaceholder(content)) {
                issues.add(issue("placeholder", relative, "Formal document contains placeholder text."));
            }
        } catch (IOException exception) {
            issues.add(issue("read-failed", path.toString(), exception.getMessage()));
        }
    }

    private static boolean containsPlaceholder(String content) {
        String lower = content.toLowerCase(Locale.ROOT);
        return lower.contains("todo") || lower.contains("[todo") || lower.contains("placeholder");
    }

    private static Map<String, Object> issue(String code, String path, String message) {
        return Map.of("code", code, "path", path, "message", message);
    }

    private static String entryContent(RepositoryFacts facts) {
        return "# ActionDock Project Knowledge\n\n"
                + "## Start Here\n\n"
                + "1. `docs/project-knowledge-overview.md`\n"
                + "2. `KNOWLEDGE_INIT_REPORT.md` or `KNOWLEDGE_UPDATE_REPORT.md`\n\n"
                + "## Repository Signals\n\n"
                + bulletList(facts.detectedFiles())
                + "\n## Activated Domains\n\n"
                + bulletList(facts.activatedDomains());
    }

    private static String overviewContent(RepositoryFacts facts,
                                          MaintenanceRequest request,
                                          Map<String, Object> executorResult) {
        return "# Project Knowledge Overview\n\n"
                + "This document is maintained by `actiondock-project-knowledge` and records the current evidence entry points for this repository.\n\n"
                + "## Current Operation\n\n"
                + "- Operation: `" + request.operation() + "`\n"
                + "- Executor: `" + request.executor() + "`\n"
                + "- Executor status: `" + executorResult.getOrDefault("status", "SKIPPED") + "`\n\n"
                + "## Evidence Entry Points\n\n"
                + bulletList(facts.detectedFiles())
                + "\n## Domains\n\n"
                + bulletList(facts.activatedDomains())
                + "\n## Evidence Gaps\n\n"
                + bulletList(facts.warnings());
    }

    private static String reportPath(String operation) {
        return "init".equals(operation) ? INIT_REPORT_PATH : REFRESH_REPORT_PATH;
    }

    private static String bulletList(List<String> items) {
        if (items == null || items.isEmpty()) {
            return "- None\n";
        }
        StringBuilder builder = new StringBuilder();
        for (String item : items) {
            builder.append("- ").append(item).append('\n');
        }
        return builder.toString();
    }

    @SuppressWarnings("unchecked")
    private static String issueList(Object value) {
        if (!(value instanceof List<?> list) || list.isEmpty()) {
            return "- None\n";
        }
        List<String> items = list.stream()
                .filter(Map.class::isInstance)
                .map(item -> (Map<String, Object>) item)
                .map(item -> item.get("path") + ": " + item.get("message"))
                .toList();
        return bulletList(items);
    }

    private static void writeJson(Path path, Map<String, Object> values) throws IOException {
        Files.writeString(path, toJson(values), StandardCharsets.UTF_8);
    }

    private static String toJson(Object value) {
        if (value == null) {
            return "null";
        }
        if (value instanceof String string) {
            return "\"" + escapeJson(string) + "\"";
        }
        if (value instanceof Number || value instanceof Boolean) {
            return String.valueOf(value);
        }
        if (value instanceof Map<?, ?> map) {
            List<String> entries = new ArrayList<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                entries.add(toJson(String.valueOf(entry.getKey())) + ":" + toJson(entry.getValue()));
            }
            return "{" + String.join(",", entries) + "}";
        }
        if (value instanceof Iterable<?> iterable) {
            List<String> items = new ArrayList<>();
            for (Object item : iterable) {
                items.add(toJson(item));
            }
            return "[" + String.join(",", items) + "]";
        }
        return toJson(String.valueOf(value));
    }

    private static String escapeJson(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r");
    }

    private static String newRunId() {
        return "pkw-" + UUID.randomUUID();
    }

    private static String truncate(String value, int maxLength) {
        if (value == null || value.length() <= maxLength) {
            return value;
        }
        return value.substring(0, maxLength) + "\n[truncated]";
    }

    private static String optionalString(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static boolean booleanValue(Object value, boolean defaultValue) {
        return value instanceof Boolean bool ? bool : defaultValue;
    }

    private static List<String> stringList(Object value) {
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        return list.stream()
                .filter(Objects::nonNull)
                .map(String::valueOf)
                .toList();
    }

    private static List<String> distinct(List<String> values) {
        return values.stream().distinct().toList();
    }

    private record MaintenanceRequest(Path repoPath,
                                      String operation,
                                      boolean resume,
                                      boolean dryRun,
                                      String executor,
                                      String agentProfile,
                                      String externalCommandProfile,
                                      List<String> evidenceFiles) {
    }

    private record RepositoryFacts(Path root,
                                   List<String> detectedFiles,
                                   List<String> activatedDomains,
                                   List<String> warnings) {
    }
}
