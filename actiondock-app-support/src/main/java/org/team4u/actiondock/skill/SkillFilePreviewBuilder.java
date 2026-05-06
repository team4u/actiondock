package org.team4u.actiondock.skill;

import org.team4u.actiondock.shared.NormalizeUtils;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Skill 文件预览与文件树构建器。
 *
 * <p>负责构建文件预览信息（文本截断、图片 Base64、目录概览）
 * 以及递归文件树结构，从 {@link SkillFileUtils} 中分离以便独立维护。</p>
 *
 * @author jay.wu
 */
final class SkillFilePreviewBuilder {

    private static final System.Logger log = System.getLogger(SkillFilePreviewBuilder.class.getName());

    /** 文件扩展名到 MIME 内容类型的映射表。 */
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

    /** 文本类文件扩展名集合，用于判断文件是否可作为文本预览。 */
    private static final Set<String> TEXT_EXTENSIONS = Set.of(".md", ".json", ".yaml", ".yml", ".txt");

    /** 文件扩展名到编辑器语言标识的映射表。 */
    private static final Map<String, String> EXTENSION_TO_LANGUAGE = Map.of(
            ".md", "markdown",
            ".json", "json",
            ".yaml", "yaml",
            ".yml", "yaml",
            ".txt", "plaintext"
    );

    private static final int MAX_TEXT_PREVIEW_CHARS = 200_000;
    private static final long MAX_IMAGE_PREVIEW_BYTES = 2L * 1024L * 1024L;

    private SkillFilePreviewBuilder() {
    }

    /**
     * 检测文件的 MIME 内容类型。
     */
    static String detectContentType(Path path) {
        try {
            String contentType = Files.probeContentType(path);
            if (NormalizeUtils.isNotBlank(contentType)) {
                return contentType;
            }
        } catch (IOException exception) {
            log.log(System.Logger.Level.DEBUG, "探测文件内容类型失败，使用扩展名回退: {0}", exception.getMessage());
        }
        String extension = extractExtension(path);
        return EXTENSION_TO_CONTENT_TYPE.getOrDefault(extension, "application/octet-stream");
    }

    /**
     * 判断文件是否为文本类型。
     */
    static boolean isTextFile(Path path, String contentType) {
        if (contentType.startsWith("text/")) {
            return true;
        }
        String extension = extractExtension(path);
        return TEXT_EXTENSIONS.contains(extension);
    }

    /**
     * 判断内容类型是否为图片。
     */
    static boolean isImageFile(String contentType) {
        return contentType.startsWith("image/");
    }

    /**
     * 获取文件大小。
     */
    static long fileSize(Path path) {
        try {
            return Files.size(path);
        } catch (IOException exception) {
            throw new IllegalStateException("读取 Skill 文件大小失败: " + path, exception);
        }
    }

    /**
     * 从文件路径中提取小写扩展名（含点号），例如 ".md"、".json"。
     * 无扩展名时返回空字符串。
     */
    private static String extractExtension(Path path) {
        String fileName = path.getFileName().toString().toLowerCase(Locale.ROOT);
        int dotIndex = fileName.lastIndexOf('.');
        return dotIndex >= 0 ? fileName.substring(dotIndex) : "";
    }

    /**
     * 构建文件预览信息。
     */
    static SkillTypes.SkillFilePreview buildFilePreview(Path basePath, Path target) {
        if (Files.isDirectory(target)) {
            return previewDirectory(basePath, target);
        }
        String relative = SkillFileUtils.relativePath(basePath, target);
        String contentType = detectContentType(target);
        long size = fileSize(target);
        if (isImageFile(contentType)) {
            return previewImage(target, relative, contentType, size);
        }
        if (!isTextFile(target, contentType)) {
            return new SkillTypes.SkillFilePreview(relative, target.getFileName().toString(), false, contentType, size, "UNSUPPORTED", null, null, null, false);
        }
        return previewText(target, relative, contentType, size);
    }

    private static SkillTypes.SkillFilePreview previewDirectory(Path basePath, Path target) {
        return new SkillTypes.SkillFilePreview(
                SkillFileUtils.relativePath(basePath, target),
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

    private static SkillTypes.SkillFilePreview previewImage(Path target, String relative, String contentType, long size) {
        if (size > MAX_IMAGE_PREVIEW_BYTES) {
            return new SkillTypes.SkillFilePreview(relative, target.getFileName().toString(), false, contentType, size, "UNSUPPORTED", null, null, null, true);
        }
        try {
            String dataUrl = "data:" + contentType + ";base64," + Base64.getEncoder().encodeToString(Files.readAllBytes(target));
            return new SkillTypes.SkillFilePreview(relative, target.getFileName().toString(), false, contentType, size, "IMAGE", null, null, dataUrl, false);
        } catch (IOException exception) {
            throw new IllegalStateException("读取 Skill 文件失败: " + relative, exception);
        }
    }

    private static SkillTypes.SkillFilePreview previewText(Path target, String relative, String contentType, long size) {
        String text = SkillFileUtils.readString(target);
        boolean truncated = text.length() > MAX_TEXT_PREVIEW_CHARS;
        String extension = extractExtension(target);
        return new SkillTypes.SkillFilePreview(
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

    /**
     * 递归构建 Skill 文件树（排除安装标记文件）。
     */
    static List<SkillTypes.SkillFileNode> buildFileTree(Path root, Path current) {
        try (var stream = Files.list(current)) {
            return stream
                    .filter(path -> !SkillFileUtils.INSTALL_MARKER_FILE.equals(path.getFileName().toString()))
                    .sorted(Comparator
                            .comparing((Path path) -> !Files.isDirectory(path))
                            .thenComparing(path -> path.getFileName().toString(), String.CASE_INSENSITIVE_ORDER))
                    .map(path -> toFileNode(root, path))
                    .toList();
        } catch (IOException exception) {
            throw new IllegalStateException("读取 Skill 文件树失败: " + current, exception);
        }
    }

    /**
     * 将单个路径转换为 SkillFileNode。
     */
    static SkillTypes.SkillFileNode toFileNode(Path root, Path path) {
        boolean directory = Files.isDirectory(path);
        String relativePath = SkillFileUtils.relativePath(root, path);
        return new SkillTypes.SkillFileNode(
                path.getFileName().toString(),
                relativePath,
                directory,
                directory ? null : fileSize(path),
                directory ? buildFileTree(root, path) : List.of()
        );
    }
}
