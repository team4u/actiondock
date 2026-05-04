package org.team4u.actiondock.skill;

import org.team4u.actiondock.domain.port.JsonCodec;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
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
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Skill 文件操作静态工具类。
 *
 * <p>提供 Skill 目录校验、归档打包/解压、摘要计算、清单写入、
 * 文件树构建等与磁盘 I/O 相关的纯函数工具方法，
 * 从 {@link SkillService} 中提取以便复用与测试。</p>
 */
public final class SkillFileUtils {

    private static final Pattern FRONTMATTER_PATTERN = Pattern.compile("^---\\s*\\n(.*?)\\n---\\s*(?:\\n|$)", Pattern.DOTALL);
    static final String INSTALL_MARKER_FILE = ".actiondock-skill-install.json";
    static final long MAX_ARCHIVE_SIZE = 25L * 1024L * 1024L;

    private SkillFileUtils() {
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
    public static SkillService.SkillValidationResult validateSkillDirectory(Path directory,
                                                                            String fallbackId,
                                                                            boolean requireManifest,
                                                                            JsonCodec jsonCodec) {
        Path root = normalizeSkillRoot(directory);
        Path manifestPath = root.resolve("skill.json");
        Path skillMdPath = root.resolve("SKILL.md");
        if (Files.notExists(skillMdPath)) {
            throw new IllegalArgumentException("Skill 缺少 SKILL.md");
        }
        String content = readString(skillMdPath);
        Frontmatter frontmatter = parseFrontmatter(content);
        SkillService.SkillManifestFile manifest = Files.exists(manifestPath)
                ? jsonCodec.read(readString(manifestPath), SkillService.SkillManifestFile.class)
                : null;
        if (requireManifest && manifest == null) {
            throw new IllegalArgumentException("Skill 缺少 skill.json");
        }
        String skillId = manifest == null
                ? normalizeOrDefault(normalizeNullable(fallbackId), slugify(frontmatter.name()))
                : normalize(manifest.skillId(), "skillId 不能为空");
        String displayName = manifest == null
                ? normalizeOrDefault(frontmatter.name(), skillId)
                : normalize(manifest.displayName(), "displayName 不能为空");
        String version = manifest == null
                ? "1.0.0"
                : normalize(manifest.version(), "version 不能为空");
        String description = manifest == null
                ? normalize(frontmatter.description(), "frontmatter description 不能为空")
                : normalize(manifest.description(), "description 不能为空");
        List<String> warnings = new ArrayList<>();
        if (frontmatter.name() != null && !Objects.equals(slugify(frontmatter.name()), skillId)) {
            warnings.add("frontmatter name 规范化后与 skillId 不一致");
        }
        if (content.length() > 100_000) {
            warnings.add("SKILL.md 较大，建议拆分 references");
        }
        return new SkillService.SkillValidationResult(
                skillId,
                displayName,
                version,
                description,
                manifest == null ? null : manifest.owner(),
                manifest == null || manifest.tags() == null ? List.of() : manifest.tags(),
                manifest == null ? null : manifest.riskLevel(),
                manifest == null ? "SKILL.md" : normalizeOrDefault(manifest.entrypointPath(), "SKILL.md"),
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
                                      SkillService.SkillValidationResult validation,
                                      String manifestVersion,
                                      JsonCodec jsonCodec) {
        Path root = normalizeSkillRoot(directory);
        String version = normalize(manifestVersion, "version 不能为空");
        String digest = computePublishDigest(root, validation, version, jsonCodec);
        byte[] manifestBytes = buildManifestBytes(validation, version, digest, jsonCodec);
        String rootPrefix = validation.skillId() + "/";
        try (ByteArrayOutputStream output = new ByteArrayOutputStream();
             ZipOutputStream zip = new ZipOutputStream(output, StandardCharsets.UTF_8)) {
            zip.putNextEntry(new ZipEntry(rootPrefix + "skill.json"));
            zip.write(manifestBytes);
            zip.closeEntry();
            try (var stream = Files.walk(root)) {
                for (Path file : stream.filter(Files::isRegularFile).sorted().toList()) {
                    if (Files.isSymbolicLink(file)) {
                        throw new IllegalArgumentException("Skill 不允许包含符号链接: " + file);
                    }
                    String relative = root.relativize(file).toString().replace('\\', '/');
                    if (INSTALL_MARKER_FILE.equals(relative) || "skill.json".equals(relative)) {
                        continue;
                    }
                    zip.putNextEntry(new ZipEntry(rootPrefix + relative));
                    zip.write(Files.readAllBytes(file));
                    zip.closeEntry();
                }
            }
            zip.finish();
            return output.toByteArray();
        } catch (IOException exception) {
            throw new IllegalStateException("打包 Skill 归档失败", exception);
        }
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
                                              SkillService.SkillValidationResult validation,
                                              String manifestVersion,
                                              JsonCodec jsonCodec) {
        Path root = normalizeSkillRoot(directory);
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            boolean manifestSeen = false;
            try (var stream = Files.walk(root)) {
                for (Path file : stream.filter(Files::isRegularFile).sorted().toList()) {
                    if (Files.isSymbolicLink(file)) {
                        throw new IllegalArgumentException("Skill 不允许包含符号链接: " + file);
                    }
                    String relative = root.relativize(file).toString().replace('\\', '/');
                    if (INSTALL_MARKER_FILE.equals(relative)) {
                        continue;
                    }
                    digest.update(relative.getBytes(StandardCharsets.UTF_8));
                    digest.update((byte) 0);
                    if ("skill.json".equals(relative)) {
                        manifestSeen = true;
                        digest.update(buildManifestBytes(validation, manifestVersion, null, jsonCodec));
                    } else {
                        digest.update(Files.readAllBytes(file));
                    }
                    digest.update((byte) 0);
                }
            }
            if (!manifestSeen) {
                digest.update("skill.json".getBytes(StandardCharsets.UTF_8));
                digest.update((byte) 0);
                digest.update(buildManifestBytes(validation, manifestVersion, null, jsonCodec));
                digest.update((byte) 0);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException | IOException exception) {
            throw new IllegalStateException("计算 Skill 发布摘要失败", exception);
        }
    }

    /**
     * 解压 Skill ZIP 归档到指定目录。
     *
     * @param content   ZIP 归档字节数组
     * @param directory 目标目录
     */
    public static void unzipArchive(byte[] content, Path directory) {
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("Skill 压缩包不能为空");
        }
        if (content.length > MAX_ARCHIVE_SIZE) {
            throw new IllegalArgumentException("Skill 压缩包过大，超过 25MB");
        }
        unzipToDirectory(content, directory);
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
                                     SkillService.SkillValidationResult validation,
                                     String manifestVersion,
                                     JsonCodec jsonCodec) {
        String version = normalize(manifestVersion, "version 不能为空");
        String digest = computePublishDigest(directory, validation, version, jsonCodec);
        try {
            Files.write(directory.resolve("skill.json"), buildManifestBytes(validation, version, digest, jsonCodec));
        } catch (IOException exception) {
            throw new IllegalStateException("写入 Skill 清单失败", exception);
        }
    }

    // ------------------------------------------------------------------
    // Package-private static helpers
    // ------------------------------------------------------------------

    /**
     * 规范化 Skill 根目录，支持自动进入单层子目录查找 SKILL.md。
     */
    static Path normalizeSkillRoot(Path directory) {
        Path root = directory == null ? null : directory.toAbsolutePath().normalize();
        if (root == null || Files.notExists(root)) {
            throw new IllegalArgumentException("Skill 目录不存在");
        }
        if (Files.isRegularFile(root)) {
            throw new IllegalArgumentException("Skill 目录必须是文件夹");
        }
        Path direct = root.resolve("SKILL.md");
        if (Files.exists(direct)) {
            return root;
        }
        try (var stream = Files.list(root)) {
            List<Path> candidates = stream
                    .filter(Files::isDirectory)
                    .filter(path -> Files.exists(path.resolve("SKILL.md")))
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
        try {
            Files.createDirectories(directory);
            try (InputStream inputStream = new java.io.ByteArrayInputStream(content);
                 ZipInputStream zipInputStream = new ZipInputStream(inputStream, StandardCharsets.UTF_8)) {
                ZipEntry entry;
                long totalBytes = 0L;
                while ((entry = zipInputStream.getNextEntry()) != null) {
                    if (entry.getName() == null || entry.getName().isBlank()) {
                        continue;
                    }
                    String entryName = entry.getName().replace('\\', '/');
                    if (entryName.startsWith("/") || entryName.contains("../") || entryName.contains("..\\")) {
                        throw new IllegalArgumentException("Skill 压缩包包含非法路径: " + entry.getName());
                    }
                    Path target = directory.resolve(entryName).normalize();
                    if (!target.toAbsolutePath().startsWith(directory.toAbsolutePath())) {
                        throw new IllegalArgumentException("Skill 压缩包越界写入被拒绝: " + entry.getName());
                    }
                    if (entry.isDirectory()) {
                        Files.createDirectories(target);
                        continue;
                    }
                    Files.createDirectories(target.getParent());
                    totalBytes += Math.max(0L, entry.getSize());
                    if (totalBytes > MAX_ARCHIVE_SIZE) {
                        throw new IllegalArgumentException("Skill 压缩包解压后过大，超过 25MB");
                    }
                    Files.copy(zipInputStream, target, StandardCopyOption.REPLACE_EXISTING);
                }
            }
        } catch (IOException exception) {
            throw new IllegalStateException("解压 Skill 压缩包失败", exception);
        }
    }

    /**
     * 计算目录的 SHA-256 摘要（不含安装标记文件）。
     */
    static String digestDirectory(Path directory) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            List<Path> files;
            try (var stream = Files.walk(directory)) {
                files = stream.filter(Files::isRegularFile)
                        .filter(path -> !INSTALL_MARKER_FILE.equals(path.getFileName().toString()))
                        .sorted()
                        .toList();
            }
            for (Path file : files) {
                if (Files.isSymbolicLink(file)) {
                    throw new IllegalArgumentException("Skill 不允许包含符号链接: " + file);
                }
                digest.update(directory.relativize(file).toString().replace('\\', '/').getBytes(StandardCharsets.UTF_8));
                digest.update((byte) 0);
                digest.update(Files.readAllBytes(file));
                digest.update((byte) 0);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException | IOException exception) {
            throw new IllegalStateException("计算 Skill 摘要失败", exception);
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
    static void deleteQuietly(Path path) {
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
        } catch (IOException ignored) {
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
    static String normalize(String value, String message) {
        String normalized = normalizeNullable(value);
        if (normalized == null) {
            throw new IllegalArgumentException(message);
        }
        return normalized;
    }

    /**
     * 规范化可空字符串，为空返回 null。
     */
    static String normalizeNullable(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    /**
     * 规范化字符串，为空时返回默认值。
     */
    static String normalizeOrDefault(String value, String defaultValue) {
        String normalized = normalizeNullable(value);
        return normalized == null ? defaultValue : normalized;
    }

    /**
     * 从归档文件名中提取备选 Skill ID（去除 .zip 后缀）。
     */
    static String normalizeArchiveFallbackId(String fileName) {
        String normalized = normalizeNullable(fileName);
        if (normalized == null) {
            return null;
        }
        if (normalized.toLowerCase(Locale.ROOT).endsWith(".zip")) {
            normalized = normalized.substring(0, normalized.length() - 4);
        }
        return normalizeNullable(normalized);
    }

    /**
     * 构建清单文件的 JSON 字节数组。
     */
    static byte[] buildManifestBytes(SkillService.SkillValidationResult validation,
                                     String version,
                                     String digest,
                                     JsonCodec jsonCodec) {
        return jsonCodec.write(new SkillService.SkillManifestFile(
                1,
                validation.skillId(),
                validation.displayName(),
                normalize(version, "version 不能为空"),
                validation.description(),
                validation.owner(),
                validation.tags() == null ? List.of() : validation.tags(),
                validation.riskLevel(),
                normalizeOrDefault(validation.entrypointPath(), "SKILL.md"),
                digest
        )).getBytes(StandardCharsets.UTF_8);
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
        } catch (IOException ignored) {
        }
        String fileName = path.getFileName().toString().toLowerCase(Locale.ROOT);
        if (fileName.endsWith(".md")) {
            return "text/markdown";
        }
        if (fileName.endsWith(".json")) {
            return "application/json";
        }
        if (fileName.endsWith(".yaml") || fileName.endsWith(".yml")) {
            return "application/yaml";
        }
        if (fileName.endsWith(".txt")) {
            return "text/plain";
        }
        if (fileName.endsWith(".png")) {
            return "image/png";
        }
        if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) {
            return "image/jpeg";
        }
        if (fileName.endsWith(".gif")) {
            return "image/gif";
        }
        if (fileName.endsWith(".webp")) {
            return "image/webp";
        }
        return "application/octet-stream";
    }

    /**
     * 判断文件是否为文本类型。
     */
    static boolean isTextFile(Path path, String contentType) {
        if (contentType.startsWith("text/")) {
            return true;
        }
        String fileName = path.getFileName().toString().toLowerCase(Locale.ROOT);
        return fileName.endsWith(".md")
                || fileName.endsWith(".json")
                || fileName.endsWith(".yaml")
                || fileName.endsWith(".yml")
                || fileName.endsWith(".txt");
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
    static List<SkillService.SkillFileNode> buildFileTree(Path root, Path current) {
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
    static SkillService.SkillFileNode toFileNode(Path root, Path path) {
        boolean directory = Files.isDirectory(path);
        String relativePath = root.relativize(path).toString().replace('\\', '/');
        return new SkillService.SkillFileNode(
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
}
