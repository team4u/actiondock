package org.team4u.actiondock.project.knowledge.plugin.domain;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 知识库维护工作流运行状态。
 *
 * <p>跟踪一次知识库维护工作流的完整生命周期，包括工作流节点进度、原子任务结果和最终产出。
 * 支持通过检查点机制持久化运行状态，便于故障恢复。
 *
 * @author ActionDock
 */
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

    /**
     * 创建工作流运行实例。
     *
     * @param runId    运行唯一标识
     * @param request  关联的维护请求
     */
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

    /**
     * 标记工作流节点开始执行。
     *
     * @param node 节点名称
     */
    public void startNode(String node) {
        currentNode = node;
        nodeStatuses.put(node, "running");
    }

    /**
     * 标记工作流节点执行完成。
     *
     * @param node 节点名称
     */
    public void completeNode(String node) {
        currentNode = node;
        nodeStatuses.put(node, "done");
        if (!completedNodes.contains(node)) {
            completedNodes.add(node);
        }
    }

    /**
     * 完成工作流运行，设置最终状态和产出。
     *
     * @param status            最终状态（{@code SUCCESS} / {@code NEEDS_REVIEW}）
     * @param reportPath        报告文件路径
     * @param changedFiles      本次运行变更的文件列表
     * @param qualityGateResult 质量检查结果
     */
    public void finish(String status, String reportPath, List<String> changedFiles, Map<String, Object> qualityGateResult) {
        this.status = status;
        this.reportPath = reportPath;
        this.changedFiles = changedFiles == null ? List.of() : List.copyOf(changedFiles);
        this.qualityGateResult = qualityGateResult == null ? Map.of() : Map.copyOf(qualityGateResult);
        this.finishedAt = Instant.now();
    }

    /**
     * 添加原子任务执行结果。
     *
     * @param taskResult 任务结果
     */
    public void addTaskResult(TaskResult taskResult) {
        taskResults.add(taskResult);
    }

    /**
     * 获取所有原子任务执行结果的不可变副本。
     *
     * @return 任务结果列表
     */
    public List<TaskResult> taskResults() {
        return List.copyOf(taskResults);
    }

    /**
     * 将当前运行状态序列化为检查点 Map。
     *
     * <p>包含运行 ID、状态、工作流节点进度、任务结果统计和变更文件等信息。
     *
     * @return 检查点数据
     */
    public Map<String, Object> toCheckpoint() {
        Map<String, Object> checkpoint = new LinkedHashMap<>();
        // 基本信息：运行 ID、状态和操作类型
        checkpoint.put("runId", runId);
        checkpoint.put("status", status);
        checkpoint.put("operation", request.operation());
        checkpoint.put("workflowNodes", KnowledgeConstants.WORKFLOW_NODES);
        // 工作流节点进度
        checkpoint.put("currentNode", currentNode);
        checkpoint.put("completedNodes", completedNodes);
        checkpoint.put("nodeStatuses", nodeStatuses);
        // 时间戳
        checkpoint.put("startedAt", startedAt.toString());
        checkpoint.put("finishedAt", finishedAt == null ? null : finishedAt.toString());
        // 请求上下文
        checkpoint.put("repoPath", request.repoPath().toString());
        checkpoint.put("executor", request.executor());
        // 产出信息
        checkpoint.put("reportPath", reportPath);
        checkpoint.put("changedFiles", changedFiles);
        checkpoint.put("qualityGateResult", qualityGateResult);
        // 原子任务结果明细和统计
        checkpoint.put("taskResults", taskResults.stream().map(WorkflowRun::taskResultMap).toList());
        checkpoint.put("taskStats", taskStats());
        return checkpoint;
    }

    // 按状态分组统计任务数量，用于快速了解执行概貌
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
