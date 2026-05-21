package org.team4u.actiondock.project.knowledge.plugin.workflow;

import org.team4u.actiondock.project.knowledge.plugin.domain.AtomicTask;
import org.team4u.actiondock.project.knowledge.plugin.domain.KnowledgeConstants;
import org.team4u.actiondock.project.knowledge.plugin.domain.PlannedTaskGroup;
import org.team4u.actiondock.project.knowledge.plugin.domain.RepositoryFacts;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 原子任务规划器。
 *
 * <p>根据仓库扫描结果和探索大纲，规划需要执行的原子任务列表。
 * 任务列表根据激活的知识域动态调整：数据域添加数据模型索引任务，代码域添加代码结构概览任务。
 *
 * @author ActionDock
 */
public class TaskPlanner {

    /**
     * 根据仓库事实规划原子任务列表。
     *
     * @param facts 仓库扫描结果
     * @return 原子任务列表
     */
    public List<AtomicTask> plan(RepositoryFacts facts) {
        return facts.taskGroups().stream()
                .map(group -> toTask(facts, group))
                .toList();
    }

    /**
     * 将原子任务列表序列化为可输出的计划 Map。
     *
     * @param tasks 原子任务列表
     * @return 包含任务数量和任务详情的计划 Map
     */
    public Map<String, Object> toPlan(List<AtomicTask> tasks) {
        Map<String, Object> plan = new LinkedHashMap<>();
        plan.put("taskCount", tasks.size());
        plan.put("tasks", tasks.stream().map(this::taskMap).toList());
        return plan;
    }

    private Map<String, Object> taskMap(AtomicTask task) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", task.id());
        map.put("taskType", task.taskType());
        map.put("title", task.title());
        map.put("templateName", task.templateName());
        map.put("outputPath", task.outputPath());
        map.put("evidence", task.evidence());
        return map;
    }

    private AtomicTask toTask(RepositoryFacts facts, PlannedTaskGroup group) {
        return new AtomicTask(
                group.id(),
                taskType(group.id()),
                group.title(),
                group.templateName(),
                outputPath(group.id()),
                group.evidence().isEmpty() ? facts.inventorySignals() : group.evidence(),
                Map.of(
                        "scanSummary", facts.scanSummary(),
                        "projectShape", facts.projectShape(),
                        "detectedStacks", facts.detectedStacks(),
                        "domains", facts.domains(),
                        "groupDomains", group.domains(),
                        "modules", facts.modules(),
                        "inventorySignals", facts.inventorySignals()
                )
        );
    }

    private String taskType(String groupId) {
        return switch (groupId) {
            case "common" -> "draftCommonKnowledge";
            case "flows" -> "draftFlowKnowledge";
            case "data" -> "draftDataKnowledge";
            case "integrations" -> "draftIntegrationKnowledge";
            case "ops" -> "draftOpsKnowledge";
            case "diagnosis" -> "draftDiagnosisKnowledge";
            case "security" -> "draftSecurityKnowledge";
            case "agent" -> "draftAgentKnowledge";
            default -> throw new IllegalArgumentException("Unsupported task group id: " + groupId);
        };
    }

    private String outputPath(String groupId) {
        if (!KnowledgeConstants.SUPPORTED_TASK_GROUP_IDS.contains(groupId)) {
            throw new IllegalArgumentException("Unsupported task group id: " + groupId);
        }
        return KnowledgeConstants.TEMP_ROOT + "/domain-drafts/" + groupId + ".json";
    }
}
