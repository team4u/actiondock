package org.team4u.actiondock.project.knowledge.plugin.domain;

import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

public record MaintenanceRequest(
        Path repoPath,
        String operation,
        boolean resume,
        boolean dryRun,
        String executor,
        String agentProfile,
        String externalCommandProfile,
        List<String> evidenceFiles
) {
    public static MaintenanceRequest from(Map<String, Object> values) {
        Path root = repoPath(values);
        String operation = optionalString(values.get("operation"));
        if (operation == null || operation.isBlank()) {
            operation = Files.exists(root.resolve(KnowledgeConstants.ENTRY_PATH)) ? "refresh" : "init";
        }
        operation = operation.toLowerCase(Locale.ROOT);
        if (!operation.equals("init") && !operation.equals("refresh")) {
            throw new PluginRuntimeException("operation must be init or refresh");
        }
        String executor = optionalString(values.get("executor"));
        if (executor == null || executor.isBlank()) {
            executor = "builtin-agent";
        }
        return new MaintenanceRequest(
                root,
                operation,
                booleanValue(values.get("resume"), true),
                booleanValue(values.get("dryRun"), false),
                executor,
                optionalString(values.get("agentProfile")),
                optionalString(values.get("externalCommandProfile")),
                stringList(values.get("evidenceFiles"))
        );
    }

    private static Path repoPath(Map<String, Object> values) {
        String repoPath = optionalString(values.get("repoPath"));
        if (repoPath == null || repoPath.isBlank()) {
            throw new PluginRuntimeException("repoPath is required");
        }
        try {
            return Paths.get(repoPath).toAbsolutePath().normalize();
        } catch (InvalidPathException exception) {
            throw new PluginRuntimeException("Invalid repoPath: " + repoPath, exception);
        }
    }

    private static String optionalString(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static boolean booleanValue(Object value, boolean defaultValue) {
        return value instanceof Boolean bool ? bool : defaultValue;
    }

    private static List<String> stringList(Object value) {
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        return list.stream()
                .filter(Objects::nonNull)
                .map(String::valueOf)
                .toList();
    }
}
