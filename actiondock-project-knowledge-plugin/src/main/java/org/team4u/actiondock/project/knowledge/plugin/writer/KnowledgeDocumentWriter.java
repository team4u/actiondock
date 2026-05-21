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

/**
 * 知识库文档写入器。
 *
 * <p>负责将原子任务执行结果合并写入正式知识文档，包括入口文件 ACTIONDOCK.md、
 * 项目概览文档和维护报告。所有文档输出使用 Markdown 格式。
 *
 * @author ActionDock
 */
public class KnowledgeDocumentWriter {

    /**
     * 将原子任务结果合并写入知识文档。
     *
     * <p>生成或更新入口文件 ACTIONDOCK.md 和项目概览文档 {@code docs/project-knowledge-overview.md}。
     *
     * @param facts       仓库扫描结果
     * @param request     维护请求
     * @param taskResults 全部原子任务执行结果
     * @return 变更的文件路径列表
     * @throws IOException 文件写入失败
     */
    public List<String> mergeWrite(RepositoryFacts facts, MaintenanceRequest request, List<TaskResult> taskResults) throws IOException {
        List<String> changedFiles = new ArrayList<>();
        Path docs = facts.root().resolve("docs");
        Files.createDirectories(docs);

        // 初始化操作或入口文件不存在时生成/覆盖 ACTIONDOCK.md
        Path entry = facts.root().resolve(KnowledgeConstants.ENTRY_PATH);
        if (!Files.exists(entry) || "init".equals(request.operation())) {
            Files.writeString(entry, entryContent(facts, taskResults), StandardCharsets.UTF_8);
            changedFiles.add(KnowledgeConstants.ENTRY_PATH);
        }

        // 概览文档每次运行都更新
        Path overview = docs.resolve("project-knowledge-overview.md");
        Files.writeString(overview, overviewContent(facts, taskResults), StandardCharsets.UTF_8);
        changedFiles.add("docs/project-knowledge-overview.md");
        return changedFiles;
    }

    /**
     * 生成并写入知识库维护报告。
     *
     * <p>报告包含操作类型、执行器信息、任务摘要、变更文件、警告和待审核项等。
     *
     * @param facts        仓库扫描结果
     * @param request      维护请求
     * @param taskResults  全部原子任务执行结果
     * @param changedFiles 变更文件列表
     * @param quality      质量检查结果
     * @return 报告文件路径
     * @throws IOException 文件写入失败
     */
    public String writeReport(RepositoryFacts facts,
                              MaintenanceRequest request,
                              List<TaskResult> taskResults,
                              List<String> changedFiles,
                              Map<String, Object> quality) throws IOException {
        String reportPath = KnowledgeConstants.reportPath(request.operation());

        // 拼接 Markdown 格式的维护报告
        String content = "# Project Knowledge " + ("init".equals(request.operation()) ? "Init" : "Update") + " Report\n\n"
                + "- Operation: `" + request.operation() + "`\n"
                + "- Repository: `" + facts.root() + "`\n"
                + "- Scan summary: " + facts.scanSummary() + "\n"
                + "- Project shape: `" + facts.projectShape() + "`\n"
                + "- Detected stacks: " + facts.detectedStacks() + "\n"
                + "- Executor: `" + request.executor() + "`\n"
                + "- Quality gate: `" + (Boolean.TRUE.equals(quality.get("ok")) ? "PASS" : "NEEDS_REVIEW") + "`\n\n"
                + "## Task Summary\n\n"
                + taskSummary(taskResults)
                + "\n## Changed Files\n\n"
                + bulletList(changedFiles)
                + "\n## Scan Warnings\n\n"
                + bulletList(facts.scanWarnings())
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
                + "## Scan Summary\n\n"
                + facts.scanSummary() + "\n\n"
                + "## Project Shape\n\n"
                + "- `" + facts.projectShape() + "`\n"
                + "\n## Detected Stacks\n\n"
                + bulletList(facts.detectedStacks())
                + "\n## Inventory Signals\n\n"
                + bulletList(facts.inventorySignals())
                + "\n## Domains\n\n"
                + bulletList(facts.domains().stream().map(domain -> domain.id() + " / " + domain.priority()).toList())
                + "\n## Completed Atomic Tasks\n\n"
                + bulletList(taskResults.stream().filter(TaskResult::done).map(result -> result.taskId() + " / " + result.taskType()).toList());
    }

    private static String overviewContent(RepositoryFacts facts, List<TaskResult> taskResults) {
        return "# Project Knowledge Overview\n\n"
                + "This document is maintained by `actiondock-project-knowledge` through a code-controlled workflow. AI outputs are kept as atomic task results and merged by code.\n\n"
                + "## Scan Summary\n\n"
                + facts.scanSummary() + "\n\n"
                + "## Project Shape\n\n"
                + "- `" + facts.projectShape() + "`\n"
                + "\n## Modules\n\n"
                + bulletList(facts.modules().stream().map(module -> module.path() + " / " + module.role() + " / " + module.stacks()).toList())
                + "\n## Domains\n\n"
                + bulletList(facts.domains().stream().map(domain -> domain.id() + " / " + domain.priority() + " / " + domain.reason()).toList())
                + "\n## Inventory Signals\n\n"
                + bulletList(facts.inventorySignals())
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
