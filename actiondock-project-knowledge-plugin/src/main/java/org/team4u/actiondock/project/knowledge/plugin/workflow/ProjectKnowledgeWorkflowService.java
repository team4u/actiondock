package org.team4u.actiondock.project.knowledge.plugin.workflow;

import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;
import org.team4u.actiondock.project.knowledge.plugin.domain.AtomicTask;
import org.team4u.actiondock.project.knowledge.plugin.domain.KnowledgeConstants;
import org.team4u.actiondock.project.knowledge.plugin.domain.MaintenanceRequest;
import org.team4u.actiondock.project.knowledge.plugin.domain.RepositoryFacts;
import org.team4u.actiondock.project.knowledge.plugin.domain.TaskResult;
import org.team4u.actiondock.project.knowledge.plugin.domain.WorkflowRun;
import org.team4u.actiondock.project.knowledge.plugin.executor.AtomicTaskExecutor;
import org.team4u.actiondock.project.knowledge.plugin.executor.AtomicTaskExecutorRouter;
import org.team4u.actiondock.project.knowledge.plugin.quality.KnowledgeQualityService;
import org.team4u.actiondock.project.knowledge.plugin.storage.WorkflowStorage;
import org.team4u.actiondock.project.knowledge.plugin.template.TemplateService;
import org.team4u.actiondock.project.knowledge.plugin.writer.KnowledgeDocumentWriter;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 项目知识库维护工作流服务。
 *
 * <p>知识库维护的核心编排器，负责协调仓库扫描、任务规划、原子任务执行、文档合并写入和质量检查等环节。
 * 工作流执行过程通过检查点机制持久化，支持断点恢复。
 *
 * <p>工作流节点执行顺序：
 * <ol>
 *   <li>validateRepo — 校验仓库路径有效性</li>
 *   <li>collectInventory — 递归收集轻量证据</li>
 *   <li>classifyDomains — 使用 AI 判定项目形态、域和任务分组</li>
 *   <li>buildTaskPlan — 构建原子任务计划</li>
 *   <li>executeAtomicTasks — 逐个执行原子任务</li>
 *   <li>mergeWrite — 合并写入知识文档</li>
 *   <li>qualityCheck — 执行质量检查</li>
 *   <li>report — 生成维护报告</li>
 * </ol>
 *
 * @author ActionDock
 */
public class ProjectKnowledgeWorkflowService {
    private final TemplateService templateService = new TemplateService();
    private final RepositoryScanner repositoryScanner = new RepositoryScanner(templateService);
    private final TaskPlanner taskPlanner = new TaskPlanner();
    private final KnowledgeDocumentWriter documentWriter = new KnowledgeDocumentWriter();
    private final KnowledgeQualityService qualityService = new KnowledgeQualityService();
    private final AtomicTaskExecutorRouter executorRouter;

    /**
     * 创建工作流服务。
     *
     * @param aiAgentRuntime AI Agent 运行时，为 {@code null} 时使用本地回退策略
     */
    public ProjectKnowledgeWorkflowService(AiAgentRuntime aiAgentRuntime) {
        this.executorRouter = new AtomicTaskExecutorRouter(aiAgentRuntime);
    }

    /**
     * 规划知识库维护任务（仅规划不执行）。
     *
     * <p>扫描仓库、生成探索大纲、构建原子任务计划，返回完整的规划结果。
     *
     * @param values 维护请求参数
     * @return 包含任务计划、激活域、检测文件等信息的规划结果
     * @throws IOException 仓库扫描失败
     */
    public Map<String, Object> planMaintenance(Map<String, Object> values) throws IOException {
        MaintenanceRequest request = MaintenanceRequest.from(values);
        AtomicTaskExecutor executor = executorRouter.resolve(request.executor());
        RepositoryFacts facts = repositoryScanner.scan(null, request, executor);
        List<AtomicTask> tasks = taskPlanner.plan(facts);
        Map<String, Object> result = basePlan(request, facts, tasks);
        result.put("status", "PLANNED");
        return result;
    }

