package org.team4u.actiondock.domain.model;

/**
 * 脚本在依赖图中的发布语义。
 */
public enum ScriptPackaging {
    TOOL,
    FLOW;

    /** AI 包内部前缀，以该前缀开头的名称表示由系统托管的内部实体。 */
    public static final String MANAGED_INTERNAL_PREFIX = "pkg.";

    /** AI 包入口前缀，以该前缀开头的名称表示由能力包注册的入口实体。 */
    public static final String MANAGED_ENTRY_PREFIX = "cap.";
}
