package org.team4u.actiondock.skill;

import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.model.ManagedSkill;
import org.team4u.actiondock.domain.model.SkillInstallation;
import org.team4u.actiondock.domain.model.SkillTarget;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.ManagedSkillRepository;
import org.team4u.actiondock.domain.port.SkillInstallationRepository;
import org.team4u.actiondock.domain.port.SkillTargetRepository;
import org.team4u.actiondock.common.NormalizeUtils;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;


import static org.team4u.actiondock.skill.SkillTypes.*;

/**
 * 本地 Skill 目标与安装服务。
 */
public class SkillService {

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
        String root = properties == null || NormalizeUtils.isBlank(properties.getSkills().getDir())
                ? AppProperties.defaultSkillsDir()
                : properties.getSkills().getDir();
        this.managedSkillsRoot = NormalizeUtils.normalizePath(root);
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
        ResolvedManagedSkill r = requireAndResolve(skillId);
        SkillListItem item = toSkillListItem(r.skill());
        if (item.enabledTargetCount() <= 0) {
            throw new IllegalArgumentException("Skill 未启用，不能配置到 Agent: " + skillId);
        }
        Path managedPath = r.managedPath();
        Path entrypoint = managedPath.resolve(SkillFileUtils.SKILL_MANIFEST_FILE);
        if (Files.notExists(entrypoint)) {
            throw new IllegalArgumentException("Skill 受管副本不存在，不能配置到 Agent: " + skillId);
        }
        String content = SkillFileUtils.readString(entrypoint);
        Map<String, String> resources = SkillFileUtils.readRuntimeSkillResources(managedPath);
        return new RuntimeSkill(
                r.skill().getSkillId(),
                NormalizeUtils.normalizeOrDefault(r.skill().getDisplayName(), r.skill().getSkillId()),
                NormalizeUtils.normalizeOrDefault(r.skill().getDescription(), r.skill().getSkillId()),
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
        deployments.forEach(deployment -> {
            deleteInstalledPath(deployment);
            skillInstallationRepository.save(deployment.copy()
                    .setEnabled(false)
                    .setUpdatedAt(LocalDateTime.now()));
        });
        return getSkill(skillId);
    }

    public SkillListItem restoreSkill(String skillId) {
        initializeManagedSkillStorage();
        ResolvedManagedSkill r = requireAndResolve(skillId);
        if (Files.notExists(r.managedPath().resolve(SkillFileUtils.SKILL_MANIFEST_FILE))) {
            throw new IllegalArgumentException("Skill 受管副本不存在，无法恢复: " + skillId);
        }
        SkillValidationResult validation = validateDirectory(r.managedPath(), skillId, false);
        for (SkillInstallation deployment : skillInstallationRepository.findBySkillId(skillId)) {
            deployManagedSkillToTarget(r.skill(), deployment.getTargetId(), validation, deployment);
        }
        return getSkill(skillId);
    }

    public SkillDetail getSkillDetail(String skillId) {
        initializeManagedSkillStorage();
        ResolvedManagedSkill r = requireAndResolve(skillId);
        return new SkillDetail(
                toSkillListItem(r.skill()),
                r.managedPath().toString(),
                Files.exists(r.managedPath()) ? SkillFilePreviewBuilder.buildFileTree(r.managedPath(), r.managedPath()) : List.of()
        );
    }

    public SkillArchive exportSkillArchive(String skillId) {
        initializeManagedSkillStorage();
        ResolvedManagedSkill r = requireAndResolve(skillId);
        SkillValidationResult validation = SkillFileUtils.validateSkillDirectory(r.managedPath(), skillId, false, jsonCodec);
        return new SkillArchive(
                skillId + ".zip",
                SkillArchiveManager.buildArchive(r.managedPath(), validation, r.skill().getVersion(), jsonCodec)
        );
    }

    public SkillFilePreview previewSkillFile(String skillId, String relativePath) {
        initializeManagedSkillStorage();
        requireManagedSkill(skillId);
        Path managedPath = resolveManagedPath(skillId);
        Path target = SkillFileUtils.resolveManagedFile(managedPath, relativePath);
        if (Files.notExists(target)) {
            throw new IllegalArgumentException("Skill 文件不存在: " + relativePath);
        }
        return SkillFilePreviewBuilder.buildFilePreview(managedPath, target);
    }

