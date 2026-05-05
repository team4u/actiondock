package org.team4u.actiondock.skill;

import org.team4u.actiondock.domain.port.JsonCodec;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Base64;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Skill 文件操作静态工具类。
 *
 * <p>提供 Skill 目录校验、归档打包/解压、摘要计算、清单写入、
 * 文件树构建等与磁盘 I/O 相关的纯函数工具方法，
 * 从 {@link SkillService} 中提取以便复用与测试。</p>
 */
public final class SkillFileUtils {

    private static final System.Logger log = System.getLogger(SkillFileUtils.class.getName());

    private static final Pattern FRONTMATTER_PATTERN = Pattern.compile("^---\\s*\\n(.*?)\\n---\\s*(?:\\n|$)", Pattern.DOTALL);
    public static final String INSTALL_MARKER_FILE = ".actiondock-skill-install.json";
    public static final String SKILL_MANIFEST_FILE = "SKILL.md";
    public static final String SKILL_PACKAGE_FILE = SkillArchiveManager.SKILL_PACKAGE_FILE;
    static final long MAX_ARCHIVE_SIZE = SkillArchiveManager.MAX_ARCHIVE_SIZE;
    public static final String ERR_VERSION_REQUIRED = "version 不能为空";
    private static final int MAX_SKILL_MD_SIZE = 100_000;

    public static <T> List<T> nullSafeList(List<T> list) {
        return list == null ? List.of() : list;
    }

    public static Path normalizePath(Path path) {
        return path == null ? null : path.toAbsolutePath().normalize();
    }

    public static Path normalizePath(String path) {
        return normalizePath(Path.of(path));
    }

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

    private SkillFileUtils() {
    }

    /**
     * 断言指定路径不是符号链接，否则抛出异常。
     *
     * @param file 待检查的文件路径
     * @throws IllegalArgumentException 如果路径是符号链接
     */
    static void assertNotSymbolicLink(Path file) {
        if (Files.isSymbolicLink(file)) {
            throw new IllegalArgumentException("Skill 不允许包含符号链接: " + file);
        }
    }

