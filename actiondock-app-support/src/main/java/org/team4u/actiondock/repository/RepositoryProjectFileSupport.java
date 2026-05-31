package org.team4u.actiondock.repository;

import org.team4u.actiondock.common.NormalizeUtils;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class RepositoryProjectFileSupport {
    private static final System.Logger LOG = System.getLogger(RepositoryProjectFileSupport.class.getName());

    private static final Map<String, String> EXTENSION_TO_CONTENT_TYPE = Map.ofEntries(
            Map.entry(".md", "text/markdown"),
            Map.entry(".json", "application/json"),
            Map.entry(".yaml", "text/yaml"),
            Map.entry(".yml", "text/yaml"),
            Map.entry(".txt", "text/plain"),
            Map.entry(".png", "image/png"),
            Map.entry(".jpg", "image/jpeg"),
            Map.entry(".jpeg", "image/jpeg"),
            Map.entry(".gif", "image/gif"),
            Map.entry(".webp", "image/webp")
    );

    private static final Set<String> TEXT_EXTENSIONS = Set.of(".md", ".json", ".yaml", ".yml", ".txt");
    private static final Map<String, String> EXTENSION_TO_LANGUAGE = Map.of(
            ".md", "markdown",
            ".json", "json",
            ".yaml", "yaml",
            ".yml", "yaml",
            ".txt", "plaintext"
    );

    private static final int MAX_TEXT_PREVIEW_CHARS = 200_000;
    private static final long MAX_IMAGE_PREVIEW_BYTES = 2L * 1024L * 1024L;

    private RepositoryProjectFileSupport() {
    }

    static List<RepositoryCatalogTypes.RepositoryProjectFileNode> buildFileTree(Path root, Path current) {
        try (var stream = Files.list(current)) {
            return stream
                    .sorted(Comparator
                            .comparing((Path path) -> !Files.isDirectory(path))
                            .thenComparing(path -> path.getFileName().toString(), String.CASE_INSENSITIVE_ORDER))
                    .map(path -> toFileNode(root, path))
                    .toList();
        } catch (IOException exception) {
            throw new IllegalStateException("读取项目仓库文件树失败: " + current, exception);
        }
    }

    static RepositoryCatalogTypes.RepositoryProjectFileNode toFileNode(Path root, Path path) {
        boolean directory = Files.isDirectory(path);
        return new RepositoryCatalogTypes.RepositoryProjectFileNode(
                path.getFileName().toString(),
                relativePath(root, path),
                directory,
                directory ? null : fileSize(path),
                directory && hasChildren(path)
        );
    }

    static RepositoryCatalogTypes.RepositoryProjectFilePreview buildPreview(Path root, Path target) {
        if (Files.isDirectory(target)) {
            return new RepositoryCatalogTypes.RepositoryProjectFilePreview(
                    relativePath(root, target),
                    target.getFileName().toString(),
                    true,
                    detectContentType(target),
                    fileSize(target),
                    "DIRECTORY",
                    null,
                    null,
                    null,
                    false
            );
        }
        String relative = relativePath(root, target);
        String contentType = detectContentType(target);
        long size = fileSize(target);
        if (isImageFile(contentType)) {
            return previewImage(target, relative, contentType, size);
        }
        if (!isTextFile(target, contentType)) {
            return new RepositoryCatalogTypes.RepositoryProjectFilePreview(
                    relative,
                    target.getFileName().toString(),
                    false,
                    contentType,
                    size,
                    "UNSUPPORTED",
                    null,
                    null,
                    null,
                    false
            );
        }
        return previewText(target, relative, contentType, size);
    }

    private static RepositoryCatalogTypes.RepositoryProjectFilePreview previewImage(Path target, String relative, String contentType, long size) {
        if (size > MAX_IMAGE_PREVIEW_BYTES) {
            return new RepositoryCatalogTypes.RepositoryProjectFilePreview(relative, target.getFileName().toString(), false, contentType, size, "UNSUPPORTED", null, null, null, true);
        }
        try {
            String dataUrl = "data:" + contentType + ";base64," + Base64.getEncoder().encodeToString(Files.readAllBytes(target));
            return new RepositoryCatalogTypes.RepositoryProjectFilePreview(relative, target.getFileName().toString(), false, contentType, size, "IMAGE", null, null, dataUrl, false);
        } catch (IOException exception) {
            throw new IllegalStateException("读取项目仓库图片失败: " + relative, exception);
        }
    }

    private static RepositoryCatalogTypes.RepositoryProjectFilePreview previewText(Path target, String relative, String contentType, long size) {
        String text = readString(target);
        boolean truncated = text.length() > MAX_TEXT_PREVIEW_CHARS;
        String extension = extractExtension(target);
        return new RepositoryCatalogTypes.RepositoryProjectFilePreview(
                relative,
                target.getFileName().toString(),
                false,
                contentType,
                size,
                ".md".equals(extension) ? "MARKDOWN" : "TEXT",
                EXTENSION_TO_LANGUAGE.getOrDefault(extension, "plaintext"),
                truncated ? text.substring(0, MAX_TEXT_PREVIEW_CHARS) : text,
                null,
                truncated
        );
    }

    private static boolean hasChildren(Path directory) {
        try (var children = Files.list(directory)) {
            return children.findAny().isPresent();
        } catch (IOException exception) {
            throw new IllegalStateException("读取项目仓库目录失败: " + directory, exception);
        }
    }

    private static String detectContentType(Path path) {
        try {
            String contentType = Files.probeContentType(path);
            if (NormalizeUtils.isNotBlank(contentType)) {
                return contentType;
            }
        } catch (IOException exception) {
            LOG.log(System.Logger.Level.DEBUG, "探测项目仓库文件类型失败，使用扩展名回退: {0}", exception.getMessage());
        }
        return EXTENSION_TO_CONTENT_TYPE.getOrDefault(extractExtension(path), "application/octet-stream");
    }

    private static boolean isTextFile(Path path, String contentType) {
        if (contentType.startsWith("text/")) {
            return true;
        }
        return TEXT_EXTENSIONS.contains(extractExtension(path));
    }

    private static boolean isImageFile(String contentType) {
        return contentType != null && contentType.startsWith("image/");
    }

    private static String extractExtension(Path path) {
        String name = path.getFileName() == null ? "" : path.getFileName().toString();
        int dotIndex = name.lastIndexOf('.');
        if (dotIndex < 0) {
            return "";
        }
        return name.substring(dotIndex).toLowerCase();
    }

    private static long fileSize(Path path) {
        try {
            return Files.size(path);
        } catch (IOException exception) {
            throw new IllegalStateException("读取项目仓库文件大小失败: " + path, exception);
        }
    }

    private static String readString(Path path) {
        try {
            return Files.readString(path);
        } catch (IOException exception) {
            throw new IllegalStateException("读取项目仓库文本失败: " + path, exception);
        }
    }

    private static String relativePath(Path root, Path target) {
        return NormalizeUtils.normalizePath(root).relativize(NormalizeUtils.normalizePath(target)).toString().replace('\\', '/');
    }
}
