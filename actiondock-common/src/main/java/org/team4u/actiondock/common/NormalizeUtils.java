package org.team4u.actiondock.common;

import java.nio.file.Path;
import java.util.List;
import java.util.Locale;

/**
 * Input normalization helpers shared across modules.
 */
public final class NormalizeUtils {

    private NormalizeUtils() {
    }

    public static <T> List<T> nullSafeList(List<T> list) {
        return list == null ? List.of() : list;
    }

    public static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    public static boolean isNotBlank(String value) {
        return value != null && !value.isBlank();
    }

    public static String normalize(String value, String message) {
        String normalized = normalizeNullable(value);
        if (normalized == null) {
            throw new IllegalArgumentException(message);
        }
        return normalized;
    }

    public static String normalizeNullable(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    public static String normalizeOrDefault(String value, String defaultValue) {
        String normalized = normalizeNullable(value);
        return normalized == null ? defaultValue : normalized;
    }

    public static String slugify(String value) {
        String normalized = normalizeOrDefault(value, "skill")
                .trim()
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
        return normalized.isBlank() ? "skill" : normalized;
    }

    public static Path normalizePath(Path path) {
        return path == null ? null : path.toAbsolutePath().normalize();
    }

    public static Path normalizePath(String path) {
        return normalizePath(Path.of(path));
    }

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
