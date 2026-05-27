package org.team4u.actiondock.browser.plugin;

import java.util.LinkedHashMap;
import java.util.Map;

final class BrowserDslTargets {
    Map<String, Object> fromTarget(Map<String, Object> args) {
        String target = Args.optionalString(args, "target", null);
        if (Args.isBlank(target)) {
            return Map.of();
        }
        Map<String, Object> result = new LinkedHashMap<>();
        String trimmed = target.trim();
        if (trimmed.startsWith("@")) {
            result.put("ref", trimmed.substring(1));
        } else if (trimmed.startsWith("css:")) {
            result.put("selector", trimmed.substring(4));
        } else {
            result.put("selector", trimmed);
        }
        addCommonOptions(result, args);
        return result;
    }

    Map<String, Object> requireTarget(Map<String, Object> args) {
        Map<String, Object> target = fromTarget(args);
        if (target.isEmpty()) {
            throw new IllegalArgumentException("target is required");
        }
        return target;
    }

    Map<String, Object> fromFind(Map<String, Object> args) {
        String by = Args.requiredString(args, "by").trim().toLowerCase();
        String query = Args.requiredString(args, "query");
        Map<String, Object> target = new LinkedHashMap<>();
        switch (by) {
            case "role" -> {
                target.put("role", query);
                String name = Args.optionalString(args, "name", null);
                if (!Args.isBlank(name)) {
                    target.put("name", name);
                }
            }
            case "text" -> target.put("text", query);
            case "label" -> target.put("label", query);
            case "placeholder" -> target.put("placeholder", query);
            case "alt", "alttext" -> target.put("altText", query);
            case "title" -> target.put("title", query);
            case "testid", "test-id", "test_id" -> target.put("testId", query);
            case "css", "selector" -> target.put("selector", query);
            default -> throw new IllegalArgumentException("Unsupported find by: " + by);
        }
        addCommonOptions(target, args);
        return target;
    }

    private static void addCommonOptions(Map<String, Object> target, Map<String, Object> args) {
        if (Args.has(args, "snapshotId")) {
            target.put("snapshotId", Args.requiredString(args, "snapshotId"));
        }
        if (Args.has(args, "exact")) {
            target.put("exact", Args.optionalBoolean(args, "exact", false));
        }
        if (Args.has(args, "index")) {
            target.put("index", Args.optionalInt(args, "index", 0));
        }
    }
}
