package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.skill.SkillFileUtils;
import org.team4u.actiondock.skill.SkillArchiveManager;
import org.team4u.actiondock.skill.SkillTypes;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;


/**
 * 仓库 Skill 发现、导出和发布服务。
 * <p>
 * 从 {@link RepositoryCatalogService} 中提取，负责 Skill 的列表查询、详情获取、
 * 归档导出以及通过上传归档发布 Skill 等职责。
 * 内部实现仍委托给 {@link RepositoryCatalogService} 的 package-private 方法。
 *
 * @author jay.wu
 */
public class RepositorySkillService {

    private final RepositoryCatalogService catalog;
    private final JsonCodec jsonCodec;
    private final Path repositoriesRoot;

    public RepositorySkillService(RepositoryCatalogService catalog,
                                  JsonCodec jsonCodec,
                                  Path repositoriesRoot) {
        this.catalog = catalog;
        this.jsonCodec = jsonCodec;
        this.repositoriesRoot = repositoriesRoot;
    }

    /**
     * 列出所有仓库中的 Skill 描述符。
     *
     * @return 所有仓库中已启用的 Skill 描述符列表，按 skillId 排序
     */
    public List<RepositorySkillDescriptor> listAllRepositorySkills() {
        List<RepositorySkillDescriptor> skills = new ArrayList<>();
        for (RepositoryDefinition repository : catalog.listRepositories()) {
            if (!repository.isEnabled()) {
                continue;
            }
            skills.addAll(listRepositorySkills(repository.getId()));
        }
        return skills.stream()
                .sorted(Comparator.comparing(RepositorySkillDescriptor::skillId))
                .toList();
    }

    /**
     * 列出指定仓库中的所有 Skill 描述符。
     *
     * @param repositoryId 仓库 ID
     * @return 该仓库中的 Skill 描述符列表，按 skillId 排序
     */
    public List<RepositorySkillDescriptor> listRepositorySkills(String repositoryId) {
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        RepositoryIndexFile index = catalog.readRepositoryIndex(repository);
        List<RepositorySkillDescriptor> skills = new ArrayList<>();
        for (RepositorySkillIndexEntry entry : catalog.safeSkills(index)) {
            SkillFile skill = catalog.readSkillFile(repository, entry.skillPath());
            skills.add(RepositoryCatalogService.toSkillDescriptor(repository, skill, entry.skillPath()));
        }
        return skills.stream()
                .sorted(Comparator.comparing(RepositorySkillDescriptor::skillId))
                .toList();
    }

