package org.team4u.actiondock.domain.exception;

/**
 * 插件版本冲突详情记录。
 *
 * @param scriptId 受影响的脚本 ID
 * @param scriptName 受影响的脚本名称
 * @param requiredVersionRange 脚本要求的版本范围
 * @author jay.wu
 */
public record RepositoryPluginConflict(
        String scriptId,
        String scriptName,
        String requiredVersionRange
) {
}
