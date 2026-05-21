package org.team4u.actiondock.project.knowledge.plugin.domain;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class WorkflowRun {
    private final String runId;
    private final MaintenanceRequest request;
    private final List<String> completedNodes = new ArrayList<>();
    private final Map<String, String> nodeStatuses = new LinkedHashMap<>();
    private final List<TaskResult> taskResults = new ArrayList<>();
    private String status = "RUNNING";
    private String currentNode;
    private String reportPath;
    private List<String> changedFiles = new ArrayList<>();
    private Map<String, Object> qualityGateResult = Map.of();
    private final Instant startedAt = Instant.now();
    private Instant finishedAt;

    public WorkflowRun(String runId, MaintenanceRequest request) {
        this.runId = runId;
        this.request = request;
    }

    public String runId() {
        return runId;
    }

    public MaintenanceRequest request() {
        return request;
    }

    public void startNode(String node) {
        currentNode = node;
        nodeStatuses.put(node, "running");
    }

    public void completeNode(String node) {
        currentNode = node;
        nodeStatuses.put(node, "done");
        if (!completedNodes.contains(node)) {
            completedNodes.add(node);
        }
    }

    public void finish(String status, String reportPath, List<String> changedFiles, Map<String, Object> qualityGateResult) {
        this.status = status;
        this.reportPath = reportPath;
        this.changedFiles = changedFiles == null ? List.of() : List.copyOf(changedFiles);
        this.qualityGateResult = qualityGateResult == null ? Map.of() : Map.copyOf(qualityGateResult);
        this.finishedAt = Instant.now();
    }

    public void addTaskResult(TaskResult taskResult) {
        taskResults.add(taskResult);
    }

    public List<TaskResult> taskResults() {
        return List.copyOf(taskResults);
    }

    public Map<String, Object> toCheckpoint() {
        Map<String, Object> checkpoint = new LinkedHashMap<>();
        checkpoint.put("runId", runId);
        checkpoint.put("status", status);
        checkpoint.put("operation", request.operation());
        checkpoint.put("workflowNodes", KnowledgeConstants.WORKFLOW_NODES);
        checkpoint.put("currentNode", currentNode);
        checkpoint.put("completedNodes", completedNodes);
        checkpoint.put("nodeStatuses", nodeStatuses);
        checkpoint.put("startedAt", startedAt.toString());
        checkpoint.put("finishedAt", finishedAt == null ? null : finishedAt.toString());
        checkpoint.put("repoPath", request.repoPath().toString());
        checkpoint.put("executor", request.executor());
        checkpoint.put("reportPath", reportPath);
        checkpoint.put("changedFiles", changedFiles);
        checkpoint.put("qualityGateResult", qualityGateResult);
        checkpoint.put("taskResults", taskResults.stream().map(WorkflowRun::taskResultMap).toList());
        checkpoint.put("taskStats", taskStats());
        return checkpoint;
    }

    private Map<String, Long> taskStats() {
        Map<String, Long> stats = new LinkedHashMap<>();
        for (TaskResult result : taskResults) {
            stats.put(result.status(), stats.getOrDefault(result.status(), 0L) + 1);
        }
        return stats;
    }

    private static Map<String, Object> taskResultMap(TaskResult result) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("taskId", result.taskId());
        map.put("taskType", result.taskType());
        map.put("status", result.status());
        map.put("outputPath", result.outputPath());
        map.put("parseError", result.parseError());
        return map;
    }
}
