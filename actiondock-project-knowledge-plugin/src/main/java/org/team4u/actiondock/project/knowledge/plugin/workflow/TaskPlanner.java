package org.team4u.actiondock.project.knowledge.plugin.workflow;

import org.team4u.actiondock.project.knowledge.plugin.domain.AtomicTask;
import org.team4u.actiondock.project.knowledge.plugin.domain.RepositoryFacts;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class TaskPlanner {

    public List<AtomicTask> plan(RepositoryFacts facts, Map<String, Object> explorationOutline) {
        List<AtomicTask> tasks = new ArrayList<>();
        tasks.add(new AtomicTask(
                "outline-1",
                "draftExplorationOutline",
                "Summarize code exploration outline",
                "template-common.md",
                ".knowledge-tmp/domain-drafts/exploration-outline.json",
                facts.detectedFiles(),
                Map.of("detectedFiles", facts.detectedFiles(), "outline", explorationOutline)
        ));
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