    /**
     * 获取指定仓库中某个 Skill 的详细信息。
     *
     * @param repositoryId 仓库 ID
     * @param skillId      Skill ID
     * @return Skill 详情，包含描述符和入口文件内容
     */
    public RepositorySkillDetail getRepositorySkill(String repositoryId, String skillId) {
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        RepositoryIndexFile index = catalog.readRepositoryIndex(repository);
        RepositorySkillIndexEntry entry = catalog.safeSkills(index).stream()
                .filter(item -> skillId.equals(item.id()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("仓库 Skill 不存在: " + skillId));
        SkillFile skill = catalog.readSkillFile(repository, entry.skillPath());
        Path skillDir = Path.of(entry.skillPath()).getParent();
        String entrypoint = SkillFileUtils.normalizeOrDefault(skill.entrypointPath(), SkillFileUtils.SKILL_MANIFEST_FILE);
        String content = catalog.readRepositoryFile(repository, skillDir.resolve(Path.of(entrypoint)));
        return new RepositorySkillDetail(RepositoryCatalogService.toSkillDescriptor(repository, skill, entry.skillPath()), content);
    }

    /**
     * 导出指定仓库中某个 Skill 的归档文件。
     *
     * @param repositoryId 仓库 ID
     * @param skillId      Skill ID
     * @return Skill 归档，包含文件名和字节数组内容
     */
    public RepositoryBinaryArchive exportRepositorySkillArchive(String repositoryId, String skillId) {
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        if (REPO_TYPE_HTTP.equals(repository.getType())) {
            throw new IllegalArgumentException(ERR_HTTP_REPO_UNSUPPORTED_EXPORT);
        }
        RepositoryIndexFile index = catalog.readRepositoryIndex(repository);
        RepositorySkillIndexEntry entry = catalog.safeSkills(index).stream()
                .filter(item -> skillId.equals(item.id()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("仓库 Skill 不存在: " + skillId));
        SkillFile skill = catalog.readSkillFile(repository, entry.skillPath());
        Path skillRoot = catalog.safeResolveRepositoryPath(catalog.resolveRepositoryRoot(repository), Path.of(entry.skillPath()).getParent().toString().replace('\\', '/'));
        SkillTypes.SkillValidationResult validation = SkillFileUtils.validateSkillDirectory(skillRoot, skill.skillId(), true, jsonCodec);
        return new RepositoryBinaryArchive(
                validation.skillId() + ".zip",
                SkillArchiveManager.buildArchive(skillRoot, validation, validation.version(), jsonCodec)
        );
    }

    /**
     * 通过上传 Skill 归档发布 Skill。
     *
     * @param repositoryId 仓库 ID
     * @param releaseNotes 发布说明
     * @param fileName     文件名
     * @param content      归档字节数组内容
     * @return 发布后的 Skill 描述符
     */
    public RepositorySkillDescriptor publishSkillArchive(String repositoryId,
                                                                                  String releaseNotes,
                                                                                  String fileName,
                                                                                  byte[] content) {
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        assertNonHttpRepository(repository);
        Path tempDir = null;
        try {
            tempDir = Files.createTempDirectory(repositoriesRoot, "skill-publish-archive-");
            SkillArchiveManager.unzipArchive(content, tempDir);
            Path skillRoot = SkillFileUtils.locateSkillRoot(tempDir);
            SkillTypes.SkillValidationResult validation = SkillFileUtils.validateSkillDirectory(skillRoot, fileName, false, jsonCodec);
            return publishSkillDirectory(repository, skillRoot, validation, releaseNotes);
        } catch (IOException exception) {
            throw new IllegalStateException("写入 Skill 仓库文件失败", exception);
        } finally {
            SkillFileUtils.deleteQuietly(tempDir);
        }
    }

    private static void assertNonHttpRepository(RepositoryDefinition repository) {
        if (REPO_TYPE_HTTP.equals(repository.getType())) {
            throw new IllegalArgumentException(ERR_HTTP_REPO_UNSUPPORTED_PUBLISH);
        }
    }

    /**
     * 将 Skill 目录发布到仓库。
     */
    private RepositorySkillDescriptor publishSkillDirectory(RepositoryDefinition repository,
                                                                                     Path skillRoot,
                                                                                     SkillTypes.SkillValidationResult validation,
                                                                                     String releaseNotes) {
        String normalizedVersion = SkillFileUtils.normalize(validation.version(), SkillFileUtils.ERR_VERSION_REQUIRED);
        String skillId = SkillFileUtils.normalize(validation.skillId(), "skillId 不能为空");
        Path root = resolveSkillRepositoryRoot(repository, skillId, normalizedVersion);
        writeSkillFilesToRepository(root, repository, skillRoot, validation, normalizedVersion, releaseNotes, skillId);
        commitSkillPublishIfNeeded(repository, skillId, normalizedVersion, releaseNotes);
        return getRepositorySkill(repository.getId(), skillId).descriptor();
    }

    private Path resolveSkillRepositoryRoot(RepositoryDefinition repository, String skillId, String normalizedVersion) {
        Path root = catalog.resolveRepositoryRoot(repository);
        RepositoryCatalogService.ensureRepositoryWorkspace(root, repository, jsonCodec);
        RepositoryCatalogService.assertSkillVersionAvailable(repository.getId(), catalog.readRepositoryIndexFile(root, repository), skillId, normalizedVersion);
        return root;
    }

    private void writeSkillFilesToRepository(Path root, RepositoryDefinition repository,
                                              Path skillRoot, SkillTypes.SkillValidationResult validation,
                                              String normalizedVersion, String releaseNotes, String skillId) {
        try {
            Path skillDir = root.resolve(SKILLS_DIR).resolve(skillId);
            Path tempSkillDir = SkillFileUtils.tempDirectoryFor(skillDir);
            Files.createDirectories(skillDir.getParent());
            SkillFileUtils.copyDirectory(skillRoot, tempSkillDir);
            SkillFileUtils.deleteQuietly(tempSkillDir.resolve(SkillFileUtils.INSTALL_MARKER_FILE));
            SkillArchiveManager.writeManifest(tempSkillDir, validation, normalizedVersion, jsonCodec);
            SkillFileUtils.swapTempToTarget(skillDir, tempSkillDir);
            updateRepositorySkillIndex(root, repository, validation, normalizedVersion, releaseNotes);
        } catch (IOException exception) {
            throw new IllegalStateException("写入 Skill 仓库文件失败", exception);
        }
    }

    private void commitSkillPublishIfNeeded(RepositoryDefinition repository, String skillId, String normalizedVersion, String releaseNotes) {
        if (REPO_TYPE_GIT.equals(repository.getType())) {
            catalog.commitAndPush(repository, skillId, normalizedVersion, releaseNotes);
        }
    }

    /**
     * 将 Skill 文件信息转换为描述符。
     *
     * @param repository 仓库定义
     * @param skill      Skill 文件记录
     * @param skillPath  Skill 清单文件路径
     * @return Skill 描述符
     */

    /**
     * 更新仓库索引中的 Skill 条目。
     *
     * @param root        仓库根目录
     * @param repository  仓库定义
     * @param validation  Skill 校验结果
     * @param version     版本号
     * @param releaseNotes 发布说明
     */
    private void updateRepositorySkillIndex(Path root,
                                            RepositoryDefinition repository,
                                            SkillTypes.SkillValidationResult validation,
                                            String version,
                                            String releaseNotes) {
        RepositoryIndexFile current = catalog.readRepositoryIndexFile(root, repository);
        RepositorySkillIndexEntry next = RepositorySkillIndexEntry.fromSkillValidation(validation, version, releaseNotes);
        List<RepositorySkillIndexEntry> entries =
                RepositoryCatalogTypes.upsertSorted(catalog.safeSkills(current), next, RepositorySkillIndexEntry::id);
        catalog.writeJson(root.resolve(REPOSITORY_INDEX_FILE), RepositoryCatalogTypes.withSkills(current, repository, entries));
    }
}
