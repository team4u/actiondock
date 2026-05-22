package org.team4u.actiondock.project.knowledge.plugin;

/**
 * 项目知识库相关路径与常量。
 *
 * <p>定义知识库运行记录和正式知识库路径常量。
 */
final class KnowledgeConstants {

    /** 知识库工作区根目录（相对于仓库根目录） */
    static final String WORKSPACE_ROOT = ".actiondock/project-knowledge";

    /** 知识库入口文档，发布在仓库根目录 */
    static final String ACTIONDOCK_ENTRY = "ACTIONDOCK.md";

    /** OCKB 正式知识库根目录 */
    static final String KNOWLEDGE_BASE_ROOT = ".knowledge_base";

    /** OCKB 目录树索引 */
    static final String SUMMARY_PATH = KNOWLEDGE_BASE_ROOT + "/SUMMARY.md";

    /** 架构总览与领域文档路径 */
    static final String OVERVIEW_PATH = KNOWLEDGE_BASE_ROOT + "/00_Overview_and_Domain/overview.md";

    /** 编码规范文档路径 */
    static final String CODING_GUIDELINES_PATH = KNOWLEDGE_BASE_ROOT + "/01_Coding_Guidelines/guidelines.md";

    /** 基础设施和环境文档路径 */
    static final String INFRA_ENV_PATH = KNOWLEDGE_BASE_ROOT + "/02_Infra_and_Env/infra-and-env.md";

    /** 数据模型文档路径 */
    static final String DATA_PATH = KNOWLEDGE_BASE_ROOT + "/03_Data_Models/data-models.md";

    /** 业务流程文档路径 */
    static final String FLOWS_PATH = KNOWLEDGE_BASE_ROOT + "/04_Business_Flows/business-flows.md";

    /** Agent 工具与 CLI 文档路径 */
    static final String AGENT_TOOLS_PATH = KNOWLEDGE_BASE_ROOT + "/05_Agent_Tools_and_CLI/agent-tools-and-cli.md";

    /** Runbook 和运维文档路径 */
    static final String RUNBOOKS_PATH = KNOWLEDGE_BASE_ROOT + "/06_Runbooks_and_Ops/runbooks-and-ops.md";

    private KnowledgeConstants() {
    }
}
