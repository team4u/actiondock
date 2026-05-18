package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.function.BiPredicate;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.REPO_TYPE_HTTP;

class RepositoryDependencyResolver {

    private final RepositoryCatalogService catalog;

    RepositoryDependencyResolver(RepositoryCatalogService catalog) {
        this.catalog = catalog;
    }

    String resolveToolRepositoryId(String currentRepositoryId, String dependencyRepositoryId, String toolId) {
        return resolveRepositoryId(currentRepositoryId, dependencyRepositoryId, toolId, this::repositoryContainsTool, "工具");
    }

    String resolvePluginRepositoryId(String currentRepositoryId, String dependencyRepositoryId, String pluginId) {
        return resolveRepositoryId(currentRepositoryId, dependencyRepositoryId, pluginId, this::repositoryContainsPlugin, "插件");
    }

    String resolveCapabilityPackageRepositoryId(String currentRepositoryId, String dependencyRepositoryId, String packageId) {
        return resolveRepositoryId(currentRepositoryId, dependencyRepositoryId, packageId, this::repositoryContainsCapabilityPackage, "能力包");
    }

    private String resolveRepositoryId(String currentRepositoryId,
                                       String dependencyRepositoryId,
                                       String assetId,
                                       BiPredicate<String, String> matcher,
                                       String assetLabel) {
        String normalizedCurrentRepositoryId = NormalizeUtils.normalize(currentRepositoryId, "当前仓库 ID 不能为空");
        String normalizedDependencyRepositoryId = NormalizeUtils.normalize(dependencyRepositoryId, assetLabel + "依赖 repositoryId 不能为空: " + assetId);
        String normalizedAssetId = NormalizeUtils.normalize(assetId, assetLabel + "依赖 assetId 不能为空");
        List<RepositoryDefinition> repositories = catalog.listRepositories();

        if (repositoryExists(repositories, normalizedDependencyRepositoryId)
                && matcher.test(normalizedDependencyRepositoryId, normalizedAssetId)) {
            return normalizedDependencyRepositoryId;
        }
        if (!Objects.equals(normalizedCurrentRepositoryId, normalizedDependencyRepositoryId)
                && repositoryExists(repositories, normalizedCurrentRepositoryId)
                && matcher.test(normalizedCurrentRepositoryId, normalizedAssetId)) {
            return normalizedCurrentRepositoryId;
        }

        List<String> matchedRepositoryIds = new ArrayList<>();
        for (RepositoryDefinition repository : repositories) {
            if (!repository.isEnabled() || REPO_TYPE_HTTP.equals(repository.getType())) {
                continue;
            }
            String repositoryId = repository.getId();
            if (Objects.equals(repositoryId, normalizedDependencyRepositoryId)
                    || Objects.equals(repositoryId, normalizedCurrentRepositoryId)) {
                continue;
            }
            if (matcher.test(repositoryId, normalizedAssetId)) {
                matchedRepositoryIds.add(repositoryId);
            }
        }
        if (matchedRepositoryIds.size() > 1) {
            throw new IllegalArgumentException("依赖仓库解析存在歧义: " + normalizedAssetId + " 可在多个仓库中找到 " + matchedRepositoryIds);
        }
        if (matchedRepositoryIds.size() == 1) {
            return matchedRepositoryIds.get(0);
        }
        throw new IllegalArgumentException(assetLabel + "依赖不存在: " + normalizedDependencyRepositoryId + "/" + normalizedAssetId);
    }

    private boolean repositoryExists(List<RepositoryDefinition> repositories, String repositoryId) {
        return repositories.stream().anyMatch(repository -> Objects.equals(repository.getId(), repositoryId));
    }

    private boolean repositoryContainsTool(String repositoryId, String toolId) {
        return catalog.listRepositoryScripts(repositoryId).stream()
                .anyMatch(item -> Objects.equals(item.scriptId(), toolId));
    }

    private boolean repositoryContainsPlugin(String repositoryId, String pluginId) {
        return catalog.listRepositoryPlugins(repositoryId).stream()
                .anyMatch(item -> Objects.equals(item.pluginId(), pluginId));
    }

    private boolean repositoryContainsCapabilityPackage(String repositoryId, String packageId) {
        return catalog.listCapabilityPackages(repositoryId).stream()
                .anyMatch(item -> Objects.equals(item.packageId(), packageId));
    }
}
