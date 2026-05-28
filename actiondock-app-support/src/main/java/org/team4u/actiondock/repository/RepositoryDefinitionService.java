package org.team4u.actiondock.repository;

import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.RepositoryDefinitionRepository;
import org.team4u.actiondock.common.NormalizeUtils;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

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
    private final ConfigValueApplicationService configValueApplicationService;

    RepositoryDefinitionService(RepositoryDefinitionRepository repositoryDefinitionRepository,
                                JsonCodec jsonCodec,
                                Path repositoriesRoot) {
        this(repositoryDefinitionRepository, jsonCodec, repositoriesRoot, ConfigValueApplicationService.disabled());
    }

    RepositoryDefinitionService(RepositoryDefinitionRepository repositoryDefinitionRepository,
                                JsonCodec jsonCodec,
                                Path repositoriesRoot,
                                ConfigValueApplicationService configValueApplicationService) {
        this.repositoryDefinitionRepository = repositoryDefinitionRepository;
        this.jsonCodec = jsonCodec;
        this.repositoriesRoot = repositoriesRoot;
        this.configValueApplicationService = configValueApplicationService == null
                ? ConfigValueApplicationService.disabled()
                : configValueApplicationService;
    }

    List<RepositoryDefinition> listRepositories() {
        return repositoryDefinitionRepository.findAll().stream()
                .sorted(Comparator.comparing(RepositoryDefinition::getCreatedAt, Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();
    }

    List<RepositoryDefinition> listRepositoriesByPurpose(String purpose) {
        String normalizedPurpose = normalizePurpose(purpose);
        return listRepositories().stream()
                .filter(item -> normalizedPurpose.equals(item.getPurpose()))
                .toList();
    }

    RepositoryDefinition getRepository(String repositoryId) {
        return repositoryDefinitionRepository.findById(repositoryId)
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.REPOSITORY_NOT_FOUND,
                        "仓库不存在: " + repositoryId,
                        Map.of("repositoryId", repositoryId)
                ));
    }

    RepositoryDefinition saveRepository(RepositoryDefinition definition) {
        RepositoryDefinition target = definition == null ? new RepositoryDefinition() : definition;
        String id = NormalizeUtils.normalize(target.getId(), "仓库 ID 不能为空");
        LocalDateTime now = LocalDateTime.now();
        RepositoryDefinition existing = repositoryDefinitionRepository.findById(id).orElse(null);
        String type = validateRepositoryType(target, existing);
        String purpose = validateRepositoryPurpose(target);
        String trustLevel = validateTrustLevel(target);
        RepositoryDefinition saved = repositoryDefinitionRepository.save(
                buildRepositoryDefinition(id, target, type, purpose, trustLevel, existing, now)
        );
        if (REPO_TYPE_LOCAL_DIR.equals(type) && REPO_PURPOSE_CAPABILITY.equals(purpose)) {
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
            return Path.of(resolveRepositoryUrl(repository));
        }
        return repositoriesRoot.resolve(repository.getId());
    }

    String resolveRepositoryUrl(RepositoryDefinition repository) {
        return configValueApplicationService.resolveText(repository.getUrl());
    }

    RepositoryDefinitionRepository getRepositoryDefinitionRepository() {
        return repositoryDefinitionRepository;
    }

    private String validateRepositoryType(RepositoryDefinition target, RepositoryDefinition existing) {
        String type = NormalizeUtils.normalizeOrDefault(target.getType(), REPO_TYPE_GIT).toUpperCase(Locale.ROOT);
        if (List.of(REPO_TYPE_GIT, REPO_TYPE_LOCAL_DIR).contains(type)) {
            return type;
        }
        if (REPO_TYPE_HTTP.equals(type) && existing != null && REPO_TYPE_HTTP.equals(existing.getType())) {
            return type;
        }
        throw new IllegalArgumentException("仓库类型仅支持 GIT / LOCAL_DIR");
    }

    private String validateTrustLevel(RepositoryDefinition target) {
        String trustLevel = NormalizeUtils.normalizeOrDefault(target.getTrustLevel(), REPO_TRUST_UNTRUSTED).toUpperCase(Locale.ROOT);
        if (!List.of(REPO_TRUST_TRUSTED, REPO_TRUST_UNTRUSTED).contains(trustLevel)) {
            throw new IllegalArgumentException("trustLevel 仅支持 TRUSTED / UNTRUSTED");
        }
        return trustLevel;
    }

    private String validateRepositoryPurpose(RepositoryDefinition target) {
        String purpose = normalizePurpose(target == null ? null : target.getPurpose());
        if (!List.of(REPO_PURPOSE_CAPABILITY, REPO_PURPOSE_PROJECT).contains(purpose)) {
            throw new IllegalArgumentException("purpose 仅支持 CAPABILITY / PROJECT");
        }
        return purpose;
    }

    private String normalizePurpose(String purpose) {
        return NormalizeUtils.normalizeOrDefault(purpose, REPO_PURPOSE_CAPABILITY).toUpperCase(Locale.ROOT);
    }

    private RepositoryDefinition buildRepositoryDefinition(String id,
                                                           RepositoryDefinition target,
                                                           String type,
                                                           String purpose,
                                                           String trustLevel,
                                                           RepositoryDefinition existing,
                                                           LocalDateTime now) {
        return new RepositoryDefinition()
                .setId(id)
                .setName(NormalizeUtils.normalize(target.getName(), "仓库名称不能为空"))
                .setType(type)
                .setPurpose(purpose)
                .setUrl(NormalizeUtils.normalize(target.getUrl(), "仓库地址不能为空"))
                .setBranch(REPO_TYPE_GIT.equals(type) ? NormalizeUtils.normalizeNullable(target.getBranch()) : null)
                .setEnabled(target.isEnabled())
                .setTrustLevel(trustLevel)
                .setDescription(NormalizeUtils.normalizeNullable(target.getDescription()))
                .setLastSyncedAt(existing == null ? null : existing.getLastSyncedAt())
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now);
    }
}
