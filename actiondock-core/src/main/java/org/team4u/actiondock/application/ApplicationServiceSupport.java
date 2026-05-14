package org.team4u.actiondock.application;

import java.util.regex.Pattern;

/**
 * 应用服务层公共工具方法。
 *
 * @author jay.wu
 */
final class ApplicationServiceSupport {

    private ApplicationServiceSupport() {
    }

    /**
     * 校验并规范化字符串值，空白则抛出异常。
     *
     * @param value   待校验的字符串
     * @param message 异常消息
     * @return 去除首尾空格后的字符串
     * @throws IllegalArgumentException 如果值为 null 或空白
     */
    static String normalize(String value, String message) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(message);
        }
        return value.trim();
    }

    static String normalizePattern(String value, String fieldName, Pattern pattern) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " 不能为空");
        }
        String normalized = value.trim();
        if (!pattern.matcher(normalized).matches()) {
            throw new IllegalArgumentException(fieldName + " 格式不合法: " + value);
        }
        return normalized;
    }

    static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

}
