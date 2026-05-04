package org.team4u.actiondock.skill;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.annotation.JsonAlias;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.SkillInstallation;
import org.team4u.actiondock.domain.model.SkillTarget;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.SkillInstallationRepository;
import org.team4u.actiondock.domain.port.SkillTargetRepository;

import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * 本地 Skill 目标与安装服务。
 */
public class SkillService {
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper().findAndRegisterModules();
    private static final Pattern FRONTMATTER_PATTERN = Pattern.compile("^---\\s*\\n(.*?)\\n---\\s*(?:\\n|$)", Pattern.DOTALL);
    private static final String INSTALL_MARKER_FILE = ".actiondock-skill-install.json";
    private static final long MAX_ARCHIVE_SIZE = 25L * 1024L * 1024L;
    private static final int MAX_TEXT_PREVIEW_CHARS = 200_000;
    private static final long MAX_IMAGE_PREVIEW_BYTES = 2L * 1024L * 1024L;

    private final SkillTargetRepository skillTargetRepository;
    private final SkillInstallationRepository skillInstallationRepository;
    private final JsonCodec jsonCodec;
    private final Path managedSkillsRoot;

    public SkillService(SkillTargetRepository skillTargetRepository,
                        SkillInstallationRepository skillInstallationRepository,
                        JsonCodec jsonCodec,
                        AppProperties properties) {
        this.skillTargetRepository = skillTargetRepository;
        this.skillInstallationRepository = skillInstallationRepository;
        this.jsonCodec = jsonCodec;
        String root = properties == null || properties.getSkills().getDir() == null || properties.getSkills().getDir().isBlank()
                ? AppProperties.defaultSkillsDir()
                : properties.getSkills().getDir();
        this.managedSkillsRoot = Path.of(root).toAbsolutePath().normalize();
    }

    public List<SkillTarget> listTargets() {
        return skillTargetRepository.findAll().stream()
                .sorted(Comparator.comparing(SkillTarget::getName, Comparator.nullsLast(String::compareToIgnoreCase)))
                .toList();
    }

