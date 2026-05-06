package org.team4u.actiondock.shared;

import java.nio.file.Path;
import java.util.List;
import java.util.Locale;

/**
 * 输入规范化工具类。
 *
 * <p>提供字符串校验、空安全、路径规范化等通用方法，
 * 从 {@code SkillFileUtils} 中提取以便跨包复用。</p>
 *
 * @author jay.wu
 */
public final class NormalizeUtils {

    private NormalizeUtils() {
    }

    /**
     * 空安全列表，null 转为空列表。
     */
    public static <T> List<T> nullSafeList(List<T> list) {
        return list == null ? List.of() : list;
    }

    /**
     * 判断字符串是否为 null 或空白。
     */
    public static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    /**
     * 判断字符串是否非 null 且非空白。
     */
    public static boolean isNotBlank(String value) {
        return value != null && !value.isBlank();
    }

    /**
     * 规范化字符串，为空时抛出异常。
     *
     * @param value   待规范化的字符串
     * @param message 为空时的异常信息
     * @return trim 后的字符串
     * @throws IllegalArgumentException 字符串为空时
     */
    public static String normalize(String value, String message) {
        String normalized = normalizeNullable(value);
        if (normalized == null) {
            throw new IllegalArgumentException(message);
        }
        return normalized;
    }

    /**
     * 规范化可空字符串，为空返回 null。
     */
    public static String normalizeNullable(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    /**
     * 规范化字符串，为空时返回默认值。
     */
    public static String normalizeOrDefault(String value, String defaultValue) {
        String normalized = normalizeNullable(value);
        return normalized == null ? defaultValue : normalized;
    }

    /**
     * 将字符串转换为 URL 安全的 slug 形式（小写、连字符分隔）。
     */
    public static String slugify(String value) {
        String normalized = normalizeOrDefault(value, "skill")
                .trim()
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
        return normalized.isBlank() ? "skill" : normalized;
    }

    /**
     * 规范化路径为绝对路径。
     */
    public static Path normalizePath(Path path) {
        return path == null ? null : path.toAbsolutePath().normalize();
    }

    /**
     * 规范化路径字符串为绝对路径。
     */
    public static Path normalizePath(String path) {
        return normalizePath(Path.of(path));
    }

    /**
     * 将路径中的 ~ 前缀展开为用户主目录。
     */
    public static String expandHomeShortcut(String input) {
        String value = normalize(input, "路径不能为空");
        if (value.contains("${") || value.contains("$") || value.contains("%")) {
            throw new IllegalArgumentException("路径仅支持使用 ~ 表示用户目录");
        }
        String userHome = System.getProperty("user.home");
        if ("~".equals(value)) {
            value = userHome;
        } else if (value.startsWith("~/") || value.startsWith("~\\")) {
            value = userHome + value.substring(1);
        }
        return value;
    }

    /**
     * 规范化目标 ID 列表：去空、去重、非空校验。
     */
    public static List<String> normalizeTargetIds(List<String> targetIds) {
        List<String> normalized = nullSafeList(targetIds).stream()
                .map(id -> normalize(id, "targetId 不能为空"))
                .distinct()
                .toList();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("至少需要一个 SkillTarget");
        }
        return normalized;
    }
}
