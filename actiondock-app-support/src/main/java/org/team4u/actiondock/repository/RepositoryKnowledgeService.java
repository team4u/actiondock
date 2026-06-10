package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.common.NormalizeUtils;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

/**
 * 仓库知识源发现、安装和卸载服务。
 * <p>
 * 知识源是 CAPABILITY 仓库中指向外部知识（git 仓库或本地目录）的指针。
 * 安装时自动注册为 PROJECT 仓库，供 AI agent 通过 resolveProjectRepository 消费。
 *
 * @author jay.wu
 */
public class RepositoryKnowledgeService {

    private static final String KNOWLEDGE_REPO_ID_PREFIX = "knowledge:";

    private final RepositoryCatalogService catalog;

    public RepositoryKnowledgeService(RepositoryCatalogService catalog) {
        this.catalog = catalog;
    }

    public List<RepositoryKnowledgeDescriptor> listAllRepositoryKnowledge() {
        return catalog.listEnabledDiscoveryRepositories().stream()
                .flatMap(repo -> listRepositoryKnowledge(repo.getId()).stream())
                .sorted(Comparator.comparing(RepositoryKnowledgeDescriptor::knowledgeId))
                .toList();
    }

    public List<RepositoryKnowledgeDescriptor> listRepositoryKnowledge(String repositoryId) {
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        RepositoryIndexFile index = catalog.readRepositoryIndex(repository);
        List<RepositoryKnowledgeDescriptor> result = new ArrayList<>();
        for (RepositoryKnowledgeIndexEntry entry : index.safeKnowledge()) {
            result.add(toKnowledgeDescriptor(repository, entry));
        }
        return result.stream()
                .sorted(Comparator.comparing(RepositoryKnowledgeDescriptor::knowledgeId))
                .toList();
    }

    public RepositoryKnowledgeDetail getRepositoryKnowledge(String repositoryId, String knowledgeId) {
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        RepositoryIndexFile index = catalog.readRepositoryIndex(repository);
        RepositoryKnowledgeIndexEntry entry = findKnowledgeEntry(index, knowledgeId);
        KnowledgeFile knowledge = catalog.readKnowledgeFile(repository, entry.knowledgePath());
        return new RepositoryKnowledgeDetail(
                toKnowledgeDescriptor(repository, entry),
                knowledge,
                catalog.readOptionalFile(
                        repository,
                        catalog.parentDirectoryPath(entry.knowledgePath()).resolveNullable(knowledge.configTemplatePath()),
                        ConfigTemplateItem.class
                )
        );
    }

    public RepositoryKnowledgeDescriptor installKnowledge(String repositoryId, String knowledgeId) {
        RepositoryKnowledgeDetail detail = getRepositoryKnowledge(repositoryId, knowledgeId);
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        RepositoryKnowledgeIndexEntry entry = findKnowledgeEntry(catalog.readRepositoryIndex(repository), knowledgeId);
        KnowledgeFile knowledge = detail.knowledge();
        KnowledgeSource source = knowledge.source();

        String installedRepoId = buildInstalledRepositoryId(repositoryId, knowledgeId);

        if (catalog.findRepository(installedRepoId).isPresent()) {
            throw new IllegalArgumentException("知识源已安装: " + knowledgeId);
        }

        RepositoryDefinition projectRepo = new RepositoryDefinition()
                .setId(installedRepoId)
                .setName(knowledge.displayName())
                .setDescription(knowledge.description())
                .setType(source.type())
                .setPurpose(REPO_PURPOSE_PROJECT)
                .setUrl(source.url())
                .setBranch(source.branch())
                .setEnabled(true)
                .setTrustLevel(isTrusted(repository) ? REPO_TRUST_TRUSTED : REPO_TRUST_UNTRUSTED);

        catalog.saveRepository(projectRepo);
        catalog.getConfigTemplateSyncService().syncConfigTemplates(repositoryId, knowledgeId, "1.0.0", detail.configTemplate());
        if (canAutoSyncProjectRepository(detail.configTemplate())) {
            catalog.syncRepository(installedRepoId);
        }

        return toKnowledgeDescriptor(repository, entry, installedRepoId);
    }

