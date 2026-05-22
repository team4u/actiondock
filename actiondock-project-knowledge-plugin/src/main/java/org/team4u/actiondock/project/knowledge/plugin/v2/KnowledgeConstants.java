package org.team4u.actiondock.project.knowledge.plugin.v2;

import java.util.Set;

/**
 * 项目知识库相关路径与常量。
 *
 * <p>定义知识库工作区根目录、staging 临时目录、正式输出路径等所有路径常量。
 * 正式文档发布到仓库根目录下，staging 用于校验通过前的临时存放。
 */
final class KnowledgeConstants {

    /** 知识库工作区根目录（相对于仓库根目录） */
    static final String WORKSPACE_ROOT = ".actiondock/project-knowledge";

    /** staging 临时目录，用于在校验通过前暂存生成的文档 */
    static final String STAGING_ROOT = WORKSPACE_ROOT + "/staging";

    /** 状态持久化文件，记录已发布文档的 fingerprint 和生成时间 */
    static final String STATE_FILE = WORKSPACE_ROOT + "/state.json";

    /** 知识库入口文档，发布在仓库根目录 */
    static final String ACTIONDOCK_ENTRY = "ACTIONDOCK.md";

    /** 生成报告，包含本次扫描摘要和警告信息 */
    static final String REPORT_FILE = "KNOWLEDGE_REPORT.md";

    /** 项目总览文档路径 */
    static final String OVERVIEW_PATH = "docs/project/overview.md";

    /** 业务流程文档路径 */
    static final String FLOWS_PATH = "docs/project/flows.md";

    /** 数据模型文档路径 */
    static final String DATA_PATH = "docs/project/data.md";

    /** 运行与排查文档路径 */
    static final String OPERATIONS_PATH = "docs/project/operations.md";

    /** 插件管理的所有正式输出路径集合，用于清理旧文件时判断归属 */
    static final Set<String> OWNED_PATHS = Set.of(
            ACTIONDOCK_ENTRY,
            REPORT_FILE,
            OVERVIEW_PATH,
            FLOWS_PATH,
            DATA_PATH,
            OPERATIONS_PATH
    );

    private KnowledgeConstants() {
    }

    /**
     * 根据会话 ID 计算 staging 临时目录路径。
     *
     * @param sessionId 本次生成的唯一会话标识
     * @return staging 子目录的相对路径
     */
    static String stagingDir(String sessionId) {
        return STAGING_ROOT + "/" + sessionId;
    }
}