    public SkillValidationResult validateImport(String fileName, byte[] content) {
        SkillArchiveManager.requireValidArchive(content);
        Path tempDir = SkillFileUtils.createTempDir(managedSkillsRoot, "skill-validate");
        try {
            SkillArchiveManager.unzipArchive(content, tempDir);
            return validateDirectory(tempDir, SkillArchiveManager.normalizeArchiveFallbackId(fileName), false);
        } finally {
            SkillFileUtils.deleteQuietly(tempDir);
        }
    }

    public SkillValidationResult validateDirectory(Path directory) {
        return validateDirectory(directory, directory == null ? null : directory.getFileName().toString(), false);
    }

    public SkillPackageResult packageDirectory(Path directory) {
        SkillValidationResult result = validateDirectory(directory);
        return new SkillPackageResult(result, NormalizeUtils.normalizePath(directory).toString());
    }

    public SkillPackageResult packageDirectory(String directory) {
        Path path = SkillFileUtils.resolveDirectoryPath(directory);
        return packageDirectory(path);
    }

    public SkillListItem installFromZip(List<String> targetIds, String fileName, byte[] content) {
        return installArchive(targetIds, null, fileName, content);
    }

    public SkillListItem installFromDirectory(List<String> targetIds, String directory) {
        return installFromDirectory(targetIds, directory, null);
    }

    SkillListItem installFromDirectory(List<String> targetIds, String directory, String repositoryId) {
        Path path = SkillFileUtils.resolveDirectoryPath(directory);
        SkillValidationResult validation = validateDirectory(path);
        return installValidatedDirectory(targetIds, path, validation, NormalizeUtils.normalizeNullable(repositoryId));
    }