    public SkillTarget saveTarget(SkillTarget request) {
        SkillTarget target = request == null ? new SkillTarget() : request;
        String id = normalizeOrDefault(target.getId(), UUID.randomUUID().toString());
        String name = normalize(target.getName(), "SkillTarget 名称不能为空");
        String type = normalizeOrDefault(target.getType(), "CUSTOM").toUpperCase(Locale.ROOT);
        if (!List.of("CODEX", "CLAUDE", "GEMINI", "CODEBUDDY", "CUSTOM", "ACTIONDOCK_AGENT").contains(type)) {
            throw new IllegalArgumentException("SkillTarget type 仅支持 CODEX / CLAUDE / GEMINI / CODEBUDDY / CUSTOM / ACTIONDOCK_AGENT");
        }
        Path rootPath = resolveTargetRoot(normalize(target.getRootPath(), "SkillTarget rootPath 不能为空"));
        boolean writable = ensureDirectoryWritable(rootPath);
        LocalDateTime now = LocalDateTime.now();
        SkillTarget existing = skillTargetRepository.findById(id).orElse(null);
        return skillTargetRepository.save(new SkillTarget()
                .setId(id)
                .setName(name)
                .setType(type)
                .setRootPath(rootPath.toString())
                .setEnabled(target.isEnabled() || existing == null)
                .setWritable(writable)
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now));
    }

    public void deleteTarget(String id) {
        SkillTarget target = requireTarget(id);
        List<SkillInstallation> installations = skillInstallationRepository.findByTargetId(target.getId());
        if (!installations.isEmpty()) {
            throw new IllegalArgumentException("目标目录仍有已安装 Skill，不能删除: " + target.getName());
        }
        skillTargetRepository.deleteById(id);
    }

    public List<SkillScanItem> scanTarget(String targetId) {
        SkillTarget target = requireTarget(targetId);
        Path root = resolveTargetRoot(target.getRootPath());
        try {
            if (Files.notExists(root)) {
                Files.createDirectories(root);
            }
            Map<String, SkillInstallation> pathToInstallation = skillInstallationRepository.findByTargetId(targetId).stream()
                    .collect(Collectors.toMap(SkillInstallation::getInstalledPath, i -> i, (a, b) -> a));
            List<SkillScanItem> items = new ArrayList<>();
            try (var stream = Files.list(root)) {
                for (Path child : stream.filter(Files::isDirectory).sorted().toList()) {
                    Path skillMd = child.resolve("SKILL.md");
                    if (Files.notExists(skillMd)) {
                        continue;
                    }
                    String content = Files.readString(skillMd, StandardCharsets.UTF_8);
                    Frontmatter frontmatter = parseFrontmatter(content);
                    boolean managed = Files.exists(child.resolve(INSTALL_MARKER_FILE));
                    String installationId = null;
                    Boolean enabled = null;
                    String version = null;
                    if (managed) {
                        SkillInstallation installation = pathToInstallation.get(child.toString());
                        if (installation != null) {
                            installationId = installation.getInstallationId();
                            enabled = installation.isEnabled();
                            version = installation.getVersion();
                        }
                    }
                    items.add(new SkillScanItem(
                            child.getFileName().toString(),
                            child.toString(),
                            frontmatter.name(),
                            frontmatter.description(),
                            managed,
                            installationId,
                            enabled,
                            version
                    ));
                }
            }
            return items;
        } catch (IOException exception) {
            throw new IllegalStateException("扫描 Skill 目标失败: " + target.getRootPath(), exception);
        }
    }

    public SkillScanDetail getScanItemDetail(String targetId, String directoryId) {
        SkillTarget target = requireTarget(targetId);
        Path root = resolveTargetRoot(target.getRootPath());
        Path dir = resolveScanDirectory(root, directoryId);
        String content = readString(dir.resolve("SKILL.md"));
        Frontmatter frontmatter = parseFrontmatter(content);
        boolean managed = Files.exists(dir.resolve(INSTALL_MARKER_FILE));
        String installationId = null;
        Boolean enabled = null;
        String version = null;
        if (managed) {
            Map<String, SkillInstallation> pathToInstallation = skillInstallationRepository.findByTargetId(targetId).stream()
                    .collect(Collectors.toMap(SkillInstallation::getInstalledPath, i -> i, (a, b) -> a));
            SkillInstallation installation = pathToInstallation.get(dir.toString());
            if (installation != null) {
                installationId = installation.getInstallationId();
                enabled = installation.isEnabled();
                version = installation.getVersion();
            }
        }
        return new SkillScanDetail(
                dir.getFileName().toString(),
                dir.toString(),
                frontmatter.name(),
                frontmatter.description(),
                managed,
                installationId,
                enabled,
                version,
                buildFileTree(dir, dir)
        );
    }

    public SkillFilePreview previewScanItemFile(String targetId, String directoryId, String relativePath) {
        SkillTarget skillTarget = requireTarget(targetId);
        Path root = resolveTargetRoot(skillTarget.getRootPath());
        Path dir = resolveScanDirectory(root, directoryId);
        Path file = resolveScanFile(dir, relativePath);
        if (Files.notExists(file)) {
            throw new IllegalArgumentException("Skill 文件不存在: " + relativePath);
        }
        if (Files.isDirectory(file)) {
            return new SkillFilePreview(
                    dir.relativize(file).toString().replace('\\', '/'),
                    file.getFileName().toString(),
                    true,
                    detectContentType(file),
                    fileSize(file),
                    "DIRECTORY",
                    null, null, null, false
            );
        }
        String relative = dir.relativize(file).toString().replace('\\', '/');
        String contentType = detectContentType(file);
        long size = fileSize(file);
        if (isImageFile(contentType)) {
            if (size > MAX_IMAGE_PREVIEW_BYTES) {
                return new SkillFilePreview(relative, file.getFileName().toString(), false, contentType, size, "UNSUPPORTED", null, null, null, true);
            }
            try {
                String dataUrl = "data:" + contentType + ";base64," + Base64.getEncoder().encodeToString(Files.readAllBytes(file));
                return new SkillFilePreview(relative, file.getFileName().toString(), false, contentType, size, "IMAGE", null, null, dataUrl, false);
            } catch (IOException exception) {
                throw new IllegalStateException("读取 Skill 文件失败: " + relativePath, exception);
            }
        }
        if (!isTextFile(file, contentType)) {
            return new SkillFilePreview(relative, file.getFileName().toString(), false, contentType, size, "UNSUPPORTED", null, null, null, false);
        }
        String text = readString(file);
        boolean truncated = text.length() > MAX_TEXT_PREVIEW_CHARS;
        return new SkillFilePreview(
                relative,
                file.getFileName().toString(),
                false,
                contentType,
                size,
                resolvePreviewType(file),
                resolveLanguage(file),
                truncated ? text.substring(0, MAX_TEXT_PREVIEW_CHARS) : text,
                null,
                truncated
        );
    }

    public void deleteUnmanagedScanDirectory(String targetId, String directoryId) {
        SkillTarget target = requireTarget(targetId);
        Path root = resolveTargetRoot(target.getRootPath());
        Path dir = resolveScanDirectory(root, directoryId);
        if (Files.exists(dir.resolve(INSTALL_MARKER_FILE))) {
            throw new IllegalArgumentException("受管 Skill 目录请使用卸载功能: " + directoryId);
        }
        deleteQuietly(dir);
    }

    private Path resolveScanDirectory(Path root, String directoryId) {
        String normalized = normalize(directoryId, "目录 ID 不能为空");
        Path dir = root.resolve(normalized).toAbsolutePath().normalize();
        if (!dir.startsWith(root)) {
            throw new IllegalArgumentException("目录路径越界: " + directoryId);
        }
        if (Files.notExists(dir) || !Files.isDirectory(dir)) {
            throw new IllegalArgumentException("目录不存在: " + directoryId);
        }
        if (Files.notExists(dir.resolve("SKILL.md"))) {
            throw new IllegalArgumentException("不是有效的 Skill 目录: " + directoryId);
        }
        return dir;
    }

    private Path resolveScanFile(Path scanDir, String relativePath) {
        String normalized = normalize(relativePath, "Skill 文件路径不能为空");
        if (normalized.startsWith("/")) {
            throw new IllegalArgumentException("Skill 文件路径非法: " + normalized);
        }
        Path target = scanDir.resolve(normalized).normalize();
        if (!target.startsWith(scanDir)) {
            throw new IllegalArgumentException("Skill 文件路径越界: " + normalized);
        }
        return target;
    }

    public List<SkillInstallation> listInstallations() {
        return skillInstallationRepository.findAll().stream()
                .sorted(Comparator.comparing(SkillInstallation::getInstalledAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .toList();
    }

    public SkillInstallation getInstallation(String installationId) {
        return skillInstallationRepository.findByInstallationId(installationId)
                .orElseThrow(() -> new IllegalArgumentException("Skill 安装记录不存在: " + installationId));
    }

    public SkillInstallation disableInstallation(String installationId) {
        SkillInstallation installation = getInstallation(installationId);
        Path installedPath = Path.of(installation.getInstalledPath()).toAbsolutePath().normalize();
        if (Files.exists(installedPath) && Files.notExists(installedPath.resolve(INSTALL_MARKER_FILE))) {
            throw new IllegalArgumentException("仅允许停用 ActionDock 受管 Skill: " + installation.getInstalledPath());
        }
        deleteQuietly(installedPath);
        return skillInstallationRepository.save(new SkillInstallation()
                .setInstallationId(installation.getInstallationId())
                .setSkillId(installation.getSkillId())
                .setRepositoryId(installation.getRepositoryId())
                .setVersion(installation.getVersion())
                .setTargetId(installation.getTargetId())
                .setTargetPath(installation.getTargetPath())
                .setInstalledPath(installation.getInstalledPath())
                .setDigest(installation.getDigest())
                .setDisplayName(installation.getDisplayName())
                .setDescription(installation.getDescription())
                .setEnabled(false)
                .setInstalledAt(installation.getInstalledAt())
                .setUpdatedAt(LocalDateTime.now()));
    }

    public SkillInstallation restoreInstallation(String installationId) {
        SkillInstallation installation = getInstallation(installationId);
        Path managedPath = resolveManagedPath(installation);
        if (Files.notExists(managedPath.resolve("SKILL.md"))) {
            throw new IllegalArgumentException("Skill 受管副本不存在，无法恢复: " + installation.getSkillId());
        }
        SkillValidationResult validation = validateDirectory(managedPath, installation.getSkillId(), false);
        return installValidatedDirectory(installation.getTargetId(), managedPath, validation, installation.getRepositoryId(), installation);
    }

    public SkillDetail getInstallationDetail(String installationId) {
        SkillInstallation installation = getInstallation(installationId);
        Path managedPath = resolveManagedPath(installation);
        return new SkillDetail(
                installation,
                managedPath.toString(),
                Files.exists(managedPath) ? buildFileTree(managedPath, managedPath) : List.of()
        );
    }

    public SkillArchive exportInstallationArchive(String installationId) {
        SkillInstallation installation = getInstallation(installationId);
        Path managedPath = resolveManagedPath(installation);
        SkillValidationResult validation = validateSkillDirectory(managedPath, installation.getSkillId(), false, jsonCodec);
        return new SkillArchive(
                validation.skillId() + ".zip",
                buildArchive(managedPath, validation, validation.version(), jsonCodec)
        );
    }

    public SkillFilePreview previewInstallationFile(String installationId, String relativePath) {
        SkillInstallation installation = getInstallation(installationId);
        Path managedPath = resolveManagedPath(installation);
        Path target = resolveManagedFile(managedPath, relativePath);
        if (Files.notExists(target)) {
            throw new IllegalArgumentException("Skill 文件不存在: " + relativePath);
        }
        if (Files.isDirectory(target)) {
            return new SkillFilePreview(
                    managedPath.relativize(target).toString().replace('\\', '/'),
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
        String relative = managedPath.relativize(target).toString().replace('\\', '/');
        String contentType = detectContentType(target);
        long size = fileSize(target);
        if (isImageFile(contentType)) {
            if (size > MAX_IMAGE_PREVIEW_BYTES) {
                return new SkillFilePreview(relative, target.getFileName().toString(), false, contentType, size, "UNSUPPORTED", null, null, null, true);
            }
            try {
                String dataUrl = "data:" + contentType + ";base64," + Base64.getEncoder().encodeToString(Files.readAllBytes(target));
                return new SkillFilePreview(relative, target.getFileName().toString(), false, contentType, size, "IMAGE", null, null, dataUrl, false);
            } catch (IOException exception) {
                throw new IllegalStateException("读取 Skill 文件失败: " + relativePath, exception);
            }
        }
        if (!isTextFile(target, contentType)) {
            return new SkillFilePreview(relative, target.getFileName().toString(), false, contentType, size, "UNSUPPORTED", null, null, null, false);
        }
        String text = readString(target);
        boolean truncated = text.length() > MAX_TEXT_PREVIEW_CHARS;
        String previewType = resolvePreviewType(target);
        return new SkillFilePreview(
                relative,
                target.getFileName().toString(),
                false,
                contentType,
                size,
                previewType,
                resolveLanguage(target),
                truncated ? text.substring(0, MAX_TEXT_PREVIEW_CHARS) : text,
                null,
                truncated
        );
    }

    public SkillValidationResult validateImport(String fileName, byte[] content) {
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("Skill 压缩包不能为空");
        }
        if (content.length > MAX_ARCHIVE_SIZE) {
            throw new IllegalArgumentException("Skill 压缩包过大，超过 25MB");
        }
        Path tempDir = createTempDir("skill-validate");
        try {
            unzipToDirectory(content, tempDir);
            return validateDirectory(tempDir, normalizeArchiveFallbackId(fileName), false);
        } finally {
            deleteQuietly(tempDir);
        }
    }

    public SkillValidationResult validateDirectory(Path directory) {
        return validateDirectory(directory, directory == null ? null : directory.getFileName().toString(), true);
    }

    public SkillPackageResult packageDirectory(Path directory) {
        SkillValidationResult result = validateDirectory(directory);
        return new SkillPackageResult(result, directory.toAbsolutePath().normalize().toString());
    }

    public SkillPackageResult packageDirectory(String directory) {
        Path path = resolveDirectoryPath(directory);
        return packageDirectory(path);
    }

    public SkillInstallation installFromZip(String targetId, String fileName, byte[] content) {
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("Skill 压缩包不能为空");
        }
        if (content.length > MAX_ARCHIVE_SIZE) {
            throw new IllegalArgumentException("Skill 压缩包过大，超过 25MB");
        }
        Path tempDir = createTempDir("skill-import");
        try {
            unzipToDirectory(content, tempDir);
            SkillValidationResult validation = validateDirectory(tempDir, normalizeArchiveFallbackId(fileName), false);
            return installValidatedDirectory(targetId, tempDir, validation, null);
        } finally {
            deleteQuietly(tempDir);
        }
    }

    public SkillInstallation installFromDirectory(String targetId, String directory) {
        Path path = resolveDirectoryPath(directory);
        SkillValidationResult validation = validateDirectory(path);
        return installValidatedDirectory(targetId, path, validation, null);
    }

    public SkillInstallation installArchive(String targetId, String repositoryId, String fileName, byte[] content) {
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("Skill 压缩包不能为空");
        }
        if (content.length > MAX_ARCHIVE_SIZE) {
            throw new IllegalArgumentException("Skill 压缩包过大，超过 25MB");
        }
        Path tempDir = createTempDir("skill-draft-archive");
        try {
            unzipToDirectory(content, tempDir);
            SkillValidationResult validation = validateSkillDirectory(tempDir, normalizeArchiveFallbackId(fileName), false, jsonCodec);
            return installValidatedDirectory(targetId, tempDir, validation, repositoryId);
        } finally {
            deleteQuietly(tempDir);
        }
    }

    public SkillInstallation installDraft(String targetId, SkillDraftRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Skill 草稿不能为空");
        }
        Path tempDir = createTempDir("skill-draft");
        try {
            Files.createDirectories(tempDir);
            Files.writeString(tempDir.resolve("skill.json"), jsonCodec.write(new SkillManifestFile(
                    1,
                    normalize(request.skillId(), "skillId 不能为空"),
                    normalize(request.displayName(), "displayName 不能为空"),
                    normalize(request.version(), "version 不能为空"),
                    normalize(request.description(), "description 不能为空"),
                    normalizeNullable(request.owner()),
                    request.tags() == null ? List.of() : request.tags(),
                    normalizeNullable(request.riskLevel()),
                    "SKILL.md",
                    null
            )), StandardCharsets.UTF_8);
            Files.writeString(tempDir.resolve("SKILL.md"), normalize(request.content(), "SKILL.md 内容不能为空"), StandardCharsets.UTF_8);
            SkillValidationResult validation = validateDirectory(tempDir, request.skillId(), false);
            return installValidatedDirectory(targetId, tempDir, validation, request.repositoryId());
        } catch (IOException exception) {
            throw new IllegalStateException("写入 Skill 草稿失败", exception);
        } finally {
            deleteQuietly(tempDir);
        }
    }

    public SkillInstallation updateInstallation(String installationId, String directory) {
        SkillInstallation existing = getInstallation(installationId);
        Path path = resolveDirectoryPath(directory);
        SkillValidationResult validation = validateDirectory(path);
        return installValidatedDirectory(existing.getTargetId(), path, validation, existing.getRepositoryId(), existing);
    }

    public SkillSyncResponse syncInstallationsToTarget(String targetId, List<String> installationIds) {
        requireTarget(targetId);
        List<String> normalizedIds = installationIds == null ? List.of() : installationIds.stream()
                .map(id -> normalize(id, "installationId 不能为空"))
                .distinct()
                .toList();
        List<SkillSyncResult> results = new ArrayList<>();
        for (String installationId : normalizedIds) {
            SkillInstallation source = getInstallation(installationId);
            if (targetId.equals(source.getTargetId())) {
                results.add(new SkillSyncResult(
                        installationId,
                        source.getSkillId(),
                        targetId,
                        "SKIPPED",
                        "来源 Skill 已安装在当前目标，无需同步",
                        null
                ));
                continue;
            }
            Path managedPath = resolveManagedPath(source);
            if (Files.notExists(managedPath.resolve("SKILL.md"))) {
                results.add(new SkillSyncResult(
                        installationId,
                        source.getSkillId(),
                        targetId,
                        "FAILED",
                        "来源 Skill 受管副本不存在",
                        null
                ));
                continue;
            }
            Path targetRoot = resolveTargetRoot(requireTarget(targetId).getRootPath());
            Path targetDirectory = targetRoot.resolve(source.getSkillId()).toAbsolutePath().normalize();
            if (Files.exists(targetDirectory) && Files.notExists(targetDirectory.resolve(INSTALL_MARKER_FILE))) {
                results.add(new SkillSyncResult(
                        installationId,
                        source.getSkillId(),
                        targetId,
                        "SKIPPED",
                        "目标中已存在同名未受管目录，已跳过",
                        null
                ));
                continue;
            }
            try {
                SkillValidationResult validation = validateDirectory(managedPath, source.getSkillId(), false);
                SkillInstallation created = installValidatedDirectory(targetId, managedPath, validation, source.getRepositoryId());
                results.add(new SkillSyncResult(
                        installationId,
                        source.getSkillId(),
                        targetId,
                        "SUCCESS",
                        "Skill 已同步",
                        created
                ));
            } catch (RuntimeException exception) {
                results.add(new SkillSyncResult(
                        installationId,
                        source.getSkillId(),
                        targetId,
                        "FAILED",
                        exception.getMessage(),
                        null
                ));
            }
        }
        return new SkillSyncResponse(targetId, results);
    }

    public void uninstall(String installationId) {
        SkillInstallation installation = getInstallation(installationId);
        Path installedPath = Path.of(installation.getInstalledPath()).toAbsolutePath().normalize();
        if (Files.notExists(installedPath.resolve(INSTALL_MARKER_FILE))) {
            throw new IllegalArgumentException("仅允许卸载 ActionDock 受管 Skill: " + installation.getInstalledPath());
        }
        deleteQuietly(installedPath);
        skillInstallationRepository.deleteByInstallationId(installationId);
    }

    private SkillInstallation installValidatedDirectory(String targetId,
                                                        Path sourceDirectory,
                                                        SkillValidationResult validation,
                                                        String repositoryId) {
        return installValidatedDirectory(targetId, sourceDirectory, validation, repositoryId, null);
    }

    private SkillInstallation installValidatedDirectory(String targetId,
                                                        Path sourceDirectory,
                                                        SkillValidationResult validation,
                                                        String repositoryId,
                                                        SkillInstallation existing) {
        SkillTarget target = requireTarget(targetId);
        if (!target.isEnabled()) {
            throw new IllegalArgumentException("SkillTarget 已禁用: " + target.getName());
        }
        Path targetRoot = resolveTargetRoot(target.getRootPath());
        ensureDirectoryWritable(targetRoot);
        Path normalizedSourceDirectory = normalizeSkillRoot(sourceDirectory);

        String skillId = validation.skillId();
        String installationId = existing == null
                ? skillId + "@" + targetId
                : existing.getInstallationId();
        Path managedDir = managedSkillsRoot.resolve(targetId).resolve(skillId).toAbsolutePath().normalize();
        Path tempManagedDir = managedDir.getParent().resolve(managedDir.getFileName() + ".tmp-" + UUID.randomUUID());
        Path finalTargetDir = targetRoot.resolve(skillId).toAbsolutePath().normalize();
        Path backupDir = finalTargetDir.getParent().resolve(finalTargetDir.getFileName() + ".bak-" + UUID.randomUUID());
        try {
            Files.createDirectories(managedDir.getParent());
            Files.createDirectories(targetRoot);
            copyDirectory(normalizedSourceDirectory, tempManagedDir);
            writeInstallMarker(tempManagedDir, installationId, repositoryId, validation);
            Path tempFinalDir = targetRoot.resolve(skillId + ".tmp-" + UUID.randomUUID()).toAbsolutePath().normalize();
            copyDirectory(tempManagedDir, tempFinalDir);
            if (Files.exists(finalTargetDir)) {
                if (Files.notExists(finalTargetDir.resolve(INSTALL_MARKER_FILE))) {
                    throw new IllegalArgumentException("目标目录已存在且不是 ActionDock 受管 Skill: " + finalTargetDir);
                }
                moveAtomically(finalTargetDir, backupDir);
            }
            moveAtomically(tempFinalDir, finalTargetDir);
            deleteQuietly(managedDir);
            moveAtomically(tempManagedDir, managedDir);
            deleteQuietly(backupDir);
            LocalDateTime now = LocalDateTime.now();
            return skillInstallationRepository.save(new SkillInstallation()
                    .setInstallationId(installationId)
                    .setSkillId(validation.skillId())
                    .setRepositoryId(repositoryId)
                    .setVersion(validation.version())
                    .setTargetId(target.getId())
                    .setTargetPath(target.getRootPath())
                    .setInstalledPath(finalTargetDir.toString())
                    .setDigest(validation.digest())
                    .setDisplayName(validation.displayName())
                    .setDescription(validation.description())
                    .setEnabled(true)
                    .setInstalledAt(existing == null ? now : Optional.ofNullable(existing.getInstalledAt()).orElse(now))
                    .setUpdatedAt(now));
        } catch (IOException exception) {
            deleteQuietly(tempManagedDir);
            throw new IllegalStateException("安装 Skill 失败", exception);
        }
    }

    private SkillValidationResult validateDirectory(Path directory, String fallbackId, boolean requireManifest) {
        return validateSkillDirectory(directory, fallbackId, requireManifest, jsonCodec);
    }

    public static SkillValidationResult validateSkillDirectory(Path directory,
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
        SkillManifestFile manifest = Files.exists(manifestPath)
                ? jsonCodec.read(readString(manifestPath), SkillManifestFile.class)
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
        return new SkillValidationResult(
                skillId,
                displayName,
                version,
                description,
                manifest == null ? null : manifest.owner(),
                manifest == null || manifest.tags() == null ? List.of() : manifest.tags(),
                manifest == null ? null : manifest.riskLevel(),
                manifest == null ? "SKILL.md" : normalizeOrDefault(manifest.entrypointPath(), "SKILL.md"),
                digestDirectory(root),
                warnings
        );
    }

    public static Path locateSkillRoot(Path directory) {
        return normalizeSkillRoot(directory);
    }

    public static byte[] buildArchive(Path directory,
                                      SkillValidationResult validation,
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

    public static String computePublishDigest(Path directory,
                                              SkillValidationResult validation,
                                              String manifestVersion,
                                              JsonCodec jsonCodec) {
        Path root = normalizeSkillRoot(directory);
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
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
                        digest.update(buildManifestBytes(validation, manifestVersion, null, jsonCodec));
                    } else {
                        digest.update(Files.readAllBytes(file));
                    }
                    digest.update((byte) 0);
                }
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException | IOException exception) {
            throw new IllegalStateException("计算 Skill 发布摘要失败", exception);
        }
    }

    public static void unzipArchive(byte[] content, Path directory) {
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("Skill 压缩包不能为空");
        }
        if (content.length > MAX_ARCHIVE_SIZE) {
            throw new IllegalArgumentException("Skill 压缩包过大，超过 25MB");
        }
        unzipToDirectory(content, directory);
    }

    public static void writeManifest(Path directory,
                                     SkillValidationResult validation,
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

    private static Path normalizeSkillRoot(Path directory) {
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

    private static void unzipToDirectory(byte[] content, Path directory) {
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
                    if (!target.startsWith(directory)) {
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

    private void copyDirectory(Path source, Path target) throws IOException {
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
                if (Files.isSymbolicLink(file)) {
                    throw new IllegalArgumentException("Skill 不允许包含符号链接: " + file);
                }
                Path relative = source.relativize(file);
                Path targetFile = target.resolve(relative.toString()).normalize();
                Files.copy(file, targetFile, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.COPY_ATTRIBUTES);
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private void moveAtomically(Path source, Path target) throws IOException {
        try {
            Files.move(source, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException ignored) {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private void writeInstallMarker(Path directory,
                                    String installationId,
                                    String repositoryId,
                                    SkillValidationResult validation) throws IOException {
        Map<String, Object> marker = new LinkedHashMap<>();
        marker.put("installationId", installationId);
        marker.put("repositoryId", repositoryId);
        marker.put("skillId", validation.skillId());
        marker.put("version", validation.version());
        marker.put("digest", validation.digest());
        marker.put("installedAt", LocalDateTime.now().toString());
        Files.writeString(directory.resolve(INSTALL_MARKER_FILE), jsonCodec.write(marker), StandardCharsets.UTF_8);
    }

    private static String digestDirectory(Path directory) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            List<Path> files;
            try (var stream = Files.walk(directory)) {
                files = stream.filter(Files::isRegularFile)
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

    private static Frontmatter parseFrontmatter(String content) {
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

    private List<SkillFileNode> buildFileTree(Path root, Path current) {
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

    private SkillFileNode toFileNode(Path root, Path path) {
        boolean directory = Files.isDirectory(path);
        String relativePath = root.relativize(path).toString().replace('\\', '/');
        return new SkillFileNode(
                path.getFileName().toString(),
                relativePath,
                directory,
                directory ? null : fileSize(path),
                directory ? buildFileTree(root, path) : List.of()
        );
    }

    private Path resolveManagedPath(SkillInstallation installation) {
        Path managedPath = managedSkillsRoot.resolve(installation.getTargetId()).resolve(installation.getSkillId()).toAbsolutePath().normalize();
        if (!managedPath.startsWith(managedSkillsRoot)) {
            throw new IllegalStateException("Skill 受管目录非法: " + installation.getInstallationId());
        }
        return managedPath;
    }

    private Path resolveManagedFile(Path managedPath, String relativePath) {
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

    private long fileSize(Path path) {
        try {
            return Files.size(path);
        } catch (IOException exception) {
            throw new IllegalStateException("读取 Skill 文件大小失败: " + path, exception);
        }
    }

    private String detectContentType(Path path) {
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

    private boolean isTextFile(Path path, String contentType) {
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

    private boolean isImageFile(String contentType) {
        return contentType.startsWith("image/");
    }

    private String resolvePreviewType(Path path) {
        String fileName = path.getFileName().toString().toLowerCase(Locale.ROOT);
        if (fileName.endsWith(".md")) {
            return "MARKDOWN";
        }
        return "TEXT";
    }

    private String resolveLanguage(Path path) {
        String fileName = path.getFileName().toString().toLowerCase(Locale.ROOT);
        if (fileName.endsWith(".md")) {
            return "markdown";
        }
        if (fileName.endsWith(".json")) {
            return "json";
        }
        if (fileName.endsWith(".yaml") || fileName.endsWith(".yml")) {
            return "yaml";
        }
        if (fileName.endsWith(".txt")) {
            return "plaintext";
        }
        return "plaintext";
    }

    private SkillTarget requireTarget(String id) {
        return skillTargetRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("SkillTarget 不存在: " + id));
    }

    private Path resolveTargetRoot(String rootPath) {
        String expandedPath = expandHomeShortcut(rootPath);
        Path path = Path.of(expandedPath).toAbsolutePath().normalize();
        if (!path.isAbsolute()) {
            throw new IllegalArgumentException("SkillTarget rootPath 必须是绝对路径");
        }
        return path;
    }

    private String expandHomeShortcut(String input) {
        String value = normalize(input, "SkillTarget rootPath 不能为空");
        if (value.contains("${") || value.contains("$") || value.contains("%")) {
            throw new IllegalArgumentException("SkillTarget rootPath 仅支持使用 ~ 表示用户目录");
        }
        String userHome = System.getProperty("user.home");
        if ("~".equals(value)) {
            value = userHome;
        } else if (value.startsWith("~/") || value.startsWith("~\\")) {
            value = userHome + value.substring(1);
        }
        return value;
    }

    private Path resolveDirectoryPath(String directory) {
        String expandedPath = expandHomeShortcut(normalize(directory, "Skill 目录不能为空"));
        Path path = Path.of(expandedPath).toAbsolutePath().normalize();
        if (!path.isAbsolute()) {
            throw new IllegalArgumentException("Skill 目录必须是绝对路径");
        }
        return path;
    }

    private boolean ensureDirectoryWritable(Path path) {
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

    private Path createTempDir(String prefix) {
        try {
            Files.createDirectories(managedSkillsRoot);
            return Files.createTempDirectory(managedSkillsRoot, prefix + "-");
        } catch (IOException exception) {
            throw new IllegalStateException("创建临时 Skill 目录失败", exception);
        }
    }

    private static String readString(Path path) {
        try {
            return Files.readString(path, StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new IllegalStateException("读取文件失败: " + path, exception);
        }
    }

    private static void deleteQuietly(Path path) {
        if (path == null || Files.notExists(path)) {
            return;
        }
        try {
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

    private static String slugify(String value) {
        String normalized = normalizeOrDefault(value, "skill")
                .trim()
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
        return normalized.isBlank() ? "skill" : normalized;
    }

    private static String normalize(String value, String message) {
        String normalized = normalizeNullable(value);
        if (normalized == null) {
            throw new IllegalArgumentException(message);
        }
        return normalized;
    }

    private static String normalizeNullable(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String normalizeOrDefault(String value, String defaultValue) {
        String normalized = normalizeNullable(value);
        return normalized == null ? defaultValue : normalized;
    }

    private static String normalizeArchiveFallbackId(String fileName) {
        String normalized = normalizeNullable(fileName);
        if (normalized == null) {
            return null;
        }
        if (normalized.toLowerCase(Locale.ROOT).endsWith(".zip")) {
            normalized = normalized.substring(0, normalized.length() - 4);
        }
        return normalizeNullable(normalized);
    }

    private static byte[] buildManifestBytes(SkillValidationResult validation,
                                             String version,
                                             String digest,
                                             JsonCodec jsonCodec) {
        return jsonCodec.write(new SkillManifestFile(
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

    private record Frontmatter(String name, String description) {
    }

    public record SkillManifestFile(int schemaVersion,
                                    String skillId,
                                    String displayName,
                                    String version,
                                    String description,
                                    String owner,
                                    List<String> tags,
                                    String riskLevel,
                                    @JsonAlias("entrypoint")
                                    String entrypointPath,
                                    String digest) {
    }

    public record SkillValidationResult(String skillId,
                                        String displayName,
                                        String version,
                                        String description,
                                        String owner,
                                        List<String> tags,
                                        String riskLevel,
                                        String entrypointPath,
                                        String digest,
                                        List<String> warnings) {
    }

    public record SkillPackageResult(SkillValidationResult validation,
                                     String directory) {
    }

    public record SkillScanItem(String id,
                                String path,
                                String name,
                                String description,
                                boolean managed,
                                String installationId,
                                Boolean enabled,
                                String version) {
    }

    public record SkillScanDetail(String id,
                                  String path,
                                  String name,
                                  String description,
                                  boolean managed,
                                  String installationId,
                                  Boolean enabled,
                                  String version,
                                  List<SkillFileNode> files) {
    }

    public record SkillDetail(SkillInstallation installation,
                              String managedPath,
                              List<SkillFileNode> files) {
    }

    public record SkillFileNode(String name,
                                String path,
                                boolean directory,
                                Long size,
                                List<SkillFileNode> children) {
    }

    public record SkillFilePreview(String path,
                                   String name,
                                   boolean directory,
                                   String contentType,
                                   long size,
                                   String previewType,
                                   String language,
                                   String textContent,
                                   String dataUrl,
                                   boolean truncated) {
    }

    public record SkillArchive(String fileName,
                               byte[] content) {
    }

    public record SkillSyncResponse(String targetId,
                                    List<SkillSyncResult> results) {
    }

    public record SkillSyncResult(String installationId,
                                  String skillId,
                                  String targetId,
                                  String status,
                                  String message,
                                  SkillInstallation createdInstallation) {
    }

    public record SkillDraftRequest(String repositoryId,
                                    String skillId,
                                    String displayName,
                                    String version,
                                    String owner,
                                    String description,
                                    List<String> tags,
                                    String riskLevel,
                                    String content) {
    }
}
