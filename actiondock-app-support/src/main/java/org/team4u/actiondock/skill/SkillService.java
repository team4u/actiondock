package org.team4u.actiondock.skill;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.ManagedSkill;
import org.team4u.actiondock.domain.model.SkillInstallation;
import org.team4u.actiondock.domain.model.SkillTarget;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.ManagedSkillRepository;
import org.team4u.actiondock.domain.port.SkillInstallationRepository;
import org.team4u.actiondock.domain.port.SkillTargetRepository;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
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
import java.util.LinkedHashSet;
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
    private final ManagedSkillRepository managedSkillRepository;
    private final SkillInstallationRepository skillInstallationRepository;
    private final JsonCodec jsonCodec;
    private final Path managedSkillsRoot;
    private volatile boolean storageInitialized;

    public SkillService(SkillTargetRepository skillTargetRepository,
                        ManagedSkillRepository managedSkillRepository,
                        SkillInstallationRepository skillInstallationRepository,
                        JsonCodec jsonCodec,
                        AppProperties properties) {
        this.skillTargetRepository = skillTargetRepository;
        this.managedSkillRepository = managedSkillRepository;
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
        List<SkillInstallation> deployments = skillInstallationRepository.findByTargetId(target.getId());
        if (!deployments.isEmpty()) {
            throw new IllegalArgumentException("目标目录仍有已安装 Skill，不能删除: " + target.getName());
        }
        skillTargetRepository.deleteById(id);
    }

    public List<SkillScanItem> scanTarget(String targetId) {
        initializeManagedSkillStorage();
        SkillTarget target = requireTarget(targetId);
        Path root = resolveTargetRoot(target.getRootPath());
        try {
            if (Files.notExists(root)) {
                Files.createDirectories(root);
            }
            Map<String, SkillInstallation> pathToDeployment = skillInstallationRepository.findByTargetId(targetId).stream()
                    .collect(Collectors.toMap(SkillInstallation::getInstalledPath, item -> item, (left, right) -> left));
            List<SkillScanItem> items = new ArrayList<>();
            try (var stream = Files.list(root)) {
                for (Path child : stream.filter(Files::isDirectory).sorted().toList()) {
                    Path skillMd = child.resolve("SKILL.md");
                    if (Files.notExists(skillMd)) {
                        continue;
                    }
                    String content = Files.readString(skillMd, StandardCharsets.UTF_8);
                    Frontmatter frontmatter = parseFrontmatter(content);
                    SkillInstallation deployment = pathToDeployment.get(child.toString());
                    Map<String, Object> marker = readInstallMarker(child);
                    boolean managed = deployment != null || marker != null;
                    String skillId = deployment != null
                            ? deployment.getSkillId()
                            : markerString(marker, "skillId");
                    Boolean enabled = deployment != null ? deployment.isEnabled() : null;
                    String version = deployment != null
                            ? deployment.getVersion()
                            : markerString(marker, "version");
                    items.add(new SkillScanItem(
                            child.getFileName().toString(),
                            child.toString(),
                            frontmatter.name(),
                            frontmatter.description(),
                            managed,
                            skillId,
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
        initializeManagedSkillStorage();
        SkillTarget target = requireTarget(targetId);
        Path root = resolveTargetRoot(target.getRootPath());
        Path dir = resolveScanDirectory(root, directoryId);
        String content = readString(dir.resolve("SKILL.md"));
        Frontmatter frontmatter = parseFrontmatter(content);
        SkillInstallation deployment = skillInstallationRepository.findByTargetId(targetId).stream()
                .filter(item -> Objects.equals(item.getInstalledPath(), dir.toString()))
                .findFirst()
                .orElse(null);
        Map<String, Object> marker = readInstallMarker(dir);
        boolean managed = deployment != null || marker != null;
        String skillId = deployment != null ? deployment.getSkillId() : markerString(marker, "skillId");
        Boolean enabled = deployment != null ? deployment.isEnabled() : null;
        String version = deployment != null ? deployment.getVersion() : markerString(marker, "version");
        return new SkillScanDetail(
                dir.getFileName().toString(),
                dir.toString(),
                frontmatter.name(),
                frontmatter.description(),
                managed,
                skillId,
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
                    null,
                    null,
                    null,
                    false
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

    public List<SkillListItem> listSkills() {
        initializeManagedSkillStorage();
        return managedSkillRepository.findAll().stream()
                .map(this::toSkillListItem)
                .sorted(Comparator.comparing(SkillListItem::updatedAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .toList();
    }

    public SkillListItem getSkill(String skillId) {
        initializeManagedSkillStorage();
        return toSkillListItem(requireManagedSkill(skillId));
    }

    public SkillListItem disableSkill(String skillId) {
        initializeManagedSkillStorage();
        List<SkillInstallation> deployments = skillInstallationRepository.findBySkillId(skillId);
        if (deployments.isEmpty()) {
            throw new IllegalArgumentException("Skill 未安装到任何目标: " + skillId);
        }
        for (SkillInstallation deployment : deployments) {
            Path installedPath = Path.of(deployment.getInstalledPath()).toAbsolutePath().normalize();
            if (Files.exists(installedPath) && Files.notExists(installedPath.resolve(INSTALL_MARKER_FILE))) {
                throw new IllegalArgumentException("仅允许停用 ActionDock 受管 Skill: " + deployment.getInstalledPath());
            }
            deleteQuietly(installedPath);
            skillInstallationRepository.save(copyDeployment(deployment)
                    .setEnabled(false)
                    .setUpdatedAt(LocalDateTime.now()));
        }
        return getSkill(skillId);
    }

    public SkillListItem restoreSkill(String skillId) {
        initializeManagedSkillStorage();
        ManagedSkill skill = requireManagedSkill(skillId);
        Path managedPath = resolveManagedPath(skillId);
        if (Files.notExists(managedPath.resolve("SKILL.md"))) {
            throw new IllegalArgumentException("Skill 受管副本不存在，无法恢复: " + skillId);
        }
        SkillValidationResult validation = validateDirectory(managedPath, skillId, false);
        for (SkillInstallation deployment : skillInstallationRepository.findBySkillId(skillId)) {
            deployManagedSkillToTarget(skill, deployment.getTargetId(), validation, deployment);
        }
        return getSkill(skillId);
    }

    public SkillDetail getSkillDetail(String skillId) {
        initializeManagedSkillStorage();
        ManagedSkill skill = requireManagedSkill(skillId);
        Path managedPath = resolveManagedPath(skillId);
        return new SkillDetail(
                toSkillListItem(skill),
                managedPath.toString(),
                Files.exists(managedPath) ? buildFileTree(managedPath, managedPath) : List.of()
        );
    }

    public SkillArchive exportSkillArchive(String skillId) {
        initializeManagedSkillStorage();
        ManagedSkill skill = requireManagedSkill(skillId);
        Path managedPath = resolveManagedPath(skillId);
        SkillValidationResult validation = validateSkillDirectory(managedPath, skillId, false, jsonCodec);
        return new SkillArchive(
                skillId + ".zip",
                buildArchive(managedPath, validation, skill.getVersion(), jsonCodec)
        );
    }

    public SkillFilePreview previewSkillFile(String skillId, String relativePath) {
        initializeManagedSkillStorage();
        requireManagedSkill(skillId);
        Path managedPath = resolveManagedPath(skillId);
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
        return new SkillFilePreview(
                relative,
                target.getFileName().toString(),
                false,
                contentType,
                size,
                resolvePreviewType(target),
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
        return validateDirectory(directory, directory == null ? null : directory.getFileName().toString(), false);
    }

    public SkillPackageResult packageDirectory(Path directory) {
        SkillValidationResult result = validateDirectory(directory);
        return new SkillPackageResult(result, directory.toAbsolutePath().normalize().toString());
    }

    public SkillPackageResult packageDirectory(String directory) {
        Path path = resolveDirectoryPath(directory);
        return packageDirectory(path);
    }

    public SkillListItem installFromZip(List<String> targetIds, String fileName, byte[] content) {
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
            return installValidatedDirectory(targetIds, tempDir, validation, null);
        } finally {
            deleteQuietly(tempDir);
        }
    }

    public SkillListItem installFromDirectory(List<String> targetIds, String directory) {
        return installFromDirectory(targetIds, directory, null);
    }

    public SkillListItem installFromDirectory(List<String> targetIds, String directory, String repositoryId) {
        Path path = resolveDirectoryPath(directory);
        SkillValidationResult validation = validateDirectory(path);
        return installValidatedDirectory(targetIds, path, validation, normalizeNullable(repositoryId));
    }

    public SkillListItem installArchive(List<String> targetIds, String repositoryId, String fileName, byte[] content) {
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("Skill 压缩包不能为空");
        }
        if (content.length > MAX_ARCHIVE_SIZE) {
            throw new IllegalArgumentException("Skill 压缩包过大，超过 25MB");
        }
        Path tempDir = createTempDir("skill-install-archive");
        try {
            unzipToDirectory(content, tempDir);
            SkillValidationResult validation = validateSkillDirectory(tempDir, normalizeArchiveFallbackId(fileName), false, jsonCodec);
            return installValidatedDirectory(targetIds, tempDir, validation, repositoryId);
        } finally {
            deleteQuietly(tempDir);
        }
    }

    public SkillListItem updateSkill(String skillId, String directory) {
        initializeManagedSkillStorage();
        ManagedSkill existingSkill = requireManagedSkill(skillId);
        List<SkillInstallation> deployments = skillInstallationRepository.findBySkillId(skillId);
        if (deployments.isEmpty()) {
            throw new IllegalArgumentException("Skill 未安装到任何目标: " + skillId);
        }
        Path path = resolveDirectoryPath(directory);
        SkillValidationResult validation = validateDirectory(path, skillId, false);
        if (!Objects.equals(validation.skillId(), skillId)) {
            throw new IllegalArgumentException("更新目录中的 skillId 与目标 Skill 不一致");
        }
        return installValidatedDirectory(
                deployments.stream().map(SkillInstallation::getTargetId).toList(),
                path,
                validation,
                existingSkill.getRepositoryId()
        );
    }

    public SkillListItem updateSkillVersion(String skillId, String version) {
        initializeManagedSkillStorage();
        ManagedSkill existingSkill = requireManagedSkill(skillId);
        String normalizedVersion = normalize(version, "version 不能为空");
        Path managedPath = resolveManagedPath(skillId);
        if (Files.notExists(managedPath.resolve("SKILL.md"))) {
            throw new IllegalArgumentException("Skill 受管副本不存在: " + skillId);
        }
        SkillValidationResult validation = validateSkillDirectory(managedPath, skillId, false, jsonCodec);
        writeManifest(managedPath, validation, normalizedVersion, jsonCodec);
        SkillValidationResult persistedValidation = validateSkillDirectory(managedPath, skillId, false, jsonCodec);
        String digest = computePublishDigest(managedPath, persistedValidation, normalizedVersion, jsonCodec);
        LocalDateTime now = LocalDateTime.now();
        ManagedSkill saved = managedSkillRepository.save(new ManagedSkill()
                .setSkillId(existingSkill.getSkillId())
                .setRepositoryId(existingSkill.getRepositoryId())
                .setVersion(normalizedVersion)
                .setDigest(digest)
                .setDisplayName(existingSkill.getDisplayName())
                .setDescription(existingSkill.getDescription())
                .setInstalledAt(existingSkill.getInstalledAt())
                .setUpdatedAt(now));
        SkillValidationResult versionedValidation = copyValidationWithVersionAndDigest(persistedValidation, normalizedVersion, digest);
        for (SkillInstallation deployment : skillInstallationRepository.findBySkillId(skillId)) {
            skillInstallationRepository.save(copyDeployment(deployment)
                    .setVersion(normalizedVersion)
                    .setDigest(digest)
                    .setUpdatedAt(now));
            Path installedPath = Path.of(deployment.getInstalledPath()).toAbsolutePath().normalize();
            if (Files.exists(installedPath) && Files.exists(installedPath.resolve(INSTALL_MARKER_FILE))) {
                try {
                    writeManifest(installedPath, versionedValidation, normalizedVersion, jsonCodec);
                    writeInstallMarker(installedPath, deployment.getInstallationId(), saved.getRepositoryId(), versionedValidation);
                } catch (IOException exception) {
                    throw new IllegalStateException("更新 Skill 安装标记失败", exception);
                }
            }
        }
        return getSkill(skillId);
    }

    public SkillSyncResponse syncSkillsToTarget(String targetId, List<String> skillIds) {
        initializeManagedSkillStorage();
        requireTarget(targetId);
        List<String> normalizedIds = skillIds == null ? List.of() : skillIds.stream()
                .map(id -> normalize(id, "skillId 不能为空"))
                .distinct()
                .toList();
        List<SkillSyncResult> results = new ArrayList<>();
        for (String skillId : normalizedIds) {
            if (skillInstallationRepository.findBySkillIdAndTargetId(skillId, targetId).isPresent()) {
                results.add(new SkillSyncResult(skillId, targetId, "SKIPPED", "Skill 已安装在当前目标，无需同步", null));
                continue;
            }
            ManagedSkill skill = requireManagedSkill(skillId);
            Path managedPath = resolveManagedPath(skillId);
            if (Files.notExists(managedPath.resolve("SKILL.md"))) {
                results.add(new SkillSyncResult(skillId, targetId, "FAILED", "Skill 受管副本不存在", null));
                continue;
            }
            Path targetRoot = resolveTargetRoot(requireTarget(targetId).getRootPath());
            Path targetDirectory = targetRoot.resolve(skillId).toAbsolutePath().normalize();
            if (Files.exists(targetDirectory) && Files.notExists(targetDirectory.resolve(INSTALL_MARKER_FILE))) {
                results.add(new SkillSyncResult(skillId, targetId, "SKIPPED", "目标中已存在同名未受管目录，已跳过", null));
                continue;
            }
            try {
                SkillValidationResult validation = validateDirectory(managedPath, skillId, false);
                SkillInstallation created = deployManagedSkillToTarget(skill, targetId, validation, null);
                results.add(new SkillSyncResult(skillId, targetId, "SUCCESS", "Skill 已同步", toDeploymentView(created)));
            } catch (RuntimeException exception) {
                results.add(new SkillSyncResult(skillId, targetId, "FAILED", exception.getMessage(), null));
            }
        }
        return new SkillSyncResponse(targetId, results);
    }

    public void uninstallSkill(String skillId) {
        initializeManagedSkillStorage();
        requireManagedSkill(skillId);
        for (SkillInstallation deployment : skillInstallationRepository.findBySkillId(skillId)) {
            deleteInstalledPath(deployment);
            skillInstallationRepository.deleteBySkillIdAndTargetId(skillId, deployment.getTargetId());
        }
        deleteQuietly(resolveManagedPath(skillId));
        managedSkillRepository.deleteBySkillId(skillId);
    }

    public void removeSkillFromTarget(String skillId, String targetId) {
        initializeManagedSkillStorage();
        requireManagedSkill(skillId);
        SkillInstallation deployment = skillInstallationRepository.findBySkillIdAndTargetId(skillId, targetId)
                .orElseThrow(() -> new IllegalArgumentException("Skill 未安装到目标: " + skillId + " -> " + targetId));
        deleteInstalledPath(deployment);
        skillInstallationRepository.deleteBySkillIdAndTargetId(skillId, targetId);
        if (skillInstallationRepository.findBySkillId(skillId).isEmpty()) {
            deleteQuietly(resolveManagedPath(skillId));
            managedSkillRepository.deleteBySkillId(skillId);
        }
    }

    private SkillListItem installValidatedDirectory(List<String> targetIds,
                                                    Path sourceDirectory,
                                                    SkillValidationResult validation,
                                                    String repositoryId) {
        initializeManagedSkillStorage();
        List<String> normalizedTargetIds = normalizeTargetIds(targetIds);
        String skillId = validation.skillId();
        ManagedSkill existingSkill = managedSkillRepository.findBySkillId(skillId).orElse(null);
        ManagedSkill savedSkill = writeManagedSkillCopy(sourceDirectory, validation, repositoryId, existingSkill);
        LinkedHashSet<String> allTargetIds = new LinkedHashSet<>(normalizedTargetIds);
        skillInstallationRepository.findBySkillId(skillId).stream()
                .map(SkillInstallation::getTargetId)
                .forEach(allTargetIds::add);
        SkillValidationResult managedValidation = copyValidationWithVersionAndDigest(
                validation,
                savedSkill.getVersion(),
                savedSkill.getDigest()
        );
        for (String targetId : allTargetIds) {
            SkillInstallation existingDeployment = skillInstallationRepository.findBySkillIdAndTargetId(skillId, targetId).orElse(null);
            deployManagedSkillToTarget(savedSkill, targetId, managedValidation, existingDeployment);
        }
        return getSkill(skillId);
    }

    private ManagedSkill writeManagedSkillCopy(Path sourceDirectory,
                                               SkillValidationResult validation,
                                               String repositoryId,
                                               ManagedSkill existingSkill) {
        Path normalizedSourceDirectory = normalizeSkillRoot(sourceDirectory);
        String managedVersion = resolveManagedVersion(validation, existingSkill);
        SkillValidationResult managedValidation = copyValidationWithVersion(validation, managedVersion);
        Path managedDir = resolveManagedPath(validation.skillId());
        Path tempManagedDir = managedDir.getParent().resolve(managedDir.getFileName() + ".tmp-" + UUID.randomUUID());
        try {
            Files.createDirectories(managedDir.getParent());
            copyDirectory(normalizedSourceDirectory, tempManagedDir);
            deleteQuietly(tempManagedDir.resolve(INSTALL_MARKER_FILE));
            deleteQuietly(managedDir);
            moveAtomically(tempManagedDir, managedDir);
            writeManifest(managedDir, managedValidation, managedVersion, jsonCodec);
            LocalDateTime now = LocalDateTime.now();
            return managedSkillRepository.save(new ManagedSkill()
                    .setSkillId(validation.skillId())
                    .setRepositoryId(repositoryId)
                    .setVersion(managedVersion)
                    .setDigest(computePublishDigest(managedDir, managedValidation, managedVersion, jsonCodec))
                    .setDisplayName(validation.displayName())
                    .setDescription(validation.description())
                    .setInstalledAt(existingSkill == null ? now : Optional.ofNullable(existingSkill.getInstalledAt()).orElse(now))
                    .setUpdatedAt(now));
        } catch (IOException exception) {
            deleteQuietly(tempManagedDir);
            throw new IllegalStateException("安装 Skill 失败", exception);
        }
    }

    private SkillInstallation deployManagedSkillToTarget(ManagedSkill skill,
                                                         String targetId,
                                                         SkillValidationResult validation,
                                                         SkillInstallation existingDeployment) {
        SkillTarget target = requireTarget(targetId);
        if (!target.isEnabled()) {
            throw new IllegalArgumentException("SkillTarget 已禁用: " + target.getName());
        }
        Path targetRoot = resolveTargetRoot(target.getRootPath());
        ensureDirectoryWritable(targetRoot);
        Path managedDir = resolveManagedPath(skill.getSkillId());
        Path finalTargetDir = targetRoot.resolve(skill.getSkillId()).toAbsolutePath().normalize();
        Path tempFinalDir = targetRoot.resolve(skill.getSkillId() + ".tmp-" + UUID.randomUUID()).toAbsolutePath().normalize();
        Path backupDir = finalTargetDir.getParent().resolve(finalTargetDir.getFileName() + ".bak-" + UUID.randomUUID());
        String installationId = skill.getSkillId() + "@" + targetId;
        try {
            Files.createDirectories(targetRoot);
            copyDirectory(managedDir, tempFinalDir);
            writeInstallMarker(tempFinalDir, installationId, skill.getRepositoryId(), validation);
            if (Files.exists(finalTargetDir)) {
                if (Files.notExists(finalTargetDir.resolve(INSTALL_MARKER_FILE))) {
                    throw new IllegalArgumentException("目标目录已存在且不是 ActionDock 受管 Skill: " + finalTargetDir);
                }
                moveAtomically(finalTargetDir, backupDir);
            }
            moveAtomically(tempFinalDir, finalTargetDir);
            deleteQuietly(backupDir);
            LocalDateTime now = LocalDateTime.now();
            return skillInstallationRepository.save(new SkillInstallation()
                    .setInstallationId(installationId)
                    .setSkillId(skill.getSkillId())
                    .setRepositoryId(skill.getRepositoryId())
                    .setVersion(skill.getVersion())
                    .setTargetId(target.getId())
                    .setTargetPath(target.getRootPath())
                    .setInstalledPath(finalTargetDir.toString())
                    .setDigest(skill.getDigest())
                    .setDisplayName(skill.getDisplayName())
                    .setDescription(skill.getDescription())
                    .setEnabled(true)
                    .setInstalledAt(existingDeployment == null ? now : Optional.ofNullable(existingDeployment.getInstalledAt()).orElse(now))
                    .setUpdatedAt(now));
        } catch (IOException exception) {
            deleteQuietly(tempFinalDir);
            throw new IllegalStateException("安装 Skill 失败", exception);
        }
    }

    private List<String> normalizeTargetIds(List<String> targetIds) {
        List<String> normalized = targetIds == null ? List.of() : targetIds.stream()
                .map(id -> normalize(id, "targetId 不能为空"))
                .distinct()
                .toList();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("至少需要一个 SkillTarget");
        }
        return normalized;
    }

    private SkillListItem toSkillListItem(ManagedSkill skill) {
        List<SkillDeploymentView> targets = skillInstallationRepository.findBySkillId(skill.getSkillId()).stream()
                .map(this::toDeploymentView)
                .sorted(Comparator.comparing(SkillDeploymentView::targetId, Comparator.nullsLast(String::compareToIgnoreCase)))
                .toList();
        int enabledCount = (int) targets.stream().filter(SkillDeploymentView::enabled).count();
        return new SkillListItem(
                skill.getSkillId(),
                skill.getRepositoryId(),
                skill.getVersion(),
                skill.getDigest(),
                skill.getDisplayName(),
                skill.getDescription(),
                enabledCount,
                targets.size() - enabledCount,
                targets,
                skill.getInstalledAt(),
                skill.getUpdatedAt()
        );
    }

    private SkillDeploymentView toDeploymentView(SkillInstallation deployment) {
        return new SkillDeploymentView(
                deployment.getTargetId(),
                deployment.getTargetPath(),
                deployment.getInstalledPath(),
                deployment.isEnabled(),
                deployment.getInstalledAt(),
                deployment.getUpdatedAt()
        );
    }

    private SkillInstallation copyDeployment(SkillInstallation deployment) {
        return new SkillInstallation()
                .setInstallationId(deployment.getInstallationId())
                .setSkillId(deployment.getSkillId())
                .setRepositoryId(deployment.getRepositoryId())
                .setVersion(deployment.getVersion())
                .setTargetId(deployment.getTargetId())
                .setTargetPath(deployment.getTargetPath())
                .setInstalledPath(deployment.getInstalledPath())
                .setDigest(deployment.getDigest())
                .setDisplayName(deployment.getDisplayName())
                .setDescription(deployment.getDescription())
                .setEnabled(deployment.isEnabled())
                .setInstalledAt(deployment.getInstalledAt())
                .setUpdatedAt(deployment.getUpdatedAt());
    }

    private String resolveManagedVersion(SkillValidationResult validation, ManagedSkill existingSkill) {
        if (validation.manifestPresent()) {
            return normalize(validation.version(), "version 不能为空");
        }
        if (existingSkill != null && normalizeNullable(existingSkill.getVersion()) != null) {
            return normalizeNullable(existingSkill.getVersion());
        }
        return normalize(validation.version(), "version 不能为空");
    }

    private static SkillValidationResult copyValidationWithVersion(SkillValidationResult validation, String version) {
        return copyValidationWithVersionAndDigest(validation, version, validation.digest());
    }

    private static SkillValidationResult copyValidationWithVersionAndDigest(SkillValidationResult validation, String version, String digest) {
        return new SkillValidationResult(
                validation.skillId(),
                validation.displayName(),
                normalize(version, "version 不能为空"),
                validation.description(),
                validation.owner(),
                validation.tags(),
                validation.riskLevel(),
                validation.entrypointPath(),
                digest,
                validation.warnings(),
                validation.manifestPresent()
        );
    }

    private void deleteInstalledPath(SkillInstallation deployment) {
        Path installedPath = Path.of(deployment.getInstalledPath()).toAbsolutePath().normalize();
        if (Files.exists(installedPath) && Files.notExists(installedPath.resolve(INSTALL_MARKER_FILE))) {
            throw new IllegalArgumentException("仅允许卸载 ActionDock 受管 Skill: " + deployment.getInstalledPath());
        }
        deleteQuietly(installedPath);
    }

    private void initializeManagedSkillStorage() {
        if (storageInitialized) {
            return;
        }
        synchronized (this) {
            if (storageInitialized) {
                return;
            }
            try {
                Files.createDirectories(managedSkillsRoot);
            } catch (IOException exception) {
                throw new IllegalStateException("初始化 Skill 受管目录失败", exception);
            }
            for (ManagedSkill skill : managedSkillRepository.findAll()) {
                Path canonical = resolveManagedPath(skill.getSkillId());
                List<Path> legacyPaths = skillInstallationRepository.findBySkillId(skill.getSkillId()).stream()
                        .map(this::resolveLegacyManagedPath)
                        .filter(path -> Files.exists(path.resolve("SKILL.md")))
                        .sorted(Comparator.comparing(this::safeLastModified).reversed())
                        .toList();
                if (Files.notExists(canonical.resolve("SKILL.md")) && !legacyPaths.isEmpty()) {
                    Path source = legacyPaths.get(0);
                    Path temp = canonical.getParent().resolve(canonical.getFileName() + ".tmp-" + UUID.randomUUID());
                    try {
                        copyDirectory(source, temp);
                        deleteQuietly(temp.resolve(INSTALL_MARKER_FILE));
                        deleteQuietly(canonical);
                        moveAtomically(temp, canonical);
                    } catch (IOException exception) {
                        deleteQuietly(temp);
                        throw new IllegalStateException("迁移旧 Skill 受管副本失败: " + skill.getSkillId(), exception);
                    }
                }
                for (Path legacy : legacyPaths) {
                    if (!legacy.equals(canonical)) {
                        deleteQuietly(legacy);
                    }
                }
            }
            storageInitialized = true;
        }
    }

    private long safeLastModified(Path path) {
        try {
            return Files.getLastModifiedTime(path).toMillis();
        } catch (IOException exception) {
            return 0L;
        }
    }

    private Path resolveLegacyManagedPath(SkillInstallation deployment) {
        return managedSkillsRoot.resolve(deployment.getTargetId()).resolve(deployment.getSkillId()).toAbsolutePath().normalize();
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
                warnings,
                manifest != null
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

    private Path resolveManagedPath(String skillId) {
        Path managedPath = managedSkillsRoot.resolve(skillId).toAbsolutePath().normalize();
        if (!managedPath.startsWith(managedSkillsRoot)) {
            throw new IllegalStateException("Skill 受管目录非法: " + skillId);
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

    private ManagedSkill requireManagedSkill(String skillId) {
        return managedSkillRepository.findBySkillId(skillId)
                .orElseThrow(() -> new IllegalArgumentException("Skill 不存在: " + skillId));
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

    private Map<String, Object> readInstallMarker(Path directory) {
        Path markerPath = directory.resolve(INSTALL_MARKER_FILE);
        if (Files.notExists(markerPath)) {
            return null;
        }
        return jsonCodec.read(readString(markerPath), LinkedHashMap.class);
    }

    private String markerString(Map<String, Object> marker, String key) {
        if (marker == null) {
            return null;
        }
        Object value = marker.get(key);
        return value == null ? null : String.valueOf(value);
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
                                        List<String> warnings,
                                        boolean manifestPresent) {
    }

    public record SkillPackageResult(SkillValidationResult validation,
                                     String directory) {
    }

    public record SkillDeploymentView(String targetId,
                                      String targetPath,
                                      String installedPath,
                                      boolean enabled,
                                      LocalDateTime installedAt,
                                      LocalDateTime updatedAt) {
    }

    public record SkillListItem(String skillId,
                                String repositoryId,
                                String version,
                                String digest,
                                String displayName,
                                String description,
                                int enabledTargetCount,
                                int disabledTargetCount,
                                List<SkillDeploymentView> targets,
                                LocalDateTime installedAt,
                                LocalDateTime updatedAt) {
    }

    public record SkillScanItem(String id,
                                String path,
                                String name,
                                String description,
                                boolean managed,
                                String skillId,
                                Boolean enabled,
                                String version) {
    }

    public record SkillScanDetail(String id,
                                  String path,
                                  String name,
                                  String description,
                                  boolean managed,
                                  String skillId,
                                  Boolean enabled,
                                  String version,
                                  List<SkillFileNode> files) {
    }

    public record SkillDetail(SkillListItem skill,
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

    public record SkillSyncResult(String skillId,
                                  String targetId,
                                  String status,
                                  String message,
                                  SkillDeploymentView createdDeployment) {
    }

}
