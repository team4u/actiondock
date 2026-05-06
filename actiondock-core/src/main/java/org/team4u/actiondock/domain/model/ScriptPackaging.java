package org.team4u.actiondock.domain.model;

import java.util.Locale;

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

    public static boolean isManagedId(String id) {
        return id != null && (id.startsWith(MANAGED_INTERNAL_PREFIX) || id.startsWith(MANAGED_ENTRY_PREFIX));
    }

    /**
     * 断言指定 ID 不是托管实体，否则抛出 IllegalArgumentException。
     *
     * @param id          实体 ID
     * @param entityType  实体类型名称（如"模型"、"Agent"、"工具集"），用于错误消息
     */
    public static void assertMutable(String id, String entityType) {
        if (isManagedId(id)) {
            throw new IllegalArgumentException("AI 能力包托管" + entityType + "不允许直接修改: " + id);
        }
    }

    /**
     * 从字符串解析 Packaging，空白或 null 时默认返回 TOOL。
     */
    public static ScriptPackaging fromNullableName(String name) {
        if (name == null || name.isBlank()) {
            return TOOL;
        }
        return valueOf(name.trim().toUpperCase(Locale.ROOT));
    }
}