    public void uninstallKnowledge(String repositoryId, String knowledgeId) {
        String installedRepoId = buildInstalledRepositoryId(repositoryId, knowledgeId);
        uninstallKnowledgeByInstalledRepositoryId(installedRepoId, NormalizeUtils.normalize(knowledgeId, "knowledgeId 不能为空"));
    }

    public void uninstallKnowledgeByInstalledRepositoryId(String installedRepoId) {
        uninstallKnowledgeByInstalledRepositoryId(installedRepoId, null);
    }

    private void uninstallKnowledgeByInstalledRepositoryId(String installedRepoId, String missingLabel) {
        String normalizedInstalledRepoId = NormalizeUtils.normalize(installedRepoId, "installedRepositoryId 不能为空");
        InstalledKnowledgeSource source = parseInstalledRepositoryId(normalizedInstalledRepoId);
        if (catalog.findRepository(normalizedInstalledRepoId).isEmpty()) {
            throw new IllegalArgumentException("知识源未安装: " + NormalizeUtils.normalizeOrDefault(missingLabel, normalizedInstalledRepoId));
        }
        catalog.deleteRepository(normalizedInstalledRepoId);
        catalog.getConfigTemplateSyncService().removeManagedConfigTemplates(source.repositoryId(), source.knowledgeId());
    }

    /**
     * 将项目仓库发布为知识源指针到目标能力仓库。
     * <p>
     * 在目标能力仓库的 knowledge/ 目录下创建 knowledge.json，
     * source 指向项目仓库的连接信息（url、branch、type）。
     *
     * @param projectRepositoryId 项目仓库 ID
     * @param targetRepositoryId  目标能力仓库 ID
     * @param request             发布请求（knowledgeId、displayName、description、tags）
     */
    public RepositoryPublishConfigPreview previewPublish(RepositoryKnowledgePublishPreviewRequest request) {
        RepositoryDefinition projectRepo = catalog.getRepository(NormalizeUtils.normalize(
                request == null ? null : request.projectRepositoryId(),
                "projectRepositoryId 不能为空"
        ));
        RepositoryPublishConfigResolver.PublishConfigResolution resolution = RepositoryPublishConfigResolver.resolve(
                projectRepo.getUrl(),
                List.of(),
                catalog.configValueRepository().findAll()
        );
        return new RepositoryPublishConfigPreview(
                resolution.items().stream()
                        .map(item -> new RepositoryPublishConfigCandidate(item.key(), item.label(), item.secret()))
                        .toList(),
                resolution.missingKeys()
        );
    }

    public RepositoryKnowledgeDescriptor publishKnowledge(String projectRepositoryId,
                                                           String targetRepositoryId,
                                                           PublishKnowledgeRequest request) {
        RepositoryDefinition projectRepo = catalog.getRepository(projectRepositoryId);

        if (!REPO_PURPOSE_PROJECT.equals(projectRepo.getPurpose())) {
            throw new IllegalArgumentException("只能将项目仓库发布为知识源: " + projectRepositoryId);
        }

        WritableRepositorySession session =
                catalog.openWritableRepositorySession(targetRepositoryId);

        KnowledgeSource source = new KnowledgeSource(
                projectRepo.getType(),
                projectRepo.getUrl(),
                projectRepo.getBranch(),
                DEFAULT_PROJECT_ENTRY_PATH
        );
        RepositoryPublishConfigResolver.PublishConfigResolution configResolution = RepositoryPublishConfigResolver.resolve(
                projectRepo.getUrl(),
                List.of(),
                catalog.configValueRepository().findAll()
        );
        List<ConfigTemplateItem> configTemplates = RepositoryPublishConfigResolver.buildTemplates(configResolution, request.configItems()).stream()
                .sorted(Comparator.comparing(ConfigTemplateItem::key))
                .toList();

        KnowledgeFile knowledgeFile = new KnowledgeFile(
                1,
                NormalizeUtils.normalize(request.knowledgeId(), "knowledgeId 不能为空"),
                NormalizeUtils.normalize(request.displayName(), "displayName 不能为空"),
                NormalizeUtils.normalizeNullable(request.description()),
                source,
                NormalizeUtils.nullSafeList(request.tags()),
                configTemplates.isEmpty() ? null : KNOWLEDGE_CONFIG_TEMPLATE_FILE
        );

        Path knowledgeDir = session.root().resolve(KNOWLEDGE_DIR).resolve(knowledgeFile.knowledgeId());
        catalog.writeJson(knowledgeDir.resolve(KNOWLEDGE_MANIFEST_FILE), knowledgeFile);
        if (!configTemplates.isEmpty()) {
            catalog.writeJson(knowledgeDir.resolve(KNOWLEDGE_CONFIG_TEMPLATE_FILE), configTemplates);
        }

        session.commitPublishedAsset(knowledgeFile.knowledgeId(), "1.0.0", null);
        catalog.refreshRepositoryCache(targetRepositoryId);
        return getRepositoryKnowledge(targetRepositoryId, knowledgeFile.knowledgeId()).descriptor();
    }

