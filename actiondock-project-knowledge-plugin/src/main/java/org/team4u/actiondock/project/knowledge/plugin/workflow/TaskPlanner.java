package org.team4u.actiondock.project.knowledge.plugin.workflow;

import org.team4u.actiondock.project.knowledge.plugin.domain.AtomicTask;
import org.team4u.actiondock.project.knowledge.plugin.domain.RepositoryFacts;

import java.util.ArrayList;
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
     * 根据仓库事实和探索大纲规划原子任务列表。
     *
     * <p>始终生成探索大纲摘要任务，按需生成数据索引和代码概览任务。
     *
     * @param facts            仓库扫描结果
     * @param explorationOutline 探索大纲
     * @return 原子任务列表
     */
    public List<AtomicTask> plan(RepositoryFacts facts, Map<String, Object> explorationOutline) {
        List<AtomicTask> tasks = new ArrayList<>();

        // 基础任务：探索大纲摘要（始终生成）
        tasks.add(new AtomicTask(
                "outline-1",
                "draftExplorationOutline",
                "Summarize code exploration outline",
                "template-common.md",
                ".knowledge-tmp/domain-drafts/exploration-outline.json",
                facts.detectedFiles(),
                Map.of("detectedFiles", facts.detectedFiles(), "outline", explorationOutline)
        ));

        // 按需任务：数据域存在时添加数据模型索引
        if (facts.activatedDomains().contains("data")) {
            tasks.add(new AtomicTask(
                    "data-1",
                    "draftDataIndex",
                    "Draft data model index",
                    "template-data.md",
                    ".knowledge-tmp/domain-drafts/data-index.json",
                    facts.detectedFiles(),
                    Map.of("detectedFiles", facts.detectedFiles())
            ));
        }

        // 按需任务：Java 或前端域存在时添加代码结构概览
        if (facts.activatedDomains().contains("java") || facts.activatedDomains().contains("frontend")) {
            tasks.add(new AtomicTask(
                    "code-1",
                    "draftCodeOverview",
                    "Draft code structure overview",
                    "template-common.md",
                    ".knowledge-tmp/domain-drafts/code-overview.json",
                    facts.detectedFiles(),
                    Map.of("detectedFiles", facts.detectedFiles())
            ));
        }

        return tasks;
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
}
