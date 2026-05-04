package org.team4u.actiondock.skill;

import org.team4u.actiondock.domain.model.ManagedSkill;
import org.team4u.actiondock.domain.model.SkillInstallation;
import org.team4u.actiondock.domain.model.SkillTarget;
import org.team4u.actiondock.domain.port.SkillInstallationRepository;
import org.team4u.actiondock.domain.port.SkillTargetRepository;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Base64;
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

    private static final int MAX_TEXT_PREVIEW_CHARS = 200_000;
    private static final long MAX_IMAGE_PREVIEW_BYTES = 2L * 1024L * 1024L;

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
        String id = SkillFileUtils.normalizeOrDefault(target.getId(), UUID.randomUUID().toString());
        String name = SkillFileUtils.normalize(target.getName(), "SkillTarget 名称不能为空");
        String type = SkillFileUtils.normalizeOrDefault(target.getType(), "CUSTOM").toUpperCase(Locale.ROOT);
        if (!List.of("CODEX", "CLAUDE", "GEMINI", "CODEBUDDY", "CUSTOM", "ACTIONDOCK_AGENT").contains(type)) {
            throw new IllegalArgumentException("SkillTarget type 仅支持 CODEX / CLAUDE / GEMINI / CODEBUDDY / CUSTOM / ACTIONDOCK_AGENT");
        }
        Path rootPath = resolveTargetRoot(SkillFileUtils.normalize(target.getRootPath(), "SkillTarget rootPath 不能为空"));
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

    public List<SkillService.SkillScanItem> scanTarget(String targetId) {
        skillService.initializeManagedSkillStorage();
        SkillTarget target = requireTarget(targetId);
        Path root = resolveTargetRoot(target.getRootPath());
        try {
            if (Files.notExists(root)) {
                Files.createDirectories(root);
            }
            Map<String, SkillInstallation> pathToDeployment = skillInstallationRepository.findByTargetId(targetId).stream()
                    .collect(Collectors.toMap(SkillInstallation::getInstalledPath, item -> item, (left, right) -> left));
            List<SkillService.SkillScanItem> items = new ArrayList<>();
            try (var stream = Files.list(root)) {
                for (Path child : stream.filter(Files::isDirectory).sorted().toList()) {
                    Path skillMd = child.resolve("SKILL.md");
                    if (Files.notExists(skillMd)) {
                        continue;
                    }
                    String content = Files.readString(skillMd, StandardCharsets.UTF_8);
                    SkillFileUtils.Frontmatter frontmatter = SkillFileUtils.parseFrontmatter(content);
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
                    items.add(new SkillService.SkillScanItem(
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

    public SkillService.SkillScanDetail getScanItemDetail(String targetId, String directoryId) {
        skillService.initializeManagedSkillStorage();
        SkillTarget target = requireTarget(targetId);
        Path root = resolveTargetRoot(target.getRootPath());
        Path dir = resolveScanDirectory(root, directoryId);
        String content = SkillFileUtils.readString(dir.resolve("SKILL.md"));
        SkillFileUtils.Frontmatter frontmatter = SkillFileUtils.parseFrontmatter(content);
        SkillInstallation deployment = skillInstallationRepository.findByTargetId(targetId).stream()
                .filter(item -> Objects.equals(item.getInstalledPath(), dir.toString()))
                .findFirst()
                .orElse(null);
        Map<String, Object> marker = readInstallMarker(dir);
        boolean managed = deployment != null || marker != null;
        String skillId = deployment != null ? deployment.getSkillId() : markerString(marker, "skillId");
        Boolean enabled = deployment != null ? deployment.isEnabled() : null;
        String version = deployment != null ? deployment.getVersion() : markerString(marker, "version");
        return new SkillService.SkillScanDetail(
                dir.getFileName().toString(),
                dir.toString(),
                frontmatter.name(),
                frontmatter.description(),
                managed,
                skillId,
                enabled,
                version,
                SkillFileUtils.buildFileTree(dir, dir)
        );
    }

    public SkillService.SkillFilePreview previewScanItemFile(String targetId, String directoryId, String relativePath) {
        SkillTarget skillTarget = requireTarget(targetId);
        Path root = resolveTargetRoot(skillTarget.getRootPath());
        Path dir = resolveScanDirectory(root, directoryId);
        Path file = resolveScanFile(dir, relativePath);
        if (Files.notExists(file)) {
            throw new IllegalArgumentException("Skill 文件不存在: " + relativePath);
        }
        if (Files.isDirectory(file)) {
            return new SkillService.SkillFilePreview(
                    dir.relativize(file).toString().replace('\\', '/'),
                    file.getFileName().toString(),
                    true,
                    SkillFileUtils.detectContentType(file),
                    SkillFileUtils.fileSize(file),
                    "DIRECTORY",
                    null,
                    null,
                    null,
                    false
            );
        }
        String relative = dir.relativize(file).toString().replace('\\', '/');
        String contentType = SkillFileUtils.detectContentType(file);
        long size = SkillFileUtils.fileSize(file);
        if (SkillFileUtils.isImageFile(contentType)) {
            if (size > MAX_IMAGE_PREVIEW_BYTES) {
                return new SkillService.SkillFilePreview(relative, file.getFileName().toString(), false, contentType, size, "UNSUPPORTED", null, null, null, true);
            }
            try {
                String dataUrl = "data:" + contentType + ";base64," + Base64.getEncoder().encodeToString(Files.readAllBytes(file));
                return new SkillService.SkillFilePreview(relative, file.getFileName().toString(), false, contentType, size, "IMAGE", null, null, dataUrl, false);
            } catch (IOException exception) {
                throw new IllegalStateException("读取 Skill 文件失败: " + relativePath, exception);
            }
        }
        if (!SkillFileUtils.isTextFile(file, contentType)) {
            return new SkillService.SkillFilePreview(relative, file.getFileName().toString(), false, contentType, size, "UNSUPPORTED", null, null, null, false);
        }
        String text = SkillFileUtils.readString(file);
        boolean truncated = text.length() > MAX_TEXT_PREVIEW_CHARS;
        return new SkillService.SkillFilePreview(
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
        if (Files.exists(dir.resolve(SkillFileUtils.INSTALL_MARKER_FILE))) {
            throw new IllegalArgumentException("受管 Skill 目录请使用卸载功能: " + directoryId);
        }
        SkillFileUtils.deleteQuietly(dir);
    }

    public SkillService.SkillSyncResponse syncSkillsToTarget(String targetId, List<String> skillIds) {
        skillService.initializeManagedSkillStorage();
        requireTarget(targetId);
        List<String> normalizedIds = skillIds == null ? List.of() : skillIds.stream()
                .map(id -> SkillFileUtils.normalize(id, "skillId 不能为空"))
                .distinct()
                .toList();
        List<SkillService.SkillSyncResult> results = new ArrayList<>();
        for (String skillId : normalizedIds) {
            if (skillInstallationRepository.findBySkillIdAndTargetId(skillId, targetId).isPresent()) {
                results.add(new SkillService.SkillSyncResult(skillId, targetId, "SKIPPED", "Skill 已安装在当前目标，无需同步", null));
                continue;
            }
            ManagedSkill skill = skillService.requireManagedSkill(skillId);
            Path managedPath = skillService.resolveManagedPath(skillId);
            if (Files.notExists(managedPath.resolve("SKILL.md"))) {
                results.add(new SkillService.SkillSyncResult(skillId, targetId, "FAILED", "Skill 受管副本不存在", null));
                continue;
            }
            Path targetRoot = resolveTargetRoot(requireTarget(targetId).getRootPath());
            Path targetDirectory = targetRoot.resolve(skillId).toAbsolutePath().normalize();
            if (Files.exists(targetDirectory) && Files.notExists(targetDirectory.resolve(SkillFileUtils.INSTALL_MARKER_FILE))) {
                results.add(new SkillService.SkillSyncResult(skillId, targetId, "SKIPPED", "目标中已存在同名未受管目录，已跳过", null));
                continue;
            }
            try {
                SkillService.SkillValidationResult validation = skillService.validateDirectory(managedPath, skillId, false);
                SkillInstallation created = skillService.deployManagedSkillToTarget(skill, targetId, validation, null);
                results.add(new SkillService.SkillSyncResult(skillId, targetId, "SUCCESS", "Skill 已同步", toDeploymentView(created)));
            } catch (RuntimeException exception) {
                results.add(new SkillService.SkillSyncResult(skillId, targetId, "FAILED", exception.getMessage(), null));
            }
        }
        return new SkillService.SkillSyncResponse(targetId, results);
    }

    // ------------------------------------------------------------------
    // Package-private helpers (exposed for internal collaboration)
    // ------------------------------------------------------------------

    SkillTarget requireTarget(String id) {
        return skillTargetRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("SkillTarget 不存在: " + id));
    }

    Path resolveTargetRoot(String rootPath) {
        String expandedPath = expandHomeShortcut(rootPath);
        Path path = Path.of(expandedPath).toAbsolutePath().normalize();
        if (!path.isAbsolute()) {
            throw new IllegalArgumentException("SkillTarget rootPath 必须是绝对路径");
        }
        return path;
    }

    boolean ensureDirectoryWritable(Path path) {
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

    // ------------------------------------------------------------------
    // Private helpers
    // ------------------------------------------------------------------

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

    private Path resolveScanDirectory(Path root, String directoryId) {
        String normalized = SkillFileUtils.normalize(directoryId, "目录 ID 不能为空");
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
        String normalized = SkillFileUtils.normalize(relativePath, "Skill 文件路径不能为空");
        if (normalized.startsWith("/")) {
            throw new IllegalArgumentException("Skill 文件路径非法: " + normalized);
        }
        Path target = scanDir.resolve(normalized).normalize();
        if (!target.startsWith(scanDir)) {
            throw new IllegalArgumentException("Skill 文件路径越界: " + normalized);
        }
        return target;
    }

    private Map<String, Object> readInstallMarker(Path directory) {
        Path markerPath = directory.resolve(SkillFileUtils.INSTALL_MARKER_FILE);
        if (Files.notExists(markerPath)) {
            return null;
        }
        return skillService.getJsonCodec().read(SkillFileUtils.readString(markerPath), java.util.LinkedHashMap.class);
    }

    private String markerString(Map<String, Object> marker, String key) {
        if (marker == null) {
            return null;
        }
        Object value = marker.get(key);
        return value == null ? null : String.valueOf(value);
    }

    private SkillService.SkillDeploymentView toDeploymentView(SkillInstallation deployment) {
        return new SkillService.SkillDeploymentView(
                deployment.getTargetId(),
                deployment.getTargetPath(),
                deployment.getInstalledPath(),
                deployment.isEnabled(),
                deployment.getInstalledAt(),
                deployment.getUpdatedAt()
        );
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
}
