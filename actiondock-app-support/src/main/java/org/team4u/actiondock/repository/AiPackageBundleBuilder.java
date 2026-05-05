package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.RepositoryDefinition;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Objects;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

/**
 * AI 能力包构建器，递归收集模型、工具集、Agent、脚本等资源。
 *
 * @author jay.wu
 */
final class AiPackageBundleBuilder {

    private final String repositoryId;
    private final String packageId;
    private final String entryAgentId;
    private String entryAgentName;
    private String entryAgentDescription;
    private final Map<String, AiPackageModelFile> models = new LinkedHashMap<>();
    private final Map<String, AiPackageToolsetFile> toolsets = new LinkedHashMap<>();
    private final Map<String, AiPackageAgentFile> agents = new LinkedHashMap<>();
    private final Map<String, AiPackageScriptFile> scripts = new LinkedHashMap<>();
    private final Map<String, RepositoryAiPackageDependency> externalDependencies = new LinkedHashMap<>();
    private final LinkedHashSet<String> externalAgentIds = new LinkedHashSet<>();
    private final LinkedHashSet<String> externalScriptIds = new LinkedHashSet<>();

    AiPackageBundleBuilder(RepositoryDefinition repository, String packageId, String entryAgentId) {
        this.repositoryId = repository.getId();
        this.packageId = packageId;
        this.entryAgentId = entryAgentId;
    }

    String entryAgentId() {
        return entryAgentId;
    }

    boolean hasModel(String id) {
        return models.containsKey(id);
    }

    boolean hasToolset(String id) {
        return toolsets.containsKey(id);
    }

    boolean hasAgent(String id) {
        return agents.containsKey(id);
    }

    boolean hasScript(String id) {
        return scripts.containsKey(id);
    }

    boolean isExternalAgent(String id) {
        return externalAgentIds.contains(id);
    }

    boolean isExternalScript(String id) {
        return externalScriptIds.contains(id);
    }

    void addModel(String id, AiPackageModelFile file) {
        models.putIfAbsent(id, copyWithId(file, id));
    }

    void addToolset(String id, AiPackageToolsetFile file) {
        toolsets.putIfAbsent(id, copyWithId(file, id));
    }

    void addAgent(String id, AiPackageAgentFile file) {
        agents.putIfAbsent(id, copyWithId(file, id));
        if (Objects.equals(id, entryAgentId)) {
            entryAgentName = file.name();
            entryAgentDescription = file.description();
        }
    }

    void addScript(String id, AiPackageScriptFile file) {
        scripts.putIfAbsent(id, copyWithId(file, id));
    }

    private static AiPackageModelFile copyWithId(AiPackageModelFile f, String id) {
        return new AiPackageModelFile(id, f.name(), f.provider(), f.modelProvider(), f.modelName(),
                f.baseUrl(), f.apiKeyConfigKey(), f.defaultOptions(), f.limits(), f.capabilities(), f.enabled());
    }

    private static AiPackageToolsetFile copyWithId(AiPackageToolsetFile f, String id) {
        return new AiPackageToolsetFile(id, f.name(), f.description(), f.toolNames(),
                f.toolOptions(), f.maxPermission(), f.enabled());
    }

    private static AiPackageAgentFile copyWithId(AiPackageAgentFile f, String id) {
        return new AiPackageAgentFile(id, f.name(), f.description(), f.provider(), f.modelProfileId(),
                f.systemPrompt(), f.toolsetIds(), f.directToolNames(), f.directToolOptions(),
                f.skillIds(), f.options(), f.enabled());
    }

    private static AiPackageScriptFile copyWithId(AiPackageScriptFile f, String id) {
        return new AiPackageScriptFile(id, f.name(), f.type(), f.packaging(), f.description(),
                f.tags(), f.source(), f.pythonRequirements(), f.inputSchema(), f.outputSchema(),
                f.pluginDependencies(), f.aiDependencies());
    }

    void addExternalDependency(RepositoryAiPackageDependency dependency) {
        externalDependencies.putIfAbsent(
                dependency.assetType() + ":" + dependency.repositoryId() + ":" + dependency.assetId(),
                dependency
        );
        if (DependencyAssetType.AI_PACKAGE.name().equalsIgnoreCase(dependency.assetType())) {
            externalAgentIds.add(AI_PACKAGE_ENTRY_PREFIX + dependency.repositoryId() + "." + dependency.assetId());
        }
        if (DependencyAssetType.TOOL.name().equalsIgnoreCase(dependency.assetType())) {
            externalScriptIds.add(dependency.repositoryId() + "." + dependency.assetId());
        }
    }

    AiPackageBundle build() {
        return new AiPackageBundle(
                repositoryId,
                packageId,
                entryAgentId,
                entryAgentName,
                entryAgentDescription,
                Map.copyOf(models),
                Map.copyOf(toolsets),
                Map.copyOf(agents),
                Map.copyOf(scripts),
                Map.copyOf(externalDependencies)
        );
    }
}
