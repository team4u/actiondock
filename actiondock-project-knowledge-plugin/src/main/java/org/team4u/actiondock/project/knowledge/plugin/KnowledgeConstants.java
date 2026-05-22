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

    /** OCKB 七大基座目录 */
    static final String ARCHITECTURE_DIR = KNOWLEDGE_BASE_ROOT + "/01_Architecture_Overview";

    static final String API_DIR = KNOWLEDGE_BASE_ROOT + "/02_API_Specifications";

    static final String DATA_DIR = KNOWLEDGE_BASE_ROOT + "/03_Data_Models";

    static final String FLOWS_DIR = KNOWLEDGE_BASE_ROOT + "/04_Business_Flows";

    static final String AGENT_TOOLS_DIR = KNOWLEDGE_BASE_ROOT + "/05_Agent_Tools_and_CLI";

    static final String INFRA_ENV_DIR = KNOWLEDGE_BASE_ROOT + "/06_Infra_and_Env";

    static final String MAINTENANCE_OPS_DIR = KNOWLEDGE_BASE_ROOT + "/07_Maintenance_and_Ops";

    static final String ERRORS_PATH = MAINTENANCE_OPS_DIR + "/ERRORS.md";

    private KnowledgeConstants() {
    }
}
