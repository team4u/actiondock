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

public class ProjectKnowledgeWorkflowService {
    private final RepositoryScanner repositoryScanner = new RepositoryScanner();
    private final TaskPlanner taskPlanner = new TaskPlanner();
    private final TemplateService templateService = new TemplateService();
    private final KnowledgeDocumentWriter documentWriter = new KnowledgeDocumentWriter();
    private final KnowledgeQualityService qualityService = new KnowledgeQualityService();
    private final AtomicTaskExecutorRouter executorRouter;

    public ProjectKnowledgeWorkflowService(AiAgentRuntime aiAgentRuntime) {
        this.executorRouter = new AtomicTaskExecutorRouter(aiAgentRuntime);
    }

    public Map<String, Object> planMaintenance(Map<String, Object> values) throws IOException {
        MaintenanceRequest request = MaintenanceRequest.from(values);
        RepositoryFacts facts = repositoryScanner.scan(request);
        Map<String, Object> outline = deterministicExplorationOutline(facts);
        List<AtomicTask> tasks = taskPlanner.plan(facts, outline);
        Map<String, Object> result = basePlan(request, facts, tasks);
        result.put("status", "PLANNED");
        result.put("explorationOutline", outline);
        return result;
    }

    public Map<String, Object> runMaintenance(ScriptPluginContext context, Map<String, Object> values) throws IOException {
        MaintenanceRequest request = MaintenanceRequest.from(values);
        RepositoryFacts facts = repositoryScanner.scan(request);
        Map<String, Object> outline = deterministicExplorationOutline(facts);
        List<AtomicTask> tasks = taskPlanner.plan(facts, outline);
        Map<String, Object> plan = basePlan(request, facts, tasks);
        if (request.dryRun()) {
            plan.put("status", "PLANNED");
            plan.put("dryRun", true);
            return plan;
        }

        WorkflowRun run = new WorkflowRun(newRunId(), request);
        WorkflowStorage storage = new WorkflowStorage(facts.root());
        runNode(run, storage, "validateRepo");
        runNode(run, storage, "scanBaseline");
        runNode(run, storage, "askExplorationOutline");
        runNode(run, storage, "normalizeExploration");
        runNode(run, storage, "activateDomains");
        runNode(run, storage, "buildTaskPlan");
        storage.savePlan(plan);

        run.startNode("executeAtomicTasks");
        storage.saveCheckpoint(run);
        AtomicTaskExecutor executor = executorRouter.resolve(request.executor());
        for (AtomicTask task : tasks) {
            String template = templateService.load(task.templateName());
            TaskResult result = executor.execute(context, request, facts, task, template);
            run.addTaskResult(result);
            storage.saveTaskTrace(task, result);
            if (result.done()) {
                storage.writeTaskOutput(result);
            }
            storage.saveCheckpoint(run);
        }
        run.completeNode("executeAtomicTasks");
        storage.saveCheckpoint(run);

        run.startNode("mergeWrite");
        storage.saveCheckpoint(run);
        List<String> changedFiles = documentWriter.mergeWrite(facts, request, run.taskResults());
        run.completeNode("mergeWrite");
        storage.saveCheckpoint(run);

        run.startNode("qualityCheck");
        storage.saveCheckpoint(run);
        Map<String, Object> quality = qualityService.validate(facts.root());
        run.completeNode("qualityCheck");
        storage.saveCheckpoint(run);

        run.startNode("report");
        storage.saveCheckpoint(run);
        String reportPath = documentWriter.writeReport(facts, request, run.taskResults(), changedFiles, quality);
        changedFiles.add(reportPath);
        run.completeNode("report");
        String status = Boolean.TRUE.equals(quality.get("ok")) && run.taskResults().stream().allMatch(TaskResult::done)
                ? "SUCCESS"
                : "NEEDS_REVIEW";
        run.finish(status, reportPath, changedFiles, quality);
        storage.saveCheckpoint(run);

        Map<String, Object> output = run.toCheckpoint();
        output.put("entryPath", KnowledgeConstants.ENTRY_PATH);
        output.put("checkpointPath", storage.tempRoot().resolve(KnowledgeConstants.CHECKPOINT_FILE).toString());
        output.put("needsReviewItems", needsReview(run.taskResults(), quality));
        return output;
    }

    public Map<String, Object> getRun(Map<String, Object> values) throws IOException {
        MaintenanceRequest request = MaintenanceRequest.from(values);
        return new WorkflowStorage(request.repoPath()).getRun(stringValue(values.get("runId")));
    }

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
        result.put("activatedDomains", facts.activatedDomains());
        result.put("detectedFiles", facts.detectedFiles());
        result.put("warnings", facts.warnings());
        result.put("executor", request.executor());
        result.put("taskPlan", taskPlanner.toPlan(tasks));
        result.put("templateBindings", tasks.stream().map(task -> Map.of("taskId", task.id(), "templateName", task.templateName())).toList());
        return result;
    }

    private Map<String, Object> deterministicExplorationOutline(RepositoryFacts facts) {
        Map<String, Object> outline = new LinkedHashMap<>();
        outline.put("summary", "Deterministic exploration outline from repository scan.");
        outline.put("candidateDomains", facts.activatedDomains());
        outline.put("evidence", facts.detectedFiles());
        return outline;
    }

    private List<Object> needsReview(List<TaskResult> taskResults, Map<String, Object> quality) {
        List<Object> taskItems = taskResults.stream()
                .filter(result -> !result.done())
                .map(result -> Map.of("taskId", result.taskId(), "status", result.status(), "parseError", result.parseError()))
                .map(item -> (Object) item)
                .toList();
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
