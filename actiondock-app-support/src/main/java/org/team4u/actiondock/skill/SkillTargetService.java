package org.team4u.actiondock.skill;

import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.model.ManagedSkill;
import org.team4u.actiondock.domain.model.SkillInstallation;
import org.team4u.actiondock.domain.model.SkillTarget;
import org.team4u.actiondock.domain.port.SkillInstallationRepository;
import org.team4u.actiondock.domain.port.SkillTargetRepository;
import org.team4u.actiondock.common.NormalizeUtils;

import static org.team4u.actiondock.skill.SkillTypes.*;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Skill 目标目录管理服务。
 *
 * <p>负责 SkillTarget 的增删改查、目标目录扫描、文件预览以及
 * 将已受管的 Skill 同步到指定目标目录等与「目标」相关的操作。</p>
 */
public class SkillTargetService {

    private final SkillTargetRepository skillTargetRepository;
    private final SkillInstallationRepository skillInstallationRepository;
    private final SkillService skillService;

    public SkillTargetService(SkillTargetRepository skillTargetRepository,
                              SkillInstallationRepository skillInstallationRepository,
                              SkillService skillService) {
        this.skillTargetRepository = skillTargetRepository;
        this.skillInstallationRepository = skillInstallationRepository;
        this.skillService = skillService;
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    public List<SkillTarget> listTargets() {
        return skillTargetRepository.findAll().stream()
                .sorted(Comparator.comparing(SkillTarget::getName, Comparator.nullsLast(String::compareToIgnoreCase)))
                .toList();
    }

    public SkillTarget saveTarget(SkillTarget request) {
        SkillTarget target = request == null ? new SkillTarget() : request;
        String id = NormalizeUtils.normalizeOrDefault(target.getId(), UUID.randomUUID().toString());
        String name = NormalizeUtils.normalize(target.getName(), "SkillTarget 名称不能为空");
        String type = NormalizeUtils.normalizeOrDefault(target.getType(), TARGET_TYPE_CUSTOM).toUpperCase(Locale.ROOT);
        if (!VALID_TARGET_TYPES.contains(type)) {
            throw new IllegalArgumentException("SkillTarget type 仅支持 " + String.join(" / ", VALID_TARGET_TYPES));
        }
        Path rootPath = SkillFileUtils.resolveTargetRoot(NormalizeUtils.normalize(target.getRootPath(), "SkillTarget rootPath 不能为空"));
        boolean writable = SkillFileUtils.ensureDirectoryWritable(rootPath);
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

    public List<SkillTypes.SkillScanItem> scanTarget(String targetId) {
        skillService.initializeManagedSkillStorage();
        SkillTarget target = requireTarget(targetId);
        Path root = SkillFileUtils.resolveTargetRoot(target.getRootPath());
        try {
            if (Files.notExists(root)) {
                Files.createDirectories(root);
            }
            Map<String, SkillInstallation> pathToDeployment = skillInstallationRepository.findByTargetId(targetId).stream()
                    .collect(Collectors.toMap(SkillInstallation::getInstalledPath, item -> item, (left, right) -> left));
            List<SkillTypes.SkillScanItem> items = new ArrayList<>();
            try (var stream = Files.list(root)) {
                for (Path child : stream.filter(Files::isDirectory).sorted().toList()) {
                    Path skillMd = child.resolve(SkillFileUtils.SKILL_MANIFEST_FILE);
                    if (Files.notExists(skillMd)) {
                        continue;
                    }
                    String content = Files.readString(skillMd, StandardCharsets.UTF_8);
                    SkillManifestReader.Frontmatter frontmatter = SkillManifestReader.parseFrontmatter(content);
                    SkillInstallation deployment = pathToDeployment.get(child.toString());
                    ScannedInstallation scanned = scanInstallation(deployment, child);
                    items.add(new SkillTypes.SkillScanItem(
                            child.getFileName().toString(),
                            child.toString(),
                            frontmatter.name(),
                            frontmatter.description(),
                            scanned.managed(),
                            scanned.skillId(),
                            scanned.enabled(),
                            scanned.version()
                    ));
                }
            }
            return items;
        } catch (IOException exception) {
            throw new IllegalStateException("扫描 Skill 目标失败: " + target.getRootPath(), exception);
        }
    }

    public SkillTypes.SkillScanDetail getScanItemDetail(String targetId, String directoryId) {
        skillService.initializeManagedSkillStorage();
        SkillTarget target = requireTarget(targetId);
        Path root = SkillFileUtils.resolveTargetRoot(target.getRootPath());
        Path dir = resolveScanDirectory(root, directoryId);
        String content = SkillFileUtils.readString(dir.resolve(SkillFileUtils.SKILL_MANIFEST_FILE));
        SkillManifestReader.Frontmatter frontmatter = SkillManifestReader.parseFrontmatter(content);
        SkillInstallation deployment = skillInstallationRepository.findByTargetId(targetId).stream()
                .filter(item -> Objects.equals(item.getInstalledPath(), dir.toString()))
                .findFirst()
                .orElse(null);
        ScannedInstallation scanned = scanInstallation(deployment, dir);
        return new SkillTypes.SkillScanDetail(
                dir.getFileName().toString(),
                dir.toString(),
                frontmatter.name(),
                frontmatter.description(),
                scanned.managed(),
                scanned.skillId(),
                scanned.enabled(),
                scanned.version(),
                SkillFilePreviewBuilder.buildFileTree(dir, dir)
        );
    }

    public SkillTypes.SkillFilePreview previewScanItemFile(String targetId, String directoryId, String relativePath) {
        SkillTarget skillTarget = requireTarget(targetId);
        Path root = SkillFileUtils.resolveTargetRoot(skillTarget.getRootPath());
        Path dir = resolveScanDirectory(root, directoryId);
        Path file = SkillFileUtils.resolveManagedFile(dir, relativePath);
        if (Files.notExists(file)) {
            throw new IllegalArgumentException("Skill 文件不存在: " + relativePath);
        }
        return SkillFilePreviewBuilder.buildFilePreview(dir, file);
    }

    public void deleteUnmanagedScanDirectory(String targetId, String directoryId) {
        SkillTarget target = requireTarget(targetId);
        Path root = SkillFileUtils.resolveTargetRoot(target.getRootPath());
        Path dir = resolveScanDirectory(root, directoryId);
        if (Files.exists(dir.resolve(SkillFileUtils.INSTALL_MARKER_FILE))) {
            throw new IllegalArgumentException("受管 Skill 目录请使用卸载功能: " + directoryId);
        }
        SkillFileUtils.deleteQuietly(dir);
    }

    public SkillTypes.SkillSyncResponse syncSkillsToTarget(String targetId, List<String> skillIds) {
        skillService.initializeManagedSkillStorage();
        requireTarget(targetId);
        List<String> normalizedIds = normalizeSkillIds(skillIds);
        List<SkillTypes.SkillSyncResult> results = new ArrayList<>();
        for (String skillId : normalizedIds) {
            results.add(syncSingleSkill(skillId, targetId));
        }
        return new SkillTypes.SkillSyncResponse(targetId, results);
    }

    private static List<String> normalizeSkillIds(List<String> skillIds) {
        return NormalizeUtils.nullSafeList(skillIds).stream()
                .map(id -> NormalizeUtils.normalize(id, "skillId 不能为空"))
                .distinct()
                .toList();
    }

    private SkillTypes.SkillSyncResult syncSingleSkill(String skillId, String targetId) {
        if (skillInstallationRepository.findBySkillIdAndTargetId(skillId, targetId).isPresent()) {
            return new SkillTypes.SkillSyncResult(skillId, targetId, STATUS_SKIPPED, "Skill 已安装在当前目标，无需同步", null);
        }
        ManagedSkill skill = skillService.requireManagedSkill(skillId);
        Path managedPath = skillService.resolveManagedPath(skillId);
        if (Files.notExists(managedPath.resolve(SkillFileUtils.SKILL_MANIFEST_FILE))) {
            return new SkillTypes.SkillSyncResult(skillId, targetId, STATUS_FAILED, "Skill 受管副本不存在", null);
        }
        Path targetRoot = SkillFileUtils.resolveTargetRoot(requireTarget(targetId).getRootPath());
        Path targetDirectory = NormalizeUtils.normalizePath(targetRoot.resolve(skillId));
        if (Files.exists(targetDirectory) && Files.notExists(targetDirectory.resolve(SkillFileUtils.INSTALL_MARKER_FILE))) {
            return new SkillTypes.SkillSyncResult(skillId, targetId, STATUS_SKIPPED, "目标中已存在同名未受管目录，已跳过", null);
        }
        try {
            SkillTypes.SkillValidationResult validation = skillService.validateDirectory(managedPath, skillId, false);
            SkillInstallation created = skillService.deployManagedSkillToTarget(skill, targetId, validation, null);
            return new SkillTypes.SkillSyncResult(skillId, targetId, STATUS_SUCCESS, "Skill 已同步", SkillService.toDeploymentView(created));
        } catch (RuntimeException exception) {
            return new SkillTypes.SkillSyncResult(skillId, targetId, STATUS_FAILED, exception.getMessage(), null);
        }
    }

    // ------------------------------------------------------------------
    // Package-private helpers (exposed for internal collaboration)
    // ------------------------------------------------------------------

    SkillTarget requireTarget(String id) {
        return skillTargetRepository.findById(id)
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.SKILL_TARGET_NOT_FOUND,
                        "SkillTarget 不存在: " + id,
                        Map.of("targetId", id)
                ));
    }

