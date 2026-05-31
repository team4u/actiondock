package org.team4u.actiondock.repository;

import org.team4u.actiondock.skill.SkillFileUtils;
import org.team4u.actiondock.skill.SkillArchiveManager;
import org.team4u.actiondock.skill.SkillTypes;
import org.team4u.actiondock.common.NormalizeUtils;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

/**
 * Skill 仓库发布器，负责将 Skill 归档解压、验证并写入仓库目录。
 *
 * <p>发布流程：解压归档 → 验证 Skill 结构 → 复制文件到仓库目录 → 更新索引 → 提交推送。</p>
 *
 * @author jay.wu
 */
final class SkillRepositoryPublisher {
    private static final String SKILLS_DIR = "skills";

    private final RepositoryCatalogService catalog;

    SkillRepositoryPublisher(RepositoryCatalogService catalog) {
        this.catalog = catalog;
    }

    /**
     * 发布 Skill 归档到指定仓库。
     *
     * @param repositoryId 仓库 ID
     * @param releaseNotes 发布说明
     * @param fileName      归档文件名（用于校验）
     * @param content       归档 ZIP 内容
     * @return 发布后的 Skill 描述信息
     */
    RepositorySkillDescriptor publish(String repositoryId,
                                      String version,
                                      String releaseNotes,
                                      String fileName,
                                      byte[] content) {
        WritableRepositorySession session = catalog.openWritableRepositorySession(repositoryId);

        Path tempDir = null;
        try {
            tempDir = Files.createTempDirectory("skill-publish-archive-");
            SkillArchiveManager.unzipArchive(content, tempDir);
            Path skillRoot = SkillFileUtils.locateSkillRoot(tempDir);
            SkillTypes.SkillValidationResult validation = SkillFileUtils.validateSkillDirectory(
                    skillRoot, fileName, false, catalog.jsonCodec());

            String normalizedVersion = NormalizeUtils.normalizeOrDefault(version, validation.version());
            normalizedVersion = NormalizeUtils.normalize(normalizedVersion, SkillFileUtils.ERR_VERSION_REQUIRED);
            String skillId = NormalizeUtils.normalize(validation.skillId(), "skillId 不能为空");

            RepositoryCatalogTypes.assertSkillVersionAvailable(
                    session.repository().getId(), session.index(), skillId, normalizedVersion);
            copySkillToRepository(session, skillRoot, validation, normalizedVersion);
            session.commitPublishedAsset(skillId, normalizedVersion, releaseNotes);
            catalog.refreshRepositoryCache(repositoryId);

            return catalog.getRepositorySkill(repositoryId, skillId).descriptor();
        } catch (IOException exception) {
            throw new IllegalStateException("写入 Skill 仓库文件失败", exception);
        } finally {
            SkillFileUtils.deleteQuietly(tempDir);
        }
    }

    private void copySkillToRepository(WritableRepositorySession session,
                                       Path skillRoot,
                                       SkillTypes.SkillValidationResult validation,
                                       String normalizedVersion) throws IOException {
        String skillId = validation.skillId();
        Path skillDir = session.root().resolve(SKILLS_DIR).resolve(skillId);
        Path tempSkillDir = SkillFileUtils.tempDirectoryFor(skillDir);
        Files.createDirectories(skillDir.getParent());
        SkillFileUtils.copyDirectory(skillRoot, tempSkillDir);
        SkillFileUtils.deleteQuietly(tempSkillDir.resolve(SkillFileUtils.INSTALL_MARKER_FILE));
        SkillArchiveManager.writeManifest(tempSkillDir, validation, normalizedVersion, catalog.jsonCodec());
        SkillFileUtils.swapTempToTarget(skillDir, tempSkillDir);
    }
}
