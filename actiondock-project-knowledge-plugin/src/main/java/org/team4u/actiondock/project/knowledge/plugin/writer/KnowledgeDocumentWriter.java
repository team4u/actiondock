package org.team4u.actiondock.project.knowledge.plugin.writer;

import org.team4u.actiondock.project.knowledge.plugin.domain.KnowledgeConstants;
import org.team4u.actiondock.project.knowledge.plugin.domain.MaintenanceRequest;
import org.team4u.actiondock.project.knowledge.plugin.domain.RepositoryFacts;
import org.team4u.actiondock.project.knowledge.plugin.domain.TaskResult;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class KnowledgeDocumentWriter {

    public List<String> mergeWrite(RepositoryFacts facts, MaintenanceRequest request, List<TaskResult> taskResults) throws IOException {
        List<String> changedFiles = new ArrayList<>();
        Path docs = facts.root().resolve("docs");
        Files.createDirectories(docs);

        Path entry = facts.root().resolve(KnowledgeConstants.ENTRY_PATH);
        if (!Files.exists(entry) || "init".equals(request.operation())) {
            Files.writeString(entry, entryContent(facts, taskResults), StandardCharsets.UTF_8);
            changedFiles.add(KnowledgeConstants.ENTRY_PATH);
        }

        Path overview = docs.resolve("project-knowledge-overview.md");
        Files.writeString(overview, overviewContent(facts, taskResults), StandardCharsets.UTF_8);
        changedFiles.add("docs/project-knowledge-overview.md");
        return changedFiles;
    }

    public String writeReport(RepositoryFacts facts,
                              MaintenanceRequest request,
                              List<TaskResult> taskResults,
                              List<String> changedFiles,
                              Map<String, Object> quality) throws IOException {
        String reportPath = KnowledgeConstants.reportPath(request.operation());
        String content = "# Project Knowledge " + ("init".equals(request.operation()) ? "Init" : "Update") + " Report\n\n"
                + "- Operation: `" + request.operation() + "`\n"
                + "- Repository: `" + facts.root() + "`\n"
                + "- Executor: `" + request.executor() + "`\n"
                + "- Quality gate: `" + (Boolean.TRUE.equals(quality.get("ok")) ? "PASS" : "NEEDS_REVIEW") + "`\n\n"
                + "## Task Summary\n\n"
                + taskSummary(taskResults)
                + "\n## Changed Files\n\n"
                + bulletList(changedFiles)
                + "\n## Warnings\n\n"
                + bulletList(facts.warnings())
                + "\n## Needs Review\n\n"
                + needsReview(taskResults)
                + "\n## Quality Issues\n\n"
                + issueList(quality.get("issues"));
        Files.writeString(facts.root().resolve(reportPath), content, StandardCharsets.UTF_8);
        return reportPath;
    }

    private static String entryContent(RepositoryFacts facts, List<TaskResult> taskResults) {
        return "# ActionDock Project Knowledge\n\n"
                + "## Start Here\n\n"
                + "1. `docs/project-knowledge-overview.md`\n"
                + "2. `KNOWLEDGE_INIT_REPORT.md` or `KNOWLEDGE_UPDATE_REPORT.md`\n\n"
                + "## Repository Signals\n\n"
                + bulletList(facts.detectedFiles())
                + "\n## Activated Domains\n\n"
                + bulletList(facts.activatedDomains())
                + "\n## Completed Atomic Tasks\n\n"
                + bulletList(taskResults.stream().filter(TaskResult::done).map(result -> result.taskId() + " / " + result.taskType()).toList());
    }

    private static String overviewContent(RepositoryFacts facts, List<TaskResult> taskResults) {
        return "# Project Knowledge Overview\n\n"
                + "This document is maintained by `actiondock-project-knowledge` through a code-controlled workflow. AI outputs are kept as atomic task results and merged by code.\n\n"
                + "## Evidence Entry Points\n\n"
                + bulletList(facts.detectedFiles())
                + "\n## Domains\n\n"
                + bulletList(facts.activatedDomains())
                + "\n## Completed Atomic Tasks\n\n"
                + bulletList(taskResults.stream().filter(TaskResult::done).map(result -> result.taskId() + " / " + result.taskType()).toList())
                + "\n## Review Items\n\n"
                + needsReview(taskResults);
    }

    private static String taskSummary(List<TaskResult> taskResults) {
        if (taskResults.isEmpty()) {
            return "- None\n";
        }
        StringBuilder builder = new StringBuilder();
        for (TaskResult result : taskResults) {
            builder.append("- `")
                    .append(result.taskId())
                    .append("` ")
                    .append(result.taskType())
                    .append(": ")
                    .append(result.status())
                    .append('\n');
        }
        return builder.toString();
    }

    private static String needsReview(List<TaskResult> taskResults) {
        List<String> items = taskResults.stream()
                .filter(result -> !"done".equals(result.status()))
                .map(result -> result.taskId() + ": " + result.status() + (result.parseError() == null ? "" : " (" + result.parseError() + ")"))
                .toList();
        return bulletList(items);
    }

    private static String issueList(Object value) {
        if (!(value instanceof List<?> list) || list.isEmpty()) {
            return "- None\n";
        }
        return bulletList(list.stream().map(String::valueOf).toList());
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
}
