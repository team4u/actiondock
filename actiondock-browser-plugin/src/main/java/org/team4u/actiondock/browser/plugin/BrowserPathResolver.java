package org.team4u.actiondock.browser.plugin;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

final class BrowserPathResolver {
    Path resolveStatePath(BrowserPluginConfig config, Map<String, Object> args, boolean createParent) throws IOException {
        return resolvePath(config.getStateDir(), args, "stateName", "storageStatePath", ".json", createParent);
    }

    Path resolveArtifactPath(BrowserPluginConfig config, Map<String, Object> args, boolean createParent) throws IOException {
        return resolvePath(config.getArtifactDir(), args, "name", "path", ".png", createParent);
    }

    Path resolvePdfPath(BrowserPluginConfig config, Map<String, Object> args, boolean createParent) throws IOException {
        return resolvePath(config.getArtifactDir(), args, "name", "path", ".pdf", createParent);
    }

    Path resolveTracePath(BrowserPluginConfig config, Map<String, Object> args, boolean createParent) throws IOException {
        return resolvePath(config.getArtifactDir(), args, "name", "path", ".zip", createParent);
    }

    Path resolveHarPath(BrowserPluginConfig config, Map<String, Object> args, boolean createParent) throws IOException {
        return resolvePath(config.getArtifactDir(), args, "name", "path", ".har", createParent);
    }

    Path resolveJsonArtifactPath(BrowserPluginConfig config, Map<String, Object> args, boolean createParent) throws IOException {
        return resolvePath(config.getArtifactDir(), args, "name", "path", ".json", createParent);
    }

    Path resolveInputFilePath(String pathValue) throws IOException {
        if (Args.isBlank(pathValue)) {
            throw new IllegalArgumentException("path must not be blank");
        }
        Path root = Path.of(".").toAbsolutePath().normalize();
        Path candidate = Path.of(pathValue);
        if (candidate.isAbsolute()) {
            throw new IllegalArgumentException("path must be relative to " + root);
        }
        Path resolved = root.resolve(candidate).toAbsolutePath().normalize();
        if (!resolved.startsWith(root)) {
            throw new IllegalArgumentException("path escapes allowed directory");
        }
        if (!Files.isRegularFile(resolved)) {
            throw new IllegalArgumentException("path must point to an existing file: " + pathValue);
        }
        return resolved;
    }

    Path resolveDownloadDir(BrowserPluginConfig config) throws IOException {
        Path path = Path.of(config.getDownloadDir()).toAbsolutePath().normalize();
        Files.createDirectories(path);
        return path;
    }

    Path resolveDownloadPath(BrowserPluginConfig config, Map<String, Object> args, boolean createParent) throws IOException {
        return resolvePath(config.getDownloadDir(), args, "name", "path", "", createParent);
    }

    private Path resolvePath(String rootValue,
                             Map<String, Object> args,
                             String nameKey,
                             String pathKey,
                             String defaultExtension,
                             boolean createParent) throws IOException {
        Path root = Path.of(rootValue).toAbsolutePath().normalize();
        String pathValue = Args.optionalString(args, pathKey, null);
        String nameValue = Args.optionalString(args, nameKey, null);
        if (Args.isBlank(pathValue) && Args.isBlank(nameValue)) {
            throw new IllegalArgumentException(pathKey + " or " + nameKey + " is required");
        }

        String relative = Args.isBlank(pathValue) ? sanitizeFileName(nameValue, defaultExtension) : pathValue;
        Path candidate = Path.of(relative);
        if (candidate.isAbsolute()) {
            throw new IllegalArgumentException(pathKey + " must be relative to " + root);
        }
        Path resolved = root.resolve(candidate).toAbsolutePath().normalize();
        if (!resolved.startsWith(root)) {
            throw new IllegalArgumentException(pathKey + " escapes allowed directory");
        }
        if (createParent && resolved.getParent() != null) {
            Files.createDirectories(resolved.getParent());
        }
        return resolved;
    }

    private static String sanitizeFileName(String name, String defaultExtension) {
        String value = name == null ? "" : name.trim().replaceAll("[^a-zA-Z0-9._-]", "_");
        if (value.isBlank()) {
            throw new IllegalArgumentException("name must not be blank");
        }
        return value.contains(".") ? value : value + defaultExtension;
    }
}
