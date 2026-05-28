package org.team4u.actiondock.repository;

import org.team4u.actiondock.common.NormalizeUtils;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * 仓库版本比较与校验工具。
 *
 * @author jay.wu
 */
public final class RepositoryVersionUtils {

    private RepositoryVersionUtils() {
    }

    static boolean versionSatisfies(String version, String range) {
        if (NormalizeUtils.isBlank(range)) {
            return true;
        }
        if (NormalizeUtils.isBlank(version)) {
            return false;
        }
        for (String token : range.trim().replaceAll("(>=|<=|>|<|=)\\s+", "$1").split("\\s+")) {
            if (token.isBlank()) {
                continue;
            }
            String operator = token.startsWith(">=") || token.startsWith("<=")
                    ? token.substring(0, 2)
                    : token.substring(0, 1);
            String expected = token.substring(operator.length());
            int comparison = compareVersion(version, expected);
            boolean matches = switch (operator) {
                case ">" -> comparison > 0;
                case ">=" -> comparison >= 0;
                case "<" -> comparison < 0;
                case "<=" -> comparison <= 0;
                case "=" -> comparison == 0;
                default -> compareVersion(version, token) == 0;
            };
            if (!matches) {
                return false;
            }
        }
        return true;
    }

    static int compareVersion(String left, String right) {
        String[] leftParts = normalizeVersion(left).split("\\.");
        String[] rightParts = normalizeVersion(right).split("\\.");
        int length = Math.max(leftParts.length, rightParts.length);
        for (int index = 0; index < length; index++) {
            int leftValue = index < leftParts.length ? parseVersionPart(leftParts[index]) : 0;
            int rightValue = index < rightParts.length ? parseVersionPart(rightParts[index]) : 0;
            if (leftValue != rightValue) {
                return Integer.compare(leftValue, rightValue);
            }
        }
        return 0;
    }

    static String normalizeVersion(String version) {
        String normalized = version == null ? "" : version.trim();
        return normalized.startsWith("v") || normalized.startsWith("V") ? normalized.substring(1) : normalized;
    }

    static int parseVersionPart(String value) {
        String digits = value.replaceAll("[^0-9].*$", "");
        if (digits.isBlank()) {
            return 0;
        }
        return Integer.parseInt(digits);
    }

    static void verifySha256(String pluginId, byte[] content, String expected) {
        if (NormalizeUtils.isBlank(expected)) {
            throw new IllegalArgumentException("插件 artifact.sha256 不能为空");
        }
        String actual = sha256(content);
        if (!actual.equalsIgnoreCase(expected.trim())) {
            throw new IllegalArgumentException("插件校验失败: " + pluginId);
        }
    }

    static void verifySize(String pluginId, byte[] content, Long expected) {
        if (expected == null) {
            return;
        }
        if (expected < 0) {
            throw new IllegalArgumentException("插件 artifact.size 不能为负数: " + pluginId);
        }
        if (content.length != expected) {
            throw new IllegalArgumentException("插件大小校验失败: " + pluginId);
        }
    }

    public static String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("当前 JRE 不支持 SHA-256", exception);
        }
    }

    public static String sha256(String value) {
        return sha256(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    public static void validateRelativePath(String relativePath, String context) {
        if (NormalizeUtils.isBlank(relativePath)) {
            throw new IllegalArgumentException(context + "不能为空");
        }
        if (relativePath.contains("..")) {
            throw new IllegalArgumentException(context + "不允许包含 ..: " + relativePath);
        }
        if (java.nio.file.Path.of(relativePath).isAbsolute()) {
            throw new IllegalArgumentException(context + "不允许使用绝对路径: " + relativePath);
        }
    }
}
