package org.team4u.actiondock.browser.plugin;

import org.team4u.actiondock.plugin.api.PluginObjectMappers;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

final class BrowserActionPolicy {
    private BrowserActionPolicy() {
    }

    static void assertAllowed(BrowserPluginConfig config, String action) {
        if (config == null || Args.isBlank(config.getActionPolicyPath())) {
            return;
        }
        Policy policy = load(config.getActionPolicyPath());
        if (policy.denyActions.contains(action)) {
            throw new BrowserActionBlockedException(action, "action", "Browser action is blocked by policy: " + action);
        }
        String category = categoryOf(action);
        if (!Args.isBlank(category) && policy.denyCategories.contains(category)) {
            throw new BrowserActionBlockedException(action, category, "Browser action category is blocked by policy: " + category);
        }
    }

    private static Policy load(String pathValue) {
        try {
            Path path = Path.of(pathValue).toAbsolutePath().normalize();
            if (!Files.isRegularFile(path)) {
                throw new IllegalArgumentException("actionPolicyPath must point to an existing file: " + path);
            }
            Object parsed = PluginObjectMappers.DEFAULT.readValue(path.toFile(), Object.class);
            if (!(parsed instanceof Map<?, ?> map)) {
                throw new IllegalArgumentException("action policy must be a JSON object");
            }
            return new Policy(
                    readStringSet(map, "denyActions"),
                    readStringSet(map, "denyCategories")
            );
        } catch (BrowserActionBlockedException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalArgumentException("Cannot load browser action policy: " + exception.getMessage(), exception);
        }
    }

    private static Set<String> readStringSet(Map<?, ?> map, String key) {
        Object value = map.get(key);
        if (!(value instanceof Iterable<?> iterable)) {
            return Set.of();
        }
        Set<String> result = new HashSet<>();
        for (Object item : iterable) {
            if (item != null && !String.valueOf(item).isBlank()) {
                result.add(String.valueOf(item).trim());
            }
        }
        return result;
    }

    private static String categoryOf(String action) {
        if ("eval".equals(action)) {
            return "eval";
        }
        if (Set.of("pdf", "screenshot", "traceStop", "harStop", "screenshotDiff").contains(action)) {
            return "artifact";
        }
        if (Set.of("open", "reload", "back", "forward", "tabNew", "tabSwitch").contains(action)) {
            return "navigation";
        }
        if (Set.of("networkRoute", "networkUnroute", "networkOffline", "networkHeaders", "networkRequest").contains(action)) {
            return "networkMutation";
        }
        return "";
    }

    private record Policy(Set<String> denyActions, Set<String> denyCategories) {
    }
}
