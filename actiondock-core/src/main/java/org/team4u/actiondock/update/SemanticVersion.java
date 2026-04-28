package org.team4u.actiondock.update;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * 轻量级语义化版本比较器，兼容常见的 npm/Maven 版本号。
 */
final class SemanticVersion implements Comparable<SemanticVersion> {
    private final List<Integer> numericParts;
    private final List<String> preReleaseParts;

    private SemanticVersion(List<Integer> numericParts, List<String> preReleaseParts) {
        this.numericParts = numericParts;
        this.preReleaseParts = preReleaseParts;
    }

    static SemanticVersion parse(String rawVersion) {
        Objects.requireNonNull(rawVersion, "rawVersion");
        String normalized = rawVersion.trim();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("Version is blank");
        }

        int buildSeparator = normalized.indexOf('+');
        if (buildSeparator >= 0) {
            normalized = normalized.substring(0, buildSeparator);
        }

        String[] mainAndPreRelease = normalized.split("-", 2);
        List<Integer> numericParts = parseNumericParts(mainAndPreRelease[0]);
        List<String> preReleaseParts = mainAndPreRelease.length == 2
                ? parsePreReleaseParts(mainAndPreRelease[1])
                : List.of();
        return new SemanticVersion(numericParts, preReleaseParts);
    }

    private static List<Integer> parseNumericParts(String rawNumericPart) {
        String[] tokens = rawNumericPart.split("\\.");
        List<Integer> parts = new ArrayList<>(tokens.length);
        for (String token : tokens) {
            if (token.isBlank()) {
                throw new IllegalArgumentException("Invalid version segment");
            }
            parts.add(Integer.parseInt(token));
        }
        return parts;
    }

    private static List<String> parsePreReleaseParts(String rawPreReleasePart) {
        String[] tokens = rawPreReleasePart.split("\\.");
        List<String> parts = new ArrayList<>(tokens.length);
        for (String token : tokens) {
            if (!token.isBlank()) {
                parts.add(token);
            }
        }
        return parts;
    }

    @Override
    public int compareTo(SemanticVersion other) {
        int maxLength = Math.max(numericParts.size(), other.numericParts.size());
        for (int index = 0; index < maxLength; index++) {
            int left = index < numericParts.size() ? numericParts.get(index) : 0;
            int right = index < other.numericParts.size() ? other.numericParts.get(index) : 0;
            int comparison = Integer.compare(left, right);
            if (comparison != 0) {
                return comparison;
            }
        }

        if (preReleaseParts.isEmpty() && other.preReleaseParts.isEmpty()) {
            return 0;
        }
        if (preReleaseParts.isEmpty()) {
            return 1;
        }
        if (other.preReleaseParts.isEmpty()) {
            return -1;
        }

        int maxPreReleaseLength = Math.max(preReleaseParts.size(), other.preReleaseParts.size());
        for (int index = 0; index < maxPreReleaseLength; index++) {
            if (index >= preReleaseParts.size()) {
                return -1;
            }
            if (index >= other.preReleaseParts.size()) {
                return 1;
            }
            int comparison = comparePreReleasePart(preReleaseParts.get(index), other.preReleaseParts.get(index));
            if (comparison != 0) {
                return comparison;
            }
        }
        return 0;
    }

    private static int comparePreReleasePart(String left, String right) {
        boolean leftNumeric = left.chars().allMatch(Character::isDigit);
        boolean rightNumeric = right.chars().allMatch(Character::isDigit);
        if (leftNumeric && rightNumeric) {
            return Integer.compare(Integer.parseInt(left), Integer.parseInt(right));
        }
        if (leftNumeric) {
            return -1;
        }
        if (rightNumeric) {
            return 1;
        }
        return left.compareTo(right);
    }
}
