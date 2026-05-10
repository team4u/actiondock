package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.RepositoryDefinitionRepository;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

/**
 * 仓库定义 CRUD 服务，管理仓库的创建、查询、更新和删除。
 *
 * @author jay.wu
 */
class RepositoryDefinitionService {

    private final RepositoryDefinitionRepository repositoryDefinitionRepository;
    private final JsonCodec jsonCodec;
    private final Path repositoriesRoot;

    RepositoryDefinitionService(RepositoryDefinitionRepository repositoryDefinitionRepository,
                                JsonCodec jsonCodec,
                                Path repositoriesRoot) {
        this.repositoryDefinitionRepository = repositoryDefinitionRepository;
        this.jsonCodec = jsonCodec;
        this.repositoriesRoot = repositoriesRoot;
    }

    List<RepositoryDefinition> listRepositories() {
        return repositoryDefinitionRepository.findAll().stream()
                .sorted(Comparator.comparing(RepositoryDefinition::getCreatedAt, Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();
    }

    RepositoryDefinition getRepository(String repositoryId) {
        return repositoryDefinitionRepository.findById(repositoryId)
                .orElseThrow(() -> new IllegalArgumentException("仓库不存在: " + repositoryId));
    }

    RepositoryDefinition saveRepository(RepositoryDefinition definition) {
        RepositoryDefinition target = definition == null ? new RepositoryDefinition() : definition;
        String id = NormalizeUtils.normalize(target.getId(), "仓库 ID 不能为空");
        String type = validateRepositoryType(target);
        String trustLevel = validateTrustLevel(target);

        LocalDateTime now = LocalDateTime.now();
        RepositoryDefinition existing = repositoryDefinitionRepository.findById(id).orElse(null);
        RepositoryDefinition saved = repositoryDefinitionRepository.save(
                buildRepositoryDefinition(id, target, type, trustLevel, existing, now)
        );
        if (REPO_TYPE_LOCAL_DIR.equals(type)) {
            ensureLocalDirRepository(saved);
            saved.setLastSyncedAt(now).setUpdatedAt(now);
            return repositoryDefinitionRepository.save(saved);
        }
        return saved;
    }

    void deleteRepository(String repositoryId) {
        getRepository(repositoryId);
        repositoryDefinitionRepository.deleteById(repositoryId);
    }

    void ensureLocalDirRepository(RepositoryDefinition repository) {
        Path root = resolveRepositoryRoot(repository);
        RepositoryWorkspaceHelper.ensureRepositoryWorkspace(root, repository, jsonCodec);
    }

    Path resolveRepositoryRoot(RepositoryDefinition repository) {
        if (REPO_TYPE_LOCAL_DIR.equals(repository.getType())) {
            return Path.of(repository.getUrl());
        }
        return repositoriesRoot.resolve(repository.getId());
    }

    RepositoryDefinitionRepository getRepositoryDefinitionRepository() {
        return repositoryDefinitionRepository;
    }

    private String validateRepositoryType(RepositoryDefinition target) {
        String type = NormalizeUtils.normalizeOrDefault(target.getType(), REPO_TYPE_GIT).toUpperCase(Locale.ROOT);
        if (!List.of(REPO_TYPE_GIT, REPO_TYPE_HTTP, REPO_TYPE_LOCAL_DIR).contains(type)) {
            throw new IllegalArgumentException("仓库类型仅支持 GIT / HTTP / LOCAL_DIR");
        }
        return type;
    }

    private String validateTrustLevel(RepositoryDefinition target) {
        String trustLevel = NormalizeUtils.normalizeOrDefault(target.getTrustLevel(), REPO_TRUST_UNTRUSTED).toUpperCase(Locale.ROOT);
        if (!List.of(REPO_TRUST_TRUSTED, REPO_TRUST_UNTRUSTED).contains(trustLevel)) {
            throw new IllegalArgumentException("trustLevel 仅支持 TRUSTED / UNTRUSTED");
        }
        return trustLevel;
    }

    private RepositoryDefinition buildRepositoryDefinition(String id,
                                                           RepositoryDefinition target,
                                                           String type,
                                                           String trustLevel,
                                                           RepositoryDefinition existing,
                                                           LocalDateTime now) {
        return new RepositoryDefinition()
                .setId(id)
                .setName(NormalizeUtils.normalize(target.getName(), "仓库名称不能为空"))
                .setType(type)
                .setUrl(NormalizeUtils.normalize(target.getUrl(), "仓库地址不能为空"))
                .setBranch(REPO_TYPE_GIT.equals(type) ? NormalizeUtils.normalizeOrDefault(target.getBranch(), DEFAULT_GIT_BRANCH) : null)
                .setEnabled(target.isEnabled())
                .setTrustLevel(trustLevel)
                .setDescription(NormalizeUtils.normalizeNullable(target.getDescription()))
                .setLastSyncedAt(existing == null ? null : existing.getLastSyncedAt())
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now);
    }
}