    public record PublishKnowledgeRequest(
            String knowledgeId,
            String displayName,
            String description,
            List<String> tags,
            List<RepositoryPublishConfigItem> configItems
    ) {
        public PublishKnowledgeRequest(String knowledgeId,
                                       String displayName,
                                       String description,
                                       List<String> tags) {
            this(knowledgeId, displayName, description, tags, List.of());
        }
    }

    private boolean canAutoSyncProjectRepository(List<ConfigTemplateItem> configTemplates) {
        for (ConfigTemplateItem template : NormalizeUtils.nullSafeList(configTemplates)) {
            ConfigValue value = catalog.configValueRepository().findByKey(template.key()).orElse(null);
            if (value == null || NormalizeUtils.isBlank(value.getValue())) {
                return false;
            }
        }
        return true;
    }

    private RepositoryKnowledgeIndexEntry findKnowledgeEntry(RepositoryIndexFile index, String knowledgeId) {
        return index.safeKnowledge().stream()
                .filter(entry -> knowledgeId.equals(entry.id()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("仓库知识源不存在: " + knowledgeId));
    }

    private RepositoryKnowledgeDescriptor toKnowledgeDescriptor(RepositoryDefinition repository,
                                                                  RepositoryKnowledgeIndexEntry entry) {
        String installedRepoId = buildInstalledRepositoryId(repository.getId(), entry.id());
        boolean installed = catalog.findRepository(installedRepoId).isPresent();
        return toKnowledgeDescriptor(repository, entry, installed ? installedRepoId : null);
    }

    private RepositoryKnowledgeDescriptor toKnowledgeDescriptor(RepositoryDefinition repository,
                                                                  RepositoryKnowledgeIndexEntry entry,
                                                                  String installedRepositoryId) {
        boolean installed = installedRepositoryId != null;
        return new RepositoryKnowledgeDescriptor(
                repository.getId(),
                NormalizeUtils.normalize(entry.id(), "knowledgeId 不能为空"),
                NormalizeUtils.normalizeOrDefault(entry.name(), entry.id()),
                NormalizeUtils.normalizeNullable(entry.description()),
                NormalizeUtils.nullSafeList(entry.tags()),
                entry.knowledgePath(),
                entry.source(),
                installed,
                installedRepositoryId,
                isTrusted(repository)
        );
    }

    static String buildInstalledRepositoryId(String repositoryId, String knowledgeId) {
        return KNOWLEDGE_REPO_ID_PREFIX
                + NormalizeUtils.normalize(repositoryId, "repositoryId 不能为空")
                + ":"
                + NormalizeUtils.normalize(knowledgeId, "knowledgeId 不能为空");
    }

    public static boolean isInstalledKnowledgeRepositoryId(String repositoryId) {
        return repositoryId != null && repositoryId.startsWith(KNOWLEDGE_REPO_ID_PREFIX);
    }

    private static InstalledKnowledgeSource parseInstalledRepositoryId(String installedRepoId) {
        if (!isInstalledKnowledgeRepositoryId(installedRepoId)) {
            throw new IllegalArgumentException("不是知识源安装仓库: " + installedRepoId);
        }
        String value = installedRepoId.substring(KNOWLEDGE_REPO_ID_PREFIX.length());
        int splitAt = value.indexOf(':');
        if (splitAt <= 0 || splitAt == value.length() - 1) {
            throw new IllegalArgumentException("知识源安装仓库 ID 格式不合法: " + installedRepoId);
        }
        return new InstalledKnowledgeSource(value.substring(0, splitAt), value.substring(splitAt + 1));
    }

    private record InstalledKnowledgeSource(String repositoryId, String knowledgeId) {
    }
}
