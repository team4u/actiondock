package org.team4u.actiondock.project.knowledge.plugin.domain;

import java.util.List;

public final class KnowledgeConstants {
    public static final String ENTRY_PATH = "ACTIONDOCK.md";
    public static final String INIT_REPORT_PATH = "KNOWLEDGE_INIT_REPORT.md";
    public static final String REFRESH_REPORT_PATH = "KNOWLEDGE_UPDATE_REPORT.md";
    public static final String TEMP_ROOT = ".knowledge-tmp";
    public static final String CHECKPOINT_FILE = "checkpoint.json";
    public static final String LATEST_RUN_FILE = "latest-run.json";
    public static final List<String> WORKFLOW_NODES = List.of(
            "validateRepo",
            "scanBaseline",
            "askExplorationOutline",
            "normalizeExploration",
            "activateDomains",
            "buildTaskPlan",
            "executeAtomicTasks",
            "mergeWrite",
            "qualityCheck",
            "report"
    );

    private KnowledgeConstants() {
    }

    public static String reportPath(String operation) {
        return "init".equals(operation) ? INIT_REPORT_PATH : REFRESH_REPORT_PATH;
    }
}
