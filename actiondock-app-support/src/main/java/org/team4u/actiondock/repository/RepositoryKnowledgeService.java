package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.shared.NormalizeUtils;

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
        return new RepositoryKnowledgeDetail(toKnowledgeDescriptor(repository, entry), knowledge);
    }

    public RepositoryKnowledgeDescriptor installKnowledge(String repositoryId, String knowledgeId) {
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        RepositoryIndexFile index = catalog.readRepositoryIndex(repository);
        RepositoryKnowledgeIndexEntry entry = findKnowledgeEntry(index, knowledgeId);
        KnowledgeFile knowledge = catalog.readKnowledgeFile(repository, entry.knowledgePath());
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
        catalog.syncRepository(installedRepoId);

        return toKnowledgeDescriptor(repository, entry, installedRepoId);
    }

    public void uninstallKnowledge(String repositoryId, String knowledgeId) {
        String installedRepoId = buildInstalledRepositoryId(repositoryId, knowledgeId);
        if (catalog.findRepository(installedRepoId).isEmpty()) {
            throw new IllegalArgumentException("知识源未安装: " + knowledgeId);
        }
        catalog.deleteRepository(installedRepoId);
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
}
