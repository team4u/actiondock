package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.common.NormalizeUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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

    String resolvePlaybookScriptRepositoryId(String currentRepositoryId, String dependencyRepositoryId, String scriptId) {
        return resolvePlaybookRepositoryId(currentRepositoryId, dependencyRepositoryId, scriptId, this::repositoryContainsTool, "脚本");
    }

    String resolvePlaybookKnowledgeRepositoryId(String currentRepositoryId, String dependencyRepositoryId, String knowledgeId) {
        return resolvePlaybookRepositoryId(currentRepositoryId, dependencyRepositoryId, knowledgeId, this::repositoryContainsKnowledge, "知识源");
    }

    String resolvePlaybookRepositoryId(String currentRepositoryId, String dependencyRepositoryId, String playbookId) {
        return resolvePlaybookRepositoryId(currentRepositoryId, dependencyRepositoryId, playbookId, this::repositoryContainsPlaybook, "任务手册");
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
            throw ActionDockException.badRequest(
                    ActionDockErrorCodes.PLAYBOOK_DEPENDENCY_AMBIGUOUS,
                    "依赖仓库解析存在歧义: " + normalizedAssetId + " 可在多个仓库中找到 " + matchedRepositoryIds,
                    Map.of("assetId", normalizedAssetId, "matchedRepositoryIds", matchedRepositoryIds));
        }
        if (matchedRepositoryIds.size() == 1) {
            return matchedRepositoryIds.get(0);
        }
        throw ActionDockException.notFound(
                ActionDockErrorCodes.PLAYBOOK_REFERENCE_UNRESOLVED,
                assetLabel + "依赖不存在: " + normalizedDependencyRepositoryId + "/" + normalizedAssetId,
                Map.of("repositoryId", normalizedDependencyRepositoryId, "assetId", normalizedAssetId));
    }

    private String resolvePlaybookRepositoryId(String currentRepositoryId,
                                               String dependencyRepositoryId,
                                               String assetId,
                                               BiPredicate<String, String> matcher,
                                               String assetLabel) {
        String normalizedCurrentRepositoryId = NormalizeUtils.normalize(currentRepositoryId, "当前仓库 ID 不能为空");
        String normalizedDependencyRepositoryId = NormalizeUtils.normalizeNullable(dependencyRepositoryId);
        String normalizedAssetId = NormalizeUtils.normalize(assetId, assetLabel + "依赖 assetId 不能为空");
        List<RepositoryDefinition> repositories = catalog.listRepositories();

        if (repositoryExists(repositories, normalizedCurrentRepositoryId)
                && matcher.test(normalizedCurrentRepositoryId, normalizedAssetId)) {
            return normalizedCurrentRepositoryId;
        }
        if (normalizedDependencyRepositoryId != null
                && !Objects.equals(normalizedCurrentRepositoryId, normalizedDependencyRepositoryId)
                && repositoryExists(repositories, normalizedDependencyRepositoryId)
                && matcher.test(normalizedDependencyRepositoryId, normalizedAssetId)) {
            return normalizedDependencyRepositoryId;
        }

        List<String> matchedRepositoryIds = new ArrayList<>();
        for (RepositoryDefinition repository : repositories) {
            if (!repository.isEnabled() || REPO_TYPE_HTTP.equals(repository.getType())) {
                continue;
            }
            String repositoryId = repository.getId();
            if (Objects.equals(repositoryId, normalizedCurrentRepositoryId)
                    || Objects.equals(repositoryId, normalizedDependencyRepositoryId)) {
                continue;
            }
            if (matcher.test(repositoryId, normalizedAssetId)) {
                matchedRepositoryIds.add(repositoryId);
            }
        }
        if (matchedRepositoryIds.size() > 1) {
            throw ActionDockException.badRequest(
                    ActionDockErrorCodes.PLAYBOOK_DEPENDENCY_AMBIGUOUS,
                    assetLabel + "依赖仓库解析存在歧义: " + normalizedAssetId + " 可在多个仓库中找到 " + matchedRepositoryIds,
                    Map.of("assetId", normalizedAssetId, "matchedRepositoryIds", matchedRepositoryIds));
        }
        if (matchedRepositoryIds.size() == 1) {
            return matchedRepositoryIds.get(0);
        }
        String location = normalizedDependencyRepositoryId == null ? normalizedCurrentRepositoryId : normalizedDependencyRepositoryId;
        throw ActionDockException.notFound(
                ActionDockErrorCodes.PLAYBOOK_REFERENCE_UNRESOLVED,
                assetLabel + "依赖不存在: " + location + "/" + normalizedAssetId,
                Map.of("repositoryId", location, "assetId", normalizedAssetId));
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

    private boolean repositoryContainsKnowledge(String repositoryId, String knowledgeId) {
        return new RepositoryKnowledgeService(catalog).listRepositoryKnowledge(repositoryId).stream()
                .anyMatch(item -> Objects.equals(item.knowledgeId(), knowledgeId));
    }

    private boolean repositoryContainsPlaybook(String repositoryId, String playbookId) {
        return catalog.listRepositoryPlaybooks(repositoryId).stream()
                .anyMatch(item -> Objects.equals(item.playbookId(), playbookId));
    }
}
