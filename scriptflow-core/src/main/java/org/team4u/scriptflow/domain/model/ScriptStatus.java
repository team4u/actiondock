package org.team4u.scriptflow.domain.model;

/**
 * 脚本状态枚举，定义脚本的生命周期状态。
 *
 * @author jay.wu
 */
public enum ScriptStatus {
    /** 草稿状态，脚本正在编辑中，尚未发布 */
    DRAFT,
    /** 已发布状态，脚本已发布，可被执行 */
    PUBLISHED,
    /** 归档状态，脚本已废弃不再使用 */
    ARCHIVED
}
