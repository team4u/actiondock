package org.team4u.actiondock.project.knowledge.plugin.domain;

import java.util.List;

/**
 * 项目知识库插件常量定义。
 *
 * <p>集中管理知识库工作流中的文件路径、临时目录和工作流节点名称等常量。
 *
 * @author ActionDock
 */
public final class KnowledgeConstants {
    public static final String TEMPLATE_SECURITY = "template-security.md";

    /** 知识库入口文件路径，位于仓库根目录。 */
    public static final String ENTRY_PATH = "ACTIONDOCK.md";

    /** 初始化操作的报告文件路径。 */
    public static final String INIT_REPORT_PATH = "KNOWLEDGE_INIT_REPORT.md";

    /** 刷新操作的报告文件路径。 */
    public static final String REFRESH_REPORT_PATH = "KNOWLEDGE_UPDATE_REPORT.md";

    /** 项目知识工作区目录，位于仓库根目录下。 */
    public static final String WORKSPACE_DIR = ".actiondock";

    /** 临时工作目录，存放检查点、任务计划等中间产物。 */
    public static final String TEMP_ROOT = WORKSPACE_DIR + "/.knowledge-tmp";

    /** 工作流检查点文件名。 */
    public static final String CHECKPOINT_FILE = "checkpoint.json";

    /** 最新运行记录文件名。 */
    public static final String LATEST_RUN_FILE = "latest-run.json";

    /** 工作流节点执行顺序。 */
    public static final List<String> WORKFLOW_NODES = List.of(
            "validateRepo",
            "collectInventory",
            "classifyDomains",
            "buildTaskPlan",
            "executeAtomicTasks",
            "mergeWrite",
            "qualityCheck",
            "report"
    );

    public static final List<String> SUPPORTED_DOMAIN_IDS = List.of(
            "code-structure",
            "architecture",
            "flows",
            "rules",
            "state-machines",
            "data-model",
            "data-behavior",
            "api-events",
            "integrations",
            "diagnosis",
            "observability",
            "ops-config",
            "ops-jobs",
            "ops-manual",
            "dev-test",
            "security",
            "agent-guide"
    );

    public static final List<String> SUPPORTED_TASK_GROUP_IDS = List.of(
            "common",
            "flows",
            "data",
            "integrations",
            "ops",
            "diagnosis",
            "security",
            "agent"
    );

    private KnowledgeConstants() {
    }

    /**
     * 根据操作类型返回对应的报告文件路径。
     *
     * @param operation 操作类型（{@code init} 或 {@code refresh}）
     * @return 报告文件路径
     */
    public static String reportPath(String operation) {
        return "init".equals(operation) ? INIT_REPORT_PATH : REFRESH_REPORT_PATH;
    }
}