    static String relativePath(Path root, Path file) {
        return root.relativize(file).toString().replace('\\', '/');
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

    // ------------------------------------------------------------------
    // Public static methods
    // ------------------------------------------------------------------

    /**
     * 校验 Skill 目录结构并返回验证结果。
     *
     * @param directory       Skill 目录路径
     * @param fallbackId      当 skill.json 不存在时使用的备选 ID
     * @param requireManifest 是否强制要求 skill.json
     * @param jsonCodec       JSON 编解码器
     * @return 校验结果
     */
    public static SkillTypes.SkillValidationResult validateSkillDirectory(Path directory,
                                                                            String fallbackId,
                                                                            boolean requireManifest,
                                                                            JsonCodec jsonCodec) {
        Path root = normalizeSkillRoot(directory);
        SkillMdResult skillMdResult = readAndValidateSkillMd(root);
        SkillTypes.SkillManifestFile manifest = readManifest(root, requireManifest, jsonCodec);
        ResolvedFields fields = resolveFields(skillMdResult.frontmatter, manifest, fallbackId);
        List<String> warnings = collectWarnings(skillMdResult.content, skillMdResult.frontmatter, fields.skillId);
        return buildValidationResult(root, fields, manifest, warnings);
    }

    private static SkillMdResult readAndValidateSkillMd(Path root) {
        Path skillMdPath = root.resolve(SKILL_MANIFEST_FILE);
        if (Files.notExists(skillMdPath)) {
            throw new IllegalArgumentException("Skill 缺少 SKILL.md");
        }
        String content = readString(skillMdPath);
        Frontmatter frontmatter = parseFrontmatter(content);
        return new SkillMdResult(content, frontmatter);
    }

    private static SkillTypes.SkillManifestFile readManifest(Path root, boolean requireManifest, JsonCodec jsonCodec) {
        Path manifestPath = root.resolve(SKILL_PACKAGE_FILE);
        SkillTypes.SkillManifestFile manifest = Files.exists(manifestPath)
                ? jsonCodec.read(readString(manifestPath), SkillTypes.SkillManifestFile.class)
                : null;
        if (requireManifest && manifest == null) {
            throw new IllegalArgumentException("Skill 缺少 skill.json");
        }
        return manifest;
    }

    private static ResolvedFields resolveFields(Frontmatter frontmatter,
                                                 SkillTypes.SkillManifestFile manifest,
                                                 String fallbackId) {
        if (manifest != null) {
            return new ResolvedFields(
                    normalize(manifest.skillId(), "skillId 不能为空"),
                    normalize(manifest.displayName(), "displayName 不能为空"),
                    normalize(manifest.version(), ERR_VERSION_REQUIRED),
                    normalize(manifest.description(), "description 不能为空")
            );
        }
        String skillId = normalizeOrDefault(normalizeNullable(fallbackId), slugify(frontmatter.name()));
        return new ResolvedFields(
                skillId,
                normalizeOrDefault(frontmatter.name(), skillId),
                "1.0.0",
                normalize(frontmatter.description(), "frontmatter description 不能为空")
        );
    }

    private static List<String> collectWarnings(String content, Frontmatter frontmatter, String skillId) {
        List<String> warnings = new ArrayList<>();
        if (frontmatter.name() != null && !Objects.equals(slugify(frontmatter.name()), skillId)) {
            warnings.add("frontmatter name 规范化后与 skillId 不一致");
        }
        if (content.length() > MAX_SKILL_MD_SIZE) {
            warnings.add("SKILL.md 较大，建议拆分 references");
        }
        return warnings;
    }

    private static SkillTypes.SkillValidationResult buildValidationResult(Path root,
                                                                          ResolvedFields fields,
                                                                          SkillTypes.SkillManifestFile manifest,
                                                                          List<String> warnings) {
        return new SkillTypes.SkillValidationResult(
                fields.skillId,
                fields.displayName,
                fields.version,
                fields.description,
                manifest == null ? null : manifest.owner(),
                manifest == null ? List.of() : nullSafeList(manifest.tags()),
                manifest == null ? null : manifest.riskLevel(),
                manifest == null ? SKILL_MANIFEST_FILE : normalizeOrDefault(manifest.entrypointPath(), SKILL_MANIFEST_FILE),
                digestDirectory(root),
                warnings,
                manifest != null
        );
    }

    /**
     * 定位 Skill 根目录，自动处理单层子目录包裹的情况。
     *
     * @param directory 可能的 Skill 目录路径
     * @return 实际的 Skill 根目录
     */
    public static Path locateSkillRoot(Path directory) {
        return normalizeSkillRoot(directory);
    }

    /**
     * 将 Skill 目录打包为 ZIP 归档字节数组。
     *
     * @param directory       Skill 目录路径
     * @param validation      校验结果
     * @param manifestVersion 清单版本号
     * @param jsonCodec       JSON 编解码器
     * @return ZIP 归档字节数组
     */
    public static byte[] buildArchive(Path directory,
                                      SkillTypes.SkillValidationResult validation,
                                      String manifestVersion,
                                      JsonCodec jsonCodec) {
        return SkillArchiveManager.buildArchive(directory, validation, manifestVersion, jsonCodec);
    }

    /**
     * 计算 Skill 发布摘要（SHA-256），包含清单文件内容。
     *
     * @param directory       Skill 目录路径
     * @param validation      校验结果
     * @param manifestVersion 清单版本号
     * @param jsonCodec       JSON 编解码器
     * @return 十六进制格式的 SHA-256 摘要
     */
    public static String computePublishDigest(Path directory,
                                              SkillTypes.SkillValidationResult validation,
                                              String manifestVersion,
                                              JsonCodec jsonCodec) {
        return SkillArchiveManager.computePublishDigest(directory, validation, manifestVersion, jsonCodec);
    }

    /**
     * 解压 Skill ZIP 归档到指定目录。
     *
     * @param content   ZIP 归档字节数组
     * @param directory 目标目录
     */
    public static void unzipArchive(byte[] content, Path directory) {
        SkillArchiveManager.unzipArchive(content, directory);
    }

    /**
     * 将 Skill 清单文件写入指定目录。
     *
     * @param directory       目标目录
     * @param validation      校验结果
     * @param manifestVersion 清单版本号
     * @param jsonCodec       JSON 编解码器
     */
    public static void writeManifest(Path directory,
                                     SkillTypes.SkillValidationResult validation,
                                     String manifestVersion,
                                     JsonCodec jsonCodec) {
        SkillArchiveManager.writeManifest(directory, validation, manifestVersion, jsonCodec);
    }

    // ------------------------------------------------------------------
    // Package-private static helpers
    // ------------------------------------------------------------------

    /**
     * 规范化 Skill 根目录，支持自动进入单层子目录查找 SKILL.md。
     */
    static Path normalizeSkillRoot(Path directory) {
        Path root = normalizePath(directory);
        if (root == null || Files.notExists(root)) {
            throw new IllegalArgumentException("Skill 目录不存在");
        }
        if (Files.isRegularFile(root)) {
            throw new IllegalArgumentException("Skill 目录必须是文件夹");
        }
        Path direct = root.resolve(SKILL_MANIFEST_FILE);
        if (Files.exists(direct)) {
            return root;
        }
        try (var stream = Files.list(root)) {
            List<Path> candidates = stream
                    .filter(path -> Files.isDirectory(path) && Files.exists(path.resolve(SKILL_MANIFEST_FILE)))
                    .toList();
            if (candidates.size() == 1) {
                return candidates.get(0);
            }
        } catch (IOException exception) {
            throw new IllegalStateException("读取 Skill 目录失败", exception);
        }
        throw new IllegalArgumentException("Skill 目录中未找到 SKILL.md");
    }

    /**
     * 将 ZIP 字节数组解压到指定目录。
     */
    static void unzipToDirectory(byte[] content, Path directory) {
        SkillArchiveManager.unzipToDirectory(content, directory);
    }

    /**
     * 将 ZIP 字节数组解压到指定目录，使用自定义大小限制。
     */
    static void unzipToDirectory(byte[] content, Path directory, long maxSize, String contextName) {
        SkillArchiveManager.unzipToDirectory(content, directory, maxSize, contextName);
    }

    /**
     * 计算目录的 SHA-256 摘要（不含安装标记文件）。
     */
    static String digestDirectory(Path directory) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            List<Path> files;
            try (var stream = Files.walk(directory)) {
                files = stream.filter(path -> Files.isRegularFile(path)
                                && !INSTALL_MARKER_FILE.equals(path.getFileName().toString()))
                        .sorted()
                        .toList();
            }
            for (Path file : files) {
                assertNotSymbolicLink(file);
                digest.update(relativePath(directory, file).getBytes(StandardCharsets.UTF_8));
                digest.update((byte) 0);
                digest.update(Files.readAllBytes(file));
                digest.update((byte) 0);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException | IOException exception) {
            throw new IllegalStateException("计算 Skill 摘要失败", exception);
        }
    }