    /**
     * 执行完整的知识库维护工作流。
     *
     * <p>按顺序执行所有工作流节点，包括原子任务执行、文档合并、质量检查和报告生成。
     * 每个关键节点都会保存检查点。若为 dryRun 模式，仅返回规划结果不实际执行。
     *
     * @param context 脚本插件上下文
     * @param values  维护请求参数
     * @return 包含运行状态、变更文件、质量结果和待审核项的工作流输出
     * @throws IOException 仓库扫描或文件写入失败
     */
    public Map<String, Object> runMaintenance(ScriptPluginContext context, Map<String, Object> values) throws IOException {
        MaintenanceRequest request = MaintenanceRequest.from(values);
        AtomicTaskExecutor executor = executorRouter.resolve(request.executor());
        RepositoryFacts facts = repositoryScanner.scan(context, request, executor);
        List<AtomicTask> tasks = taskPlanner.plan(facts);
        Map<String, Object> plan = basePlan(request, facts, tasks);

        // dryRun 模式：仅返回规划结果，不实际执行
        if (request.dryRun()) {
            plan.put("status", "PLANNED");
            plan.put("dryRun", true);
            return plan;
        }

        WorkflowRun run = new WorkflowRun(newRunId(), request);
        WorkflowStorage storage = new WorkflowStorage(facts.root());

        // 阶段一：仓库校验与扫描规划
        runNode(run, storage, "validateRepo");
        runNode(run, storage, "collectInventory");
        runNode(run, storage, "classifyDomains");
        runNode(run, storage, "buildTaskPlan");
        storage.savePlan(plan);

        // 阶段二：逐个执行原子任务（涉及 AI/外部调用，耗时较长）
        run.startNode("executeAtomicTasks");
        storage.saveCheckpoint(run);
        for (AtomicTask task : tasks) {
            String template = templateService.load(task.templateName());
            TaskResult result = executor.execute(context, request, facts, task, template);
            run.addTaskResult(result);
            storage.saveTaskTrace(task, result);
            // 仅写入执行成功的任务产出
            if (result.done()) {
                storage.writeTaskOutput(result);
            }
            storage.saveCheckpoint(run);
        }
        run.completeNode("executeAtomicTasks");
        storage.saveCheckpoint(run);

        // 阶段三：合并写入正式知识文档
        run.startNode("mergeWrite");
        storage.saveCheckpoint(run);
        List<String> changedFiles = documentWriter.mergeWrite(facts, request, run.taskResults());
        run.completeNode("mergeWrite");
        storage.saveCheckpoint(run);

        // 阶段四：质量检查
        run.startNode("qualityCheck");
        storage.saveCheckpoint(run);
        Map<String, Object> quality = qualityService.validate(facts.root());
        run.completeNode("qualityCheck");
        storage.saveCheckpoint(run);

        // 阶段五：生成维护报告并确定最终状态
        run.startNode("report");
        storage.saveCheckpoint(run);
        String reportPath = documentWriter.writeReport(facts, request, run.taskResults(), changedFiles, quality);
        changedFiles.add(reportPath);
        run.completeNode("report");

        // 所有任务成功且质量检查通过 → SUCCESS，否则 → NEEDS_REVIEW
        String status = Boolean.TRUE.equals(quality.get("ok")) && run.taskResults().stream().allMatch(TaskResult::done)
                ? "SUCCESS"
                : "NEEDS_REVIEW";
        run.finish(status, reportPath, changedFiles, quality);
        storage.saveCheckpoint(run);

        // 组装最终输出：检查点数据 + 入口路径 + 待审核项
        Map<String, Object> output = run.toCheckpoint();
        output.put("entryPath", KnowledgeConstants.ENTRY_PATH);
        output.put("checkpointPath", storage.tempRoot().resolve(KnowledgeConstants.CHECKPOINT_FILE).toString());
        output.put("needsReviewItems", needsReview(run.taskResults(), quality));
        return output;
    }

    /**
     * 查询历史工作流运行记录。
     *
     * @param values 查询参数，支持 {@code runId} 和 {@code repoPath}
     * @return 运行记录数据
     * @throws IOException 文件读取失败
     */
    public Map<String, Object> getRun(Map<String, Object> values) throws IOException {
        MaintenanceRequest request = MaintenanceRequest.from(values);
        return new WorkflowStorage(request.repoPath()).getRun(stringValue(values.get("runId")));
    }

    /**
     * 校验指定仓库的知识库质量。
     *
     * @param values 包含 {@code repoPath} 的参数 Map
     * @return 质量校验结果
     * @throws IOException 文件读取失败
     */
    public Map<String, Object> validateKnowledge(Map<String, Object> values) throws IOException {
        MaintenanceRequest request = MaintenanceRequest.from(values);
        return qualityService.validate(request.repoPath());
    }

    private void runNode(WorkflowRun run, WorkflowStorage storage, String node) {
        run.startNode(node);
        storage.saveCheckpoint(run);
        run.completeNode(node);
        storage.saveCheckpoint(run);
    }

    private Map<String, Object> basePlan(MaintenanceRequest request, RepositoryFacts facts, List<AtomicTask> tasks) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("runId", newRunId());
        result.put("operation", request.operation());
        result.put("repoPath", facts.root().toString());
        result.put("entryPath", KnowledgeConstants.ENTRY_PATH);
        result.put("reportPath", KnowledgeConstants.reportPath(request.operation()));
        result.put("tempRoot", KnowledgeConstants.TEMP_ROOT);
        result.put("checkpointPath", KnowledgeConstants.TEMP_ROOT + "/" + KnowledgeConstants.CHECKPOINT_FILE);
        result.put("workflowNodes", KnowledgeConstants.WORKFLOW_NODES);
        result.put("scanSummary", facts.scanSummary());
        result.put("projectShape", facts.projectShape());
        result.put("detectedStacks", facts.detectedStacks());
        result.put("modules", facts.modules());
        result.put("domains", facts.domains());
        result.put("inventorySignals", facts.inventorySignals());
        result.put("scanWarnings", facts.scanWarnings());
        result.put("executor", request.executor());
        result.put("taskPlan", taskPlanner.toPlan(tasks));
        result.put("templateBindings", tasks.stream().map(task -> Map.of("taskId", task.id(), "templateName", task.templateName())).toList());
        return result;
    }

    // 合并未通过的任务和质检问题为统一的待审核列表
    private List<Object> needsReview(List<TaskResult> taskResults, Map<String, Object> quality) {
        // 收集所有非 done 状态的任务
        List<Object> taskItems = taskResults.stream()
                .filter(result -> !result.done())
                .map(result -> Map.of("taskId", result.taskId(), "status", result.status(), "parseError", result.parseError()))
                .map(item -> (Object) item)
                .toList();
        // 合并质检发现的问题
        Object issues = quality.get("issues");
        if (!(issues instanceof List<?> qualityItems) || qualityItems.isEmpty()) {
            return taskItems;
        }
        java.util.ArrayList<Object> merged = new java.util.ArrayList<>(taskItems);
        merged.addAll(qualityItems);
        return merged;
    }

    private static String newRunId() {
        return "pkw-" + UUID.randomUUID();
    }

    private static String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
