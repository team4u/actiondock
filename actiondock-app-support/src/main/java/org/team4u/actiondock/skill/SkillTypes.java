package org.team4u.actiondock.skill;

import com.fasterxml.jackson.annotation.JsonAlias;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Skill 相关的公共数据类型定义。
 * <p>
 * 包含 Skill 管理过程中使用的所有 record 类型，从 {@link SkillService} 中提取。
 */
public final class SkillTypes {

    private SkillTypes() {
    }

    public static final String TARGET_TYPE_CODEX = "CODEX";
    public static final String TARGET_TYPE_CLAUDE = "CLAUDE";
    public static final String TARGET_TYPE_GEMINI = "GEMINI";
    public static final String TARGET_TYPE_CODEBUDDY = "CODEBUDDY";
    public static final String TARGET_TYPE_CUSTOM = "CUSTOM";
    public static final String TARGET_TYPE_ACTIONDOCK_AGENT = "ACTIONDOCK_AGENT";

    public static final Set<String> VALID_TARGET_TYPES = Set.of(
            TARGET_TYPE_CODEX, TARGET_TYPE_CLAUDE, TARGET_TYPE_GEMINI,
            TARGET_TYPE_CODEBUDDY, TARGET_TYPE_CUSTOM, TARGET_TYPE_ACTIONDOCK_AGENT
    );

    public static final String STATUS_SUCCESS = "SUCCESS";
    public static final String STATUS_FAILED = "FAILED";
    public static final String STATUS_SKIPPED = "SKIPPED";
    public static final String STATUS_RUNNING = "RUNNING";

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

        public SkillValidationResult withVersionAndDigest(String version, String digest) {
            return new SkillValidationResult(
                    skillId, displayName, version, description, owner,
                    tags, riskLevel, entrypointPath, digest, warnings, manifestPresent);
        }
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