    public SkillListItem installArchive(List<String> targetIds, String repositoryId, String fileName, byte[] content) {
        SkillArchiveManager.requireValidArchive(content);
        Path tempDir = SkillFileUtils.createTempDir(managedSkillsRoot, "skill-install-archive");
        try {
            SkillArchiveManager.unzipArchive(content, tempDir);
            SkillValidationResult validation = SkillFileUtils.validateSkillDirectory(tempDir, SkillArchiveManager.normalizeArchiveFallbackId(fileName), false, jsonCodec);
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
        Path path = SkillFileUtils.resolveDirectoryPath(directory);
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
        ResolvedManagedSkill r = requireAndResolve(skillId);
        String normalizedVersion = NormalizeUtils.normalize(version, SkillFileUtils.ERR_VERSION_REQUIRED);
        if (Files.notExists(r.managedPath().resolve(SkillFileUtils.SKILL_MANIFEST_FILE))) {
            throw new IllegalArgumentException("Skill 受管副本不存在: " + skillId);
        }
        String digest = persistManifestAndComputeDigest(r.managedPath(), skillId, normalizedVersion);
        LocalDateTime now = LocalDateTime.now();
        ManagedSkill saved = saveManagedSkillVersion(r.skill(), normalizedVersion, digest, now);
        SkillValidationResult persistedValidation = SkillFileUtils.validateSkillDirectory(r.managedPath(), skillId, false, jsonCodec);
        SkillValidationResult versionedValidation = persistedValidation.withVersionAndDigest(normalizedVersion, digest);
        updateDeploymentVersions(skillId, normalizedVersion, digest, saved, versionedValidation, now);
        return getSkill(skillId);
    }

    private String persistManifestAndComputeDigest(Path managedPath, String skillId, String normalizedVersion) {
        SkillValidationResult validation = SkillFileUtils.validateSkillDirectory(managedPath, skillId, false, jsonCodec);
        return SkillArchiveManager.writeManifest(managedPath, validation, normalizedVersion, jsonCodec);
    }

    private ManagedSkill saveManagedSkillVersion(ManagedSkill existingSkill, String normalizedVersion, String digest, LocalDateTime now) {
        return managedSkillRepository.save(existingSkill.copyWith(normalizedVersion, digest, now));
    }

    private void updateDeploymentVersions(String skillId, String normalizedVersion, String digest,
                                          ManagedSkill saved, SkillValidationResult versionedValidation, LocalDateTime now) {
        for (SkillInstallation deployment : skillInstallationRepository.findBySkillId(skillId)) {
            skillInstallationRepository.save(deployment.copy()
                    .setVersion(normalizedVersion)
                    .setDigest(digest)
                    .setUpdatedAt(now));
            Path installedPath = NormalizeUtils.normalizePath(Path.of(deployment.getInstalledPath()));
            if (Files.exists(installedPath) && Files.exists(installedPath.resolve(SkillFileUtils.INSTALL_MARKER_FILE))) {
                try {
                    SkillArchiveManager.writeManifest(installedPath, versionedValidation, normalizedVersion, jsonCodec);
                    SkillArchiveManager.writeInstallMarker(installedPath, deployment.getInstallationId(), saved.getRepositoryId(), versionedValidation, jsonCodec);
                } catch (IOException exception) {
                    throw new IllegalStateException("更新 Skill 安装标记失败", exception);
                }
            }
        }
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
        List<String> normalizedTargetIds = NormalizeUtils.normalizeTargetIds(targetIds);
        String skillId = validation.skillId();
        ManagedSkill existingSkill = managedSkillRepository.findBySkillId(skillId).orElse(null);
        ManagedSkill savedSkill = writeManagedSkillCopy(sourceDirectory, validation, repositoryId, existingSkill);
        LinkedHashSet<String> allTargetIds = new LinkedHashSet<>(normalizedTargetIds);
        skillInstallationRepository.findBySkillId(skillId).stream()
                .map(SkillInstallation::getTargetId)
                .forEach(allTargetIds::add);
        SkillValidationResult managedValidation = validation.withVersionAndDigest(
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
        SkillValidationResult managedValidation = validation.withVersionAndDigest(managedVersion, validation.digest());
        Path managedDir = resolveManagedPath(validation.skillId());
        copySkillToManagedStorage(normalizedSourceDirectory, managedDir, managedValidation, managedVersion);
        LocalDateTime now = LocalDateTime.now();
        return saveManagedSkillEntity(validation, repositoryId, managedVersion,
                SkillArchiveManager.computePublishDigest(managedDir, managedValidation, managedVersion, jsonCodec),
                existingSkill, now);
    }

    private void copySkillToManagedStorage(Path sourceDirectory, Path managedDir,
                                           SkillValidationResult managedValidation, String version) {
        SkillFileUtils.atomicReplace(sourceDirectory, managedDir);
        SkillArchiveManager.writeManifest(managedDir, managedValidation, version, jsonCodec);
    }

    private ManagedSkill saveManagedSkillEntity(SkillValidationResult validation, String repositoryId,
                                                String version, String digest,
                                                ManagedSkill existingSkill, LocalDateTime now) {
        return managedSkillRepository.save(ManagedSkill.create(
                validation.skillId(), repositoryId, version, digest,
                validation.displayName(), validation.description(), existingSkill, now));
    }

    SkillInstallation deployManagedSkillToTarget(ManagedSkill skill,
                                                         String targetId,
                                                         SkillValidationResult validation,
                                                         SkillInstallation existingDeployment) {
        SkillTarget target = requireTarget(targetId);
        if (!target.isEnabled()) {
            throw new IllegalArgumentException("SkillTarget 已禁用: " + target.getName());
        }
        Path targetRoot = SkillFileUtils.resolveTargetRoot(target.getRootPath());
        SkillFileUtils.ensureDirectoryWritable(targetRoot);
        Path managedDir = resolveManagedPath(skill.getSkillId());
        Path finalTargetDir = NormalizeUtils.normalizePath(targetRoot.resolve(skill.getSkillId()));
        Path tempFinalDir = SkillFileUtils.tempDirectoryFor(finalTargetDir);
        String installationId = skill.getSkillId() + "@" + targetId;
        try {
            Files.createDirectories(targetRoot);
            SkillFileUtils.copyDirectory(managedDir, tempFinalDir);
            SkillArchiveManager.writeInstallMarker(tempFinalDir, installationId, skill.getRepositoryId(), validation, jsonCodec);
            if (Files.exists(finalTargetDir)) {
                if (Files.notExists(finalTargetDir.resolve(SkillFileUtils.INSTALL_MARKER_FILE))) {
                    throw new IllegalArgumentException("目标目录已存在且不是 ActionDock 受管 Skill: " + finalTargetDir);
                }
            }
            SkillFileUtils.swapTempToTarget(finalTargetDir, tempFinalDir);
            LocalDateTime now = LocalDateTime.now();
            SkillInstallation record = SkillInstallation.fromManagedSkillAndTarget(
                    skill, target, finalTargetDir, existingDeployment, installationId, now);
            return skillInstallationRepository.save(record);
        } catch (IOException exception) {
            SkillFileUtils.deleteQuietly(tempFinalDir);
            throw new IllegalStateException("安装 Skill 失败", exception);
        }
    }

    private SkillListItem toSkillListItem(ManagedSkill skill) {
        List<SkillDeploymentView> targets = skillInstallationRepository.findBySkillId(skill.getSkillId()).stream()
                .map(SkillService::toDeploymentView)
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

    static SkillDeploymentView toDeploymentView(SkillInstallation deployment) {
        return new SkillDeploymentView(
                deployment.getTargetId(),
                deployment.getTargetPath(),
                deployment.getInstalledPath(),
                deployment.isEnabled(),
                deployment.getInstalledAt(),
                deployment.getUpdatedAt()
        );
    }


    private static String resolveManagedVersion(SkillValidationResult validation, ManagedSkill existingSkill) {
        if (!validation.manifestPresent() && existingSkill != null) {
            String existingVersion = NormalizeUtils.normalizeNullable(existingSkill.getVersion());
            if (existingVersion != null) {
                return existingVersion;
            }
        }
        return NormalizeUtils.normalize(validation.version(), SkillFileUtils.ERR_VERSION_REQUIRED);
    }

    private static void deleteInstalledPath(SkillInstallation deployment) {
        Path installedPath = NormalizeUtils.normalizePath(Path.of(deployment.getInstalledPath()));
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
                migrateManagedSkillIfNeeded(skill);
            }
            storageInitialized = true;
        }
    }

    private void migrateManagedSkillIfNeeded(ManagedSkill skill) {
        Path canonical = resolveManagedPath(skill.getSkillId());
        List<Path> legacyPaths = skillInstallationRepository.findBySkillId(skill.getSkillId()).stream()
                .map(this::resolveLegacyManagedPath)
                .filter(path -> Files.exists(path.resolve(SkillFileUtils.SKILL_MANIFEST_FILE)))
                .sorted(Comparator.comparing(SkillFileUtils::safeLastModified).reversed())
                .toList();
        if (Files.notExists(canonical.resolve(SkillFileUtils.SKILL_MANIFEST_FILE)) && !legacyPaths.isEmpty()) {
            Path source = legacyPaths.get(0);
            try {
                SkillFileUtils.atomicReplace(source, canonical);
            } catch (IllegalStateException exception) {
                throw new IllegalStateException("迁移旧 Skill 受管副本失败: " + skill.getSkillId(), exception.getCause());
            }
        }
        for (Path legacy : legacyPaths) {
            if (!legacy.equals(canonical)) {
                SkillFileUtils.deleteQuietly(legacy);
            }
        }
    }

    private Path resolveLegacyManagedPath(SkillInstallation deployment) {
        return NormalizeUtils.normalizePath(managedSkillsRoot.resolve(deployment.getTargetId()).resolve(deployment.getSkillId()));
    }

    SkillValidationResult validateDirectory(Path directory, String fallbackId, boolean requireManifest) {
        return SkillFileUtils.validateSkillDirectory(directory, fallbackId, requireManifest, jsonCodec);
    }

    Path resolveManagedPath(String skillId) {
        Path managedPath = NormalizeUtils.normalizePath(managedSkillsRoot.resolve(skillId));
        if (!managedPath.startsWith(managedSkillsRoot)) {
            throw new IllegalStateException("Skill 受管目录非法: " + skillId);
        }
        return managedPath;
    }

    ManagedSkill requireManagedSkill(String skillId) {
        return managedSkillRepository.findBySkillId(skillId)
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.SKILL_NOT_FOUND,
                        "Skill 不存在: " + skillId,
                        Map.of("skillId", skillId)
                ));
    }

    /**
     * 一次性解析 Skill 受管实体与受管目录路径，供多个公开方法复用。
     */
    private record ResolvedManagedSkill(ManagedSkill skill, Path managedPath) {}

    private ResolvedManagedSkill requireAndResolve(String skillId) {
        return new ResolvedManagedSkill(requireManagedSkill(skillId), resolveManagedPath(skillId));
    }

    private SkillTarget requireTarget(String id) {
        return skillTargetRepository.findById(id)
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.SKILL_TARGET_NOT_FOUND,
                        "SkillTarget 不存在: " + id,
                        Map.of("targetId", id)
                ));
    }

}