    // ------------------------------------------------------------------
    // Private helpers
    // ------------------------------------------------------------------

    private static Path resolveScanDirectory(Path root, String directoryId) {
        String normalized = NormalizeUtils.normalize(directoryId, "目录 ID 不能为空");
        Path dir = NormalizeUtils.normalizePath(root.resolve(normalized));
        if (!dir.startsWith(root)) {
            throw new IllegalArgumentException("目录路径越界: " + directoryId);
        }
        if (Files.notExists(dir) || !Files.isDirectory(dir)) {
            throw new IllegalArgumentException("目录不存在: " + directoryId);
        }
        if (Files.notExists(dir.resolve(SkillFileUtils.SKILL_MANIFEST_FILE))) {
            throw new IllegalArgumentException("不是有效的 Skill 目录: " + directoryId);
        }
        return dir;
    }

    /**
     * 扫描结果，封装从 SkillInstallation 和 install-marker 中提取的公共字段。
     */
    private record ScannedInstallation(String skillId, Boolean enabled, String version, boolean managed) {}

    /**
     * 从给定的 SkillInstallation 和目录中提取扫描信息。
     *
     * <p>读取 install-marker 文件，结合 deployment 记录，统一计算
     * skillId / enabled / version / managed 等字段。</p>
     */
    private ScannedInstallation scanInstallation(SkillInstallation deployment, Path directory) {
        Map<String, Object> marker = SkillArchiveManager.readInstallMarker(directory, skillService.getJsonCodec());
        boolean managed = deployment != null || marker != null;
        String skillId = deployment != null
                ? deployment.getSkillId()
                : SkillFileUtils.markerString(marker, "skillId");
        Boolean enabled = deployment != null ? deployment.isEnabled() : null;
        String version = deployment != null
                ? deployment.getVersion()
                : SkillFileUtils.markerString(marker, "version");
        return new ScannedInstallation(skillId, enabled, version, managed);
    }
}
