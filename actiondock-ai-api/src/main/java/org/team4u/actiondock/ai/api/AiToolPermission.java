package org.team4u.actiondock.ai.api;

/**
 * AI 工具权限级别。
 * <p>
 * 按风险等级递增定义工具的权限级别，用于控制工具可执行的操作范围。
 * 权限级别越高，允许的操作越敏感。高权限级别自动包含低权限级别的能力。
 *
 * @author jay.wu
 */
public enum AiToolPermission {
    /** 只读权限，仅允许查询和读取数据 */
    READ_ONLY,
    /** 提议变更权限，可以生成变更建议但不直接执行 */
    PROPOSE_CHANGE,
    /** 受控操作权限，允许执行预定义的安全操作 */
    CONTROLLED_ACTION,
    /** 危险操作权限，允许执行高风险操作（如删除、系统命令等） */
    DANGEROUS_ACTION;

    /**
     * 判断当前权限是否允许所请求的权限级别。
     * <p>
     * 权限判断基于序号比较：当前权限的序号大于等于请求权限的序号时视为允许。
     *
     * @param requested 请求的权限级别
     * @return 是否允许该权限
     */
    public boolean allows(AiToolPermission requested) {
        return requested != null && ordinal() >= requested.ordinal();
    }

    /**
     * 从任意值解析权限级别，解析失败时返回默认值。
     *
     * @param value    待解析的值，支持枚举实例或字符串形式
     * @param fallback 解析失败时的回退默认值
     * @return 解析后的权限级别
     */
    public static AiToolPermission from(Object value, AiToolPermission fallback) {
        if (value == null) {
            return fallback;
        }
        if (value instanceof AiToolPermission permission) {
            return permission;
        }
        try {
            return AiToolPermission.valueOf(String.valueOf(value).trim().toUpperCase());
        } catch (IllegalArgumentException ignored) {
            return fallback;
        }
    }
}
