package org.team4u.actiondock.skill;

import com.fasterxml.jackson.annotation.JsonAlias;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.ManagedSkill;
import org.team4u.actiondock.domain.model.SkillInstallation;
import org.team4u.actiondock.domain.model.SkillTarget;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.ManagedSkillRepository;
import org.team4u.actiondock.domain.port.SkillInstallationRepository;
import org.team4u.actiondock.domain.port.SkillTargetRepository;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * 本地 Skill 目标与安装服务。
 */
public class SkillService {
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

    /**
     * 返回 JSON 编解码器，供同包内的 {@link SkillTargetService} 读取安装标记使用。
     */
    JsonCodec getJsonCodec() {
        return jsonCodec;
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

    public RuntimeSkill requireRuntimeSkill(String skillId) {
        initializeManagedSkillStorage();
        ManagedSkill skill = requireManagedSkill(skillId);
        SkillListItem item = toSkillListItem(skill);
        if (item.enabledTargetCount() <= 0) {
            throw new IllegalArgumentException("Skill 未启用，不能配置到 Agent: " + skillId);
        }
        Path managedPath = resolveManagedPath(skillId);
        Path entrypoint = managedPath.resolve("SKILL.md");
        if (Files.notExists(entrypoint)) {
            throw new IllegalArgumentException("Skill 受管副本不存在，不能配置到 Agent: " + skillId);
        }
        String content = SkillFileUtils.readString(entrypoint);
        Map<String, String> resources = readRuntimeSkillResources(managedPath);
        return new RuntimeSkill(
                skill.getSkillId(),
                SkillFileUtils.normalizeOrDefault(skill.getDisplayName(), skill.getSkillId()),
                SkillFileUtils.normalizeOrDefault(skill.getDescription(), skill.getSkillId()),
                content,
                resources,
                managedPath.toString()
        );
    }

    public SkillListItem disableSkill(String skillId) {
        initializeManagedSkillStorage();
        List<SkillInstallation> deployments = skillInstallationRepository.findBySkillId(skillId);
        if (deployments.isEmpty()) {
            throw new IllegalArgumentException("Skill 未安装到任何目标: " + skillId);
        }
        for (SkillInstallation deployment : deployments) {
            Path installedPath = Path.of(deployment.getInstalledPath()).toAbsolutePath().normalize();
            if (Files.exists(installedPath) && Files.notExists(installedPath.resolve(SkillFileUtils.INSTALL_MARKER_FILE))) {
                throw new IllegalArgumentException("仅允许停用 ActionDock 受管 Skill: " + deployment.getInstalledPath());
            }
            SkillFileUtils.deleteQuietly(installedPath);
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
                Files.exists(managedPath) ? SkillFileUtils.buildFileTree(managedPath, managedPath) : List.of()
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
                    SkillFileUtils.detectContentType(target),
                    SkillFileUtils.fileSize(target),
                    "DIRECTORY",
                    null,
                    null,
                    null,
                    false
            );
        }
        String relative = managedPath.relativize(target).toString().replace('\\', '/');
        String contentType = SkillFileUtils.detectContentType(target);
        long size = SkillFileUtils.fileSize(target);
        if (SkillFileUtils.isImageFile(contentType)) {
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
        if (!SkillFileUtils.isTextFile(target, contentType)) {
            return new SkillFilePreview(relative, target.getFileName().toString(), false, contentType, size, "UNSUPPORTED", null, null, null, false);
        }
        String text = SkillFileUtils.readString(target);
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
        if (content.length > SkillFileUtils.MAX_ARCHIVE_SIZE) {
            throw new IllegalArgumentException("Skill 压缩包过大，超过 25MB");
        }
        Path tempDir = createTempDir("skill-validate");
        try {
            SkillFileUtils.unzipArchive(content, tempDir);
            return validateDirectory(tempDir, SkillFileUtils.normalizeArchiveFallbackId(fileName), false);
        } finally {
            SkillFileUtils.deleteQuietly(tempDir);
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
        if (content.length > SkillFileUtils.MAX_ARCHIVE_SIZE) {
            throw new IllegalArgumentException("Skill 压缩包过大，超过 25MB");
        }
        Path tempDir = createTempDir("skill-import");
        try {
            SkillFileUtils.unzipArchive(content, tempDir);
            SkillValidationResult validation = validateDirectory(tempDir, SkillFileUtils.normalizeArchiveFallbackId(fileName), false);
            return installValidatedDirectory(targetIds, tempDir, validation, null);
        } finally {
            SkillFileUtils.deleteQuietly(tempDir);
        }
    }

    public SkillListItem installFromDirectory(List<String> targetIds, String directory) {
        return installFromDirectory(targetIds, directory, null);
    }

    public SkillListItem installFromDirectory(List<String> targetIds, String directory, String repositoryId) {
        Path path = resolveDirectoryPath(directory);
        SkillValidationResult validation = validateDirectory(path);
        return installValidatedDirectory(targetIds, path, validation, SkillFileUtils.normalizeNullable(repositoryId));
    }

    public SkillListItem installArchive(List<String> targetIds, String repositoryId, String fileName, byte[] content) {
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("Skill 压缩包不能为空");
        }
        if (content.length > SkillFileUtils.MAX_ARCHIVE_SIZE) {
            throw new IllegalArgumentException("Skill 压缩包过大，超过 25MB");
        }
        Path tempDir = createTempDir("skill-install-archive");
        try {
            SkillFileUtils.unzipArchive(content, tempDir);
            SkillValidationResult validation = validateSkillDirectory(tempDir, SkillFileUtils.normalizeArchiveFallbackId(fileName), false, jsonCodec);
            return installValidatedDirectory(targetIds, tempDir, validation, repositoryId);
        } finally {
            SkillFileUtils.deleteQuietly(tempDir);
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
        String normalizedVersion = SkillFileUtils.normalize(version, "version 不能为空");
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
            if (Files.exists(installedPath) && Files.exists(installedPath.resolve(SkillFileUtils.INSTALL_MARKER_FILE))) {
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

    public void uninstallSkill(String skillId) {
        initializeManagedSkillStorage();
        requireManagedSkill(skillId);
        for (SkillInstallation deployment : skillInstallationRepository.findBySkillId(skillId)) {
            deleteInstalledPath(deployment);
            skillInstallationRepository.deleteBySkillIdAndTargetId(skillId, deployment.getTargetId());
        }
        SkillFileUtils.deleteQuietly(resolveManagedPath(skillId));
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
            SkillFileUtils.deleteQuietly(resolveManagedPath(skillId));
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
        Path normalizedSourceDirectory = SkillFileUtils.locateSkillRoot(sourceDirectory);
        String managedVersion = resolveManagedVersion(validation, existingSkill);
        SkillValidationResult managedValidation = copyValidationWithVersion(validation, managedVersion);
        Path managedDir = resolveManagedPath(validation.skillId());
        Path tempManagedDir = managedDir.getParent().resolve(managedDir.getFileName() + ".tmp-" + UUID.randomUUID());
        try {
            Files.createDirectories(managedDir.getParent());
            copyDirectory(normalizedSourceDirectory, tempManagedDir);
            SkillFileUtils.deleteQuietly(tempManagedDir.resolve(SkillFileUtils.INSTALL_MARKER_FILE));
            SkillFileUtils.deleteQuietly(managedDir);
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
            SkillFileUtils.deleteQuietly(tempManagedDir);
            throw new IllegalStateException("安装 Skill 失败", exception);
        }
    }

    SkillInstallation deployManagedSkillToTarget(ManagedSkill skill,
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
                if (Files.notExists(finalTargetDir.resolve(SkillFileUtils.INSTALL_MARKER_FILE))) {
                    throw new IllegalArgumentException("目标目录已存在且不是 ActionDock 受管 Skill: " + finalTargetDir);
                }
                moveAtomically(finalTargetDir, backupDir);
            }
            moveAtomically(tempFinalDir, finalTargetDir);
            SkillFileUtils.deleteQuietly(backupDir);
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
            SkillFileUtils.deleteQuietly(tempFinalDir);
            throw new IllegalStateException("安装 Skill 失败", exception);
        }
    }

    private List<String> normalizeTargetIds(List<String> targetIds) {
        List<String> normalized = targetIds == null ? List.of() : targetIds.stream()
                .map(id -> SkillFileUtils.normalize(id, "targetId 不能为空"))
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
            return SkillFileUtils.normalize(validation.version(), "version 不能为空");
        }
        if (existingSkill != null && SkillFileUtils.normalizeNullable(existingSkill.getVersion()) != null) {
            return SkillFileUtils.normalizeNullable(existingSkill.getVersion());
        }
        return SkillFileUtils.normalize(validation.version(), "version 不能为空");
    }

    private static SkillValidationResult copyValidationWithVersion(SkillValidationResult validation, String version) {
        return copyValidationWithVersionAndDigest(validation, version, validation.digest());
    }

    private static SkillValidationResult copyValidationWithVersionAndDigest(SkillValidationResult validation, String version, String digest) {
        return new SkillValidationResult(
                validation.skillId(),
                validation.displayName(),
                SkillFileUtils.normalize(version, "version 不能为空"),
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
        if (Files.exists(installedPath) && Files.notExists(installedPath.resolve(SkillFileUtils.INSTALL_MARKER_FILE))) {
            throw new IllegalArgumentException("仅允许卸载 ActionDock 受管 Skill: " + deployment.getInstalledPath());
        }
        SkillFileUtils.deleteQuietly(installedPath);
    }

    void initializeManagedSkillStorage() {
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
                        SkillFileUtils.deleteQuietly(temp.resolve(SkillFileUtils.INSTALL_MARKER_FILE));
                        SkillFileUtils.deleteQuietly(canonical);
                        moveAtomically(temp, canonical);
                    } catch (IOException exception) {
                        SkillFileUtils.deleteQuietly(temp);
                        throw new IllegalStateException("迁移旧 Skill 受管副本失败: " + skill.getSkillId(), exception);
                    }
                }
                for (Path legacy : legacyPaths) {
                    if (!legacy.equals(canonical)) {
                        SkillFileUtils.deleteQuietly(legacy);
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

    SkillValidationResult validateDirectory(Path directory, String fallbackId, boolean requireManifest) {
        return validateSkillDirectory(directory, fallbackId, requireManifest, jsonCodec);
    }

    public static SkillValidationResult validateSkillDirectory(Path directory,
                                                               String fallbackId,
                                                               boolean requireManifest,
                                                               JsonCodec jsonCodec) {
        return SkillFileUtils.validateSkillDirectory(directory, fallbackId, requireManifest, jsonCodec);
    }

    public static Path locateSkillRoot(Path directory) {
        return SkillFileUtils.locateSkillRoot(directory);
    }

    public static byte[] buildArchive(Path directory,
                                      SkillValidationResult validation,
                                      String manifestVersion,
                                      JsonCodec jsonCodec) {
        return SkillFileUtils.buildArchive(directory, validation, manifestVersion, jsonCodec);
    }

    public static String computePublishDigest(Path directory,
                                              SkillValidationResult validation,
                                              String manifestVersion,
                                              JsonCodec jsonCodec) {
        return SkillFileUtils.computePublishDigest(directory, validation, manifestVersion, jsonCodec);
    }

    public static void unzipArchive(byte[] content, Path directory) {
        SkillFileUtils.unzipArchive(content, directory);
    }

    public static void writeManifest(Path directory,
                                     SkillValidationResult validation,
                                     String manifestVersion,
                                     JsonCodec jsonCodec) {
        SkillFileUtils.writeManifest(directory, validation, manifestVersion, jsonCodec);
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
        Files.writeString(directory.resolve(SkillFileUtils.INSTALL_MARKER_FILE), jsonCodec.write(marker), StandardCharsets.UTF_8);
    }

    private Map<String, Object> readInstallMarker(Path directory) {
        Path markerPath = directory.resolve(SkillFileUtils.INSTALL_MARKER_FILE);
        if (Files.notExists(markerPath)) {
            return null;
        }
        return jsonCodec.read(SkillFileUtils.readString(markerPath), LinkedHashMap.class);
    }

    private String markerString(Map<String, Object> marker, String key) {
        if (marker == null) {
            return null;
        }
        Object value = marker.get(key);
        return value == null ? null : String.valueOf(value);
    }

    Path resolveManagedPath(String skillId) {
        Path managedPath = managedSkillsRoot.resolve(skillId).toAbsolutePath().normalize();
        if (!managedPath.startsWith(managedSkillsRoot)) {
            throw new IllegalStateException("Skill 受管目录非法: " + skillId);
        }
        return managedPath;
    }

    private Path resolveManagedFile(Path managedPath, String relativePath) {
        String normalized = SkillFileUtils.normalize(relativePath, "Skill 文件路径不能为空");
        if (normalized.startsWith("/")) {
            throw new IllegalArgumentException("Skill 文件路径非法: " + normalized);
        }
        Path target = managedPath.resolve(normalized).normalize();
        if (!target.startsWith(managedPath)) {
            throw new IllegalArgumentException("Skill 文件路径越界: " + normalized);
        }
        if (target.getFileName() != null && SkillFileUtils.INSTALL_MARKER_FILE.equals(target.getFileName().toString())) {
            throw new IllegalArgumentException("Skill 文件不可预览: " + normalized);
        }
        return target;
    }

    private Map<String, String> readRuntimeSkillResources(Path managedPath) {
        Map<String, String> resources = new LinkedHashMap<>();
        try (var stream = Files.walk(managedPath)) {
            for (Path file : stream.filter(Files::isRegularFile).sorted().toList()) {
                if (Files.isSymbolicLink(file)) {
                    throw new IllegalArgumentException("Skill 不允许包含符号链接: " + file);
                }
                String relative = managedPath.relativize(file).toString().replace('\\', '/');
                if ("SKILL.md".equals(relative) || "skill.json".equals(relative) || SkillFileUtils.INSTALL_MARKER_FILE.equals(relative)) {
                    continue;
                }
                String contentType = SkillFileUtils.detectContentType(file);
                if (SkillFileUtils.isTextFile(file, contentType)) {
                    resources.put(relative, Files.readString(file, StandardCharsets.UTF_8));
                }
            }
        } catch (IOException exception) {
            throw new IllegalStateException("读取 Agent Skill 资源失败: " + managedPath, exception);
        }
        return resources;
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

    ManagedSkill requireManagedSkill(String skillId) {
        return managedSkillRepository.findBySkillId(skillId)
                .orElseThrow(() -> new IllegalArgumentException("Skill 不存在: " + skillId));
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

    private String expandHomeShortcut(String input) {
        String value = SkillFileUtils.normalize(input, "SkillTarget rootPath 不能为空");
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
        String expandedPath = expandHomeShortcut(SkillFileUtils.normalize(directory, "Skill 目录不能为空"));
        Path path = Path.of(expandedPath).toAbsolutePath().normalize();
        if (!path.isAbsolute()) {
            throw new IllegalArgumentException("Skill 目录必须是绝对路径");
        }
        return path;
    }

    private Path createTempDir(String prefix) {
        try {
            Files.createDirectories(managedSkillsRoot);
            return Files.createTempDirectory(managedSkillsRoot, prefix + "-");
        } catch (IOException exception) {
            throw new IllegalStateException("创建临时 Skill 目录失败", exception);
        }
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

    public record RuntimeSkill(String skillId,
                               String displayName,
                               String description,
                               String skillContent,
                               Map<String, String> resources,
                               String source) {
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
