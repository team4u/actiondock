package org.team4u.actiondock.skill;

import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.common.NormalizeUtils;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Skill 文件操作静态工具类。
 *
 * <p>提供 Skill 目录校验、归档打包/解压、摘要计算、路径处理等
 * 与磁盘 I/O 相关的纯函数工具方法，
 * 从 {@link SkillService} 中提取以便复用与测试。</p>
 */
public final class SkillFileUtils {

    private static final System.Logger log = System.getLogger(SkillFileUtils.class.getName());

    public static final String INSTALL_MARKER_FILE = ".actiondock-skill-install.json";
    public static final String SKILL_MANIFEST_FILE = "SKILL.md";
    public static final String SKILL_PACKAGE_FILE = SkillArchiveManager.SKILL_PACKAGE_FILE;
    static final long MAX_ARCHIVE_SIZE = SkillArchiveManager.MAX_ARCHIVE_SIZE;
    public static final String ERR_VERSION_REQUIRED = "version 不能为空";
    private static final Set<String> SKIP_FILES = Set.of(SKILL_MANIFEST_FILE, SKILL_PACKAGE_FILE, INSTALL_MARKER_FILE);

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
        return SkillManifestReader.validateSkillDirectory(directory, fallbackId, requireManifest, jsonCodec);
    }

    /**
     * 定位 Skill 根目录，自动处理单层子目录包裹的情况。
     *
     * @param directory 可能的 Skill 目录路径
     * @return 实际的 Skill 根目录
     */
    public static Path locateSkillRoot(Path directory) {
        return SkillManifestReader.locateSkillRoot(directory);
    }

    // ------------------------------------------------------------------
    // Package-private static helpers
    // ------------------------------------------------------------------

    /**
     * 规范化 Skill 根目录，支持自动进入单层子目录查找 SKILL.md。
     */
    static Path normalizeSkillRoot(Path directory) {
        return SkillManifestReader.normalizeSkillRoot(directory);
    }

    /**
     * 计算目录的 SHA-256 摘要（不含安装标记文件）。
     */
    static String digestDirectory(Path directory) {
        return SkillManifestReader.digestDirectory(directory);
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
            deleteRecursively(path);
        } catch (IOException exception) {
            log.log(System.Logger.Level.WARNING, "删除文件失败: {0}", exception.getMessage());
        }
    }

    /**
     * 递归删除文件或目录，失败时抛出异常。
     */
    static void deleteRecursively(Path path) throws IOException {
        if (path == null || Files.notExists(path)) {
            return;
        }
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
                if (exc != null) {
                    throw exc;
                }
                Files.deleteIfExists(dir);
                return FileVisitResult.CONTINUE;
            }
        });
    }

    /**
     * 从 marker Map 中提取字符串值。
     */
    static String markerString(Map<String, Object> marker, String key) {
        if (marker == null) {
            return null;
        }
        Object value = marker.get(key);
        return value == null ? null : String.valueOf(value);
    }

    /**
     * 解析路径为绝对路径，验证必须是绝对路径。
     */
    static Path resolveTargetRoot(String rootPath) {
        String expandedPath = NormalizeUtils.expandHomeShortcut(rootPath);
        Path path = NormalizeUtils.normalizePath(expandedPath);
        if (!path.isAbsolute()) {
            throw new IllegalArgumentException("SkillTarget rootPath 必须是绝对路径");
        }
        return path;
    }

    /**
     * 检查目录可写性，不可写时抛出异常。
     */
    static boolean ensureDirectoryWritable(Path path) {
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
     * 在指定父目录下创建临时目录。
     *
     * @param parentDir 父目录
     * @param prefix    临时目录前缀
     * @return 创建的临时目录路径
     */
    static Path createTempDir(Path parentDir, String prefix) {
        try {
            Files.createDirectories(parentDir);
            return Files.createTempDirectory(parentDir, prefix + "-");
        } catch (IOException exception) {
            throw new IllegalStateException("创建临时 Skill 目录失败", exception);
        }
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
    static void atomicReplace(Path source, Path target) {
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
     */
    static long safeLastModified(Path path) {
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
    static Path resolveManagedFile(Path managedPath, String relativePath) {
        String normalized = NormalizeUtils.normalize(relativePath, "Skill 文件路径不能为空");
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
    static Map<String, String> readRuntimeSkillResources(Path directory) {
        Map<String, String> resources = new LinkedHashMap<>();
        try (var stream = Files.walk(directory)) {
            for (Path file : stream.filter(Files::isRegularFile).sorted().toList()) {
                assertNotSymbolicLink(file);
                String relative = relativePath(directory, file);
                if (SKIP_FILES.contains(relative)) {
                    continue;
                }
                String contentType = SkillFilePreviewBuilder.detectContentType(file);
                if (SkillFilePreviewBuilder.isTextFile(file, contentType)) {
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
    static Path resolveDirectoryPath(String directory) {
        return resolveTargetRoot(NormalizeUtils.normalize(directory, "Skill 目录不能为空"));
    }

    /**
     * 删除旧目标目录后，将临时目录移动为最终目标目录。
     *
     * @param targetDir 最终目标目录
     * @param tempDir   临时目录（已准备好的内容）
     * @throws IOException 文件操作失败
     */
    public static void swapTempToTarget(Path targetDir, Path tempDir) throws IOException {
        try {
            if (Files.exists(targetDir)) {
                deleteRecursively(targetDir);
            }
            moveAtomically(tempDir, targetDir);
        } catch (IOException exception) {
            deleteQuietly(tempDir);
            throw exception;
        }
    }

    /**
     * 在目标目录的父级创建带 .tmp-UUID 后缀的临时目录路径。
     */
    public static Path tempDirectoryFor(Path targetDir) {
        cleanupSwapResiduals(targetDir);
        return targetDir.getParent().resolve(targetDir.getFileName() + ".tmp-" + UUID.randomUUID());
    }

    private static void cleanupSwapResiduals(Path targetDir) {
        Path parent = targetDir.getParent();
        Path fileName = targetDir.getFileName();
        if (parent == null || fileName == null || Files.notExists(parent)) {
            return;
        }
        String prefix = fileName + ".";
        try (var stream = Files.list(parent)) {
            stream.filter(path -> {
                        String name = path.getFileName().toString();
                        return name.startsWith(prefix) && (name.contains(".tmp-") || name.contains(".bak-"));
                    })
                    .forEach(SkillFileUtils::deleteQuietly);
        } catch (IOException exception) {
            log.log(System.Logger.Level.WARNING, "清理 Skill 临时目录失败: {0}", exception.getMessage());
        }
    }
}