    private static List<Path> collectDigestFiles(Path directory) throws IOException {
        try (var stream = Files.walk(directory)) {
            return stream.filter(path -> Files.isRegularFile(path)
                            && !INSTALL_MARKER_FILE.equals(path.getFileName().toString()))
                    .sorted()
                    .toList();
        }
    }

    /**
     * 解析 SKILL.md 的 YAML frontmatter，提取 name 和 description。
     */
    static Frontmatter parseFrontmatter(String content) {
        Matcher matcher = FRONTMATTER_PATTERN.matcher(content == null ? "" : content);
        if (!matcher.find()) {
            throw new IllegalArgumentException("SKILL.md 缺少 frontmatter");
        }
        String raw = matcher.group(1);
        String name = null;
        String description = null;
        for (String line : raw.split("\\r?\\n")) {
            int index = line.indexOf(':');
            if (index <= 0) {
                continue;
            }
            String key = line.substring(0, index).trim();
            String value = line.substring(index + 1).trim();
            if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.substring(1, value.length() - 1);
            }
            if ("name".equals(key)) {
                name = normalizeNullable(value);
            } else if ("description".equals(key)) {
                description = normalizeNullable(value);
            }
        }
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("SKILL.md frontmatter 缺少 name");
        }
        if (description == null || description.isBlank()) {
            throw new IllegalArgumentException("SKILL.md frontmatter 缺少 description");
        }
        return new Frontmatter(name, description);
    }

    /**
     * 以 UTF-8 读取文件全部内容。
     */
    static String readString(Path path) {
        try {
            return Files.readString(path, StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new IllegalStateException("读取文件失败: " + path, exception);
        }
    }

    /**
     * 安静删除文件或目录，不抛出异常。
     */
    public static void deleteQuietly(Path path) {
        if (path == null || Files.notExists(path)) {
            return;
        }
        try {
            if (Files.isRegularFile(path)) {
                Files.deleteIfExists(path);
                return;
            }
            Files.walkFileTree(path, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                    Files.deleteIfExists(file);
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult postVisitDirectory(Path dir, IOException exc) throws IOException {
                    Files.deleteIfExists(dir);
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException exception) {
            log.log(System.Logger.Level.WARNING, "删除文件失败: {0}", exception.getMessage());
        }
    }

    /**
     * 将字符串转换为 URL 安全的 slug 形式。
     */
    static String slugify(String value) {
        String normalized = normalizeOrDefault(value, "skill")
                .trim()
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
        return normalized.isBlank() ? "skill" : normalized;
    }

    /**
     * 规范化字符串，为空时抛出异常。
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
     * 从归档文件名中提取备选 Skill ID（去除 .zip 后缀）。
     */
    static String normalizeArchiveFallbackId(String fileName) {
        return SkillArchiveManager.normalizeArchiveFallbackId(fileName);
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
     * 从 marker Map 中提取字符串值。
     */
    public static String markerString(Map<String, Object> marker, String key) {
        if (marker == null) {
            return null;
        }
        Object value = marker.get(key);
        return value == null ? null : String.valueOf(value);
    }

    /**
     * 构建清单文件的 JSON 字节数组。
     */
    static byte[] buildManifestBytes(SkillTypes.SkillValidationResult validation,
                                     String version,
                                     String digest,
                                     JsonCodec jsonCodec) {
        return SkillArchiveManager.buildManifestBytes(validation, version, digest, jsonCodec);
    }

    /**
     * 检测文件的 MIME 内容类型。
     */
    static String detectContentType(Path path) {
        try {
            String contentType = Files.probeContentType(path);
            if (contentType != null && !contentType.isBlank()) {
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
     * 递归构建 Skill 文件树（排除安装标记文件）。
     */
    static List<SkillTypes.SkillFileNode> buildFileTree(Path root, Path current) {
        try (var stream = Files.list(current)) {
            return stream
                    .filter(path -> !INSTALL_MARKER_FILE.equals(path.getFileName().toString()))
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
        String relativePath = relativePath(root, path);
        return new SkillTypes.SkillFileNode(
                path.getFileName().toString(),
                relativePath,
                directory,
                directory ? null : fileSize(path),
                directory ? buildFileTree(root, path) : List.of()
        );
    }

    // ------------------------------------------------------------------
    // Internal records
    // ------------------------------------------------------------------

    /**
     * SKILL.md frontmatter 解析结果。
     *
     * @param name        Skill 名称
     * @param description Skill 描述
     */
    record Frontmatter(String name, String description) {
    }

    private record SkillMdResult(String content, Frontmatter frontmatter) {
    }

    private record ResolvedFields(String skillId, String displayName, String version, String description) {
    }

    /**
     * 解析路径为绝对路径，验证必须是绝对路径。
     */
    public static Path resolveTargetRoot(String rootPath) {
        String expandedPath = expandHomeShortcut(rootPath);
        Path path = normalizePath(expandedPath);
        if (!path.isAbsolute()) {
            throw new IllegalArgumentException("SkillTarget rootPath 必须是绝对路径");
        }
        return path;
    }

    /**
     * 检查目录可写性，不可写时抛出异常。
     */
    public static boolean ensureDirectoryWritable(Path path) {
        try {
            Files.createDirectories(path);
            Path probe = path.resolve(".actiondock-write-probe-" + UUID.randomUUID());
            Files.writeString(probe, "ok", StandardCharsets.UTF_8);
            Files.deleteIfExists(probe);
            return true;
        } catch (IOException exception) {
            throw new IllegalArgumentException("SkillTarget 目录不可写: " + path);
        }
    }

    /**
     * 写入安装标记文件到指定 Skill 目录。
     *
     * @param directory      目标 Skill 目录
     * @param installationId 安装 ID
     * @param repositoryId   来源仓库 ID
     * @param validation     Skill 校验结果
     * @param jsonCodec      JSON 编解码器
     * @throws IOException 写入失败时抛出
     */
    public static void writeInstallMarker(Path directory,
                                          String installationId,
                                          String repositoryId,
                                          SkillTypes.SkillValidationResult validation,
                                          JsonCodec jsonCodec) throws IOException {
        SkillArchiveManager.writeInstallMarker(directory, installationId, repositoryId, validation, jsonCodec);
    }

    /**
     * 在指定父目录下创建临时目录。
     *
     * @param parentDir 父目录
     * @param prefix    临时目录前缀
     * @return 创建的临时目录路径
     */
    public static Path createTempDir(Path parentDir, String prefix) {
        try {
            Files.createDirectories(parentDir);
            return Files.createTempDirectory(parentDir, prefix + "-");
        } catch (IOException exception) {
            throw new IllegalStateException("创建临时 Skill 目录失败", exception);
        }
    }

    private static final int MAX_TEXT_PREVIEW_CHARS = 200_000;
    private static final long MAX_IMAGE_PREVIEW_BYTES = 2L * 1024L * 1024L;

    /**
     * 构建文件预览信息。
     */
    public static SkillTypes.SkillFilePreview buildFilePreview(Path basePath, Path target) {
        if (Files.isDirectory(target)) {
            return previewDirectory(basePath, target);
        }
        String relative = relativePath(basePath, target);
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
                relativePath(basePath, target),
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
        String text = readString(target);
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
     * 递归复制目录，拒绝符号链接。
     */
    public static void copyDirectory(Path source, Path target) throws IOException {
        Files.walkFileTree(source, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
                Path relative = source.relativize(dir);
                Path targetDir = target.resolve(relative.toString()).normalize();
                Files.createDirectories(targetDir);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                assertNotSymbolicLink(file);
                Path relative = source.relativize(file);
                Path targetFile = target.resolve(relative.toString()).normalize();
                Files.copy(file, targetFile, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.COPY_ATTRIBUTES);
                return FileVisitResult.CONTINUE;
            }
        });
    }

    /**
     * 原子性移动文件/目录，不支持时降级为普通移动。
     */
    public static void moveAtomically(Path source, Path target) throws IOException {
        try {
            Files.move(source, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException ignored) {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    /**
     * 原子替换：将源目录内容复制到临时目录，然后原子移动到目标位置。
     * 如果目标已存在，先删除目标再移动。
     * 失败时自动清理临时目录。
     *
     * @param source 源目录
     * @param target 目标目录
     */
    public static void atomicReplace(Path source, Path target) {
        Path temp = target.getParent().resolve(target.getFileName() + ".tmp-" + UUID.randomUUID());
        try {
            Files.createDirectories(target.getParent());
            copyDirectory(source, temp);
            deleteQuietly(temp.resolve(INSTALL_MARKER_FILE));
            deleteQuietly(target);
            moveAtomically(temp, target);
        } catch (IOException exception) {
            deleteQuietly(temp);
            throw new IllegalStateException("原子替换目录失败: " + target, exception);
        }
    }

    /**
     * 安全获取文件的最后修改时间，读取失败时返回 0。
     *
     * @param path 文件路径
     * @return 最后修改时间的毫秒值，读取失败返回 0
     */
    public static long safeLastModified(Path path) {
        try {
            return Files.getLastModifiedTime(path).toMillis();
        } catch (IOException exception) {
            return 0L;
        }
    }

    /**
     * 解析受管目录下的相对路径，校验路径安全性与合法性。
     *
     * @param managedPath  Skill 受管目录根路径
     * @param relativePath 相对文件路径
     * @return 解析后的目标文件路径
     */
    public static Path resolveManagedFile(Path managedPath, String relativePath) {
        String normalized = normalize(relativePath, "Skill 文件路径不能为空");
        if (normalized.startsWith("/")) {
            throw new IllegalArgumentException("Skill 文件路径非法: " + normalized);
        }
        Path target = managedPath.resolve(normalized).normalize();
        if (!target.startsWith(managedPath)) {
            throw new IllegalArgumentException("Skill 文件路径越界: " + normalized);
        }
        if (target.getFileName() != null && INSTALL_MARKER_FILE.equals(target.getFileName().toString())) {
            throw new IllegalArgumentException("Skill 文件不可预览: " + normalized);
        }
        return target;
    }

    /**
     * 读取 Skill 目录下的运行时资源文件（排除 SKILL.md、skill.json 和安装标记文件）。
     *
     * @param directory Skill 目录路径
     * @return 以相对路径为键、文件内容为值的资源映射
     */
    public static Map<String, String> readRuntimeSkillResources(Path directory) {
        Map<String, String> resources = new LinkedHashMap<>();
        try (var stream = Files.walk(directory)) {
            for (Path file : stream.filter(Files::isRegularFile).sorted().toList()) {
                assertNotSymbolicLink(file);
                String relative = relativePath(directory, file);
                if (SKILL_MANIFEST_FILE.equals(relative) || SKILL_PACKAGE_FILE.equals(relative) || INSTALL_MARKER_FILE.equals(relative)) {
                    continue;
                }
                String contentType = detectContentType(file);
                if (isTextFile(file, contentType)) {
                    resources.put(relative, Files.readString(file, StandardCharsets.UTF_8));
                }
            }
        } catch (IOException exception) {
            throw new IllegalStateException("读取 Agent Skill 资源失败: " + directory, exception);
        }
        return resources;
    }

    /**
     * 将用户提供的目录字符串解析为绝对路径，支持 ~ 主目录展开。
     *
     * @param directory 目录路径字符串
     * @return 规范化后的绝对路径
     */
    public static Path resolveDirectoryPath(String directory) {
        return resolveTargetRoot(normalize(directory, "Skill 目录不能为空"));
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

    /**
     * 对目标目录执行原子交换，将临时目录替换为最终目标目录。
     *
     * <p>若目标已存在则备份为 .bak-UUID，然后将 tmp 移动为目标，最后删除备份。
     * 失败时清理临时目录。</p>
     *
     * @param targetDir 最终目标目录
     * @param tempDir   临时目录（已准备好的内容）
     * @throws IOException 文件操作失败
     */
    public static void swapTempToTarget(Path targetDir, Path tempDir) throws IOException {
        Path backupDir = targetDir.getParent().resolve(targetDir.getFileName() + ".bak-" + UUID.randomUUID());
        try {
            if (Files.exists(targetDir)) {
                moveAtomically(targetDir, backupDir);
            }
            moveAtomically(tempDir, targetDir);
            deleteQuietly(backupDir);
        } catch (IOException exception) {
            deleteQuietly(tempDir);
            throw exception;
        }
    }

    /**
     * 在目标目录的父级创建带 .tmp-UUID 后缀的临时目录路径。
     */
    public static Path tempDirectoryFor(Path targetDir) {
        return targetDir.getParent().resolve(targetDir.getFileName() + ".tmp-" + UUID.randomUUID());
    }
}
