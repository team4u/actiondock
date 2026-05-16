package org.team4u.actiondock.repository;

import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.RepositoryPublishRequest;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.RepositoryScriptDescriptor;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.RepositoryWebhookPublishDependencyDraft;

final class RepositoryScriptDependencyPublishPlanner {

    private static final String STATE_AUTO = "AUTO";
    private static final String STATE_MANUAL = "MANUAL";
    private static final String STATE_UNRESOLVED = "UNRESOLVED";

    private final RepositoryCatalogService catalog;
    private final ScriptRepositoryPublisher scriptPublisher;
    private final ScriptApplicationService scriptApplicationService;

    RepositoryScriptDependencyPublishPlanner(RepositoryCatalogService catalog,
                                             ScriptRepositoryPublisher scriptPublisher) {
        this.catalog = catalog;
        this.scriptPublisher = scriptPublisher;
        this.scriptApplicationService = catalog.scriptApplicationService();
    }

    List<RepositoryWebhookPublishDependencyDraft> preview(String rootScriptId,
                                                          String preferredRepositoryId,
                                                          List<ScriptDependency> declaredDependencies) {
        LinkedHashMap<String, RepositoryWebhookPublishDependencyDraft> ordered = new LinkedHashMap<>();
        collectPreviewDrafts(rootScriptId, preferredRepositoryId, normalizeDeclaredDependencies(declaredDependencies), ordered, new LinkedHashSet<>());
        return List.copyOf(ordered.values());
    }

    List<ScriptDependency> resolvePublishDependencies(String rootScriptId,
                                                      String preferredRepositoryId,
                                                      List<ScriptDependency> declaredDependencies) {
        return resolveDetectedDependencies(loadPublishedScript(rootScriptId), preferredRepositoryId, declaredDependencies);
    }

    void publishDependencies(String repositoryId,
                             String rootScriptId,
                             List<ScriptDependency> declaredDependencies,
                             boolean force) {
        publishDependenciesInternal(repositoryId, rootScriptId, normalizeDeclaredDependencies(declaredDependencies), force, new LinkedHashSet<>());
    }

    private void collectPreviewDrafts(String scriptId,
                                      String preferredRepositoryId,
                                      Map<String, ScriptDependency> declaredDependencies,
                                      LinkedHashMap<String, RepositoryWebhookPublishDependencyDraft> ordered,
                                      LinkedHashSet<String> visiting) {
        ScriptDefinition script = loadPublishedScript(scriptId);
        List<ResolvedDependency> dependencies = resolvePreviewDependencies(script, preferredRepositoryId, declaredDependencies);
        for (ResolvedDependency dependency : dependencies) {
            ordered.putIfAbsent(dependency.scriptId(), toDraft(dependency.dependency(), dependency.state()));
        }
        for (ResolvedDependency dependency : dependencies) {
            if (STATE_UNRESOLVED.equals(dependency.state()) || !visiting.add(dependency.scriptId())) {
                continue;
            }
            collectPreviewDrafts(dependency.scriptId(), dependency.dependency().getRepositoryId(), declaredDependencies, ordered, visiting);
            visiting.remove(dependency.scriptId());
        }
    }

    private void publishDependenciesInternal(String repositoryId,
                                             String rootScriptId,
                                             Map<String, ScriptDependency> declaredDependencies,
                                             boolean force,
                                             LinkedHashSet<String> visiting) {
        ScriptDefinition script = loadPublishedScript(rootScriptId);
        List<ScriptDependency> dependencies = resolveDetectedDependencies(script, repositoryId, declaredDependencies.values().stream().toList());
        for (ScriptDependency dependency : dependencies) {
            String dependencyScriptId = dependency.getScriptId();
            if (!visiting.add(dependencyScriptId)) {
                continue;
            }
            publishDependenciesInternal(dependency.getRepositoryId(), dependencyScriptId, declaredDependencies, force, visiting);
            ScriptDefinition publishedDependency = loadPublishedScript(dependencyScriptId);
            publishSingleScriptIfNeeded(dependency.getRepositoryId(), publishedDependency, dependency, force);
            visiting.remove(dependencyScriptId);
        }
    }

    private void publishSingleScriptIfNeeded(String repositoryId,
                                             ScriptDefinition publishedScript,
                                             ScriptDependency dependency,
                                             boolean force) {
        String repositoryScriptId = NormalizeUtils.normalize(dependency.getRepositoryScriptId(), "脚本依赖 scriptId 不能为空: " + dependency.getScriptId());
        RepositoryCatalogTypes.RepositoryScriptDetail existing = null;
        try {
            existing = catalog.getRepositoryScript(repositoryId, repositoryScriptId);
        } catch (IllegalArgumentException ignored) {
            existing = null;
        }

        List<ScriptDependency> nestedDependencies = resolveDetectedDependencies(
                publishedScript,
                repositoryId,
                List.of()
        );
        String displayName = NormalizeUtils.normalizeOrDefault(publishedScript.getName(), publishedScript.getId());
        String owner = NormalizeUtils.normalizeNullable(publishedScript.getOwner());
        List<String> tags = NormalizeUtils.nullSafeList(publishedScript.getTags());
        String nextVersion = existing == null
                ? NormalizeUtils.normalizeOrDefault(publishedScript.getRepositoryVersion(), "0.1.0")
                : suggestNextVersion(existing.descriptor().version());
        RepositoryPublishRequest request = new RepositoryPublishRequest(
                publishedScript.getId(),
                repositoryScriptId,
                displayName,
                nextVersion,
                owner,
                null,
                tags,
                List.of(),
                List.of(),
                nestedDependencies,
                force
        );

        if (existing != null && !hasToolContentChanges(existing, publishedScript, request)) {
            return;
        }
        scriptPublisher.publish(repositoryId, request);
    }

    private boolean hasToolContentChanges(RepositoryCatalogTypes.RepositoryScriptDetail existing,
                                          ScriptDefinition publishedScript,
                                          RepositoryPublishRequest request) {
        RepositoryCatalogTypes.ToolFile file = ScriptRepositoryPublisher.buildToolFile(
                publishedScript,
                request,
                publishedScript.getType().name().equals("PYTHON") ? "source.py" : "source.groovy",
                List.of(),
                List.of(),
                request.scriptDependencies(),
                ScriptRepositoryPublisher.resolvePluginDependenciesForDigest(catalog.getServices().pluginRuntimeService(), publishedScript)
        );
        LinkedHashMap<String, Object> values = new LinkedHashMap<>();
        values.put("scriptId", file.id());
        values.put("displayName", file.name());
        values.put("version", existing.descriptor().version());
        values.put("type", file.type());
        values.put("packaging", file.packaging());
        values.put("description", file.description());
        values.put("owner", file.owner());
        values.put("tags", file.tags());
        values.put("scriptDependencies", file.scriptDependencies());
        values.put("pluginDependencies", file.pluginDependencies());
        values.put("source", publishedScript.getSource());
        values.put("pythonRequirements", publishedScript.getPythonRequirements());
        values.put("inputSchema", publishedScript.getInputSchema());
        values.put("outputSchema", publishedScript.getOutputSchema());
        String nextDigest = catalog.computeDigest(values);
        return !Objects.equals(existing.descriptor().digest(), nextDigest);
    }

    private List<ResolvedDependency> resolvePreviewDependencies(ScriptDefinition script,
                                                                String preferredRepositoryId,
                                                                Map<String, ScriptDependency> declaredDependencies) {
        ScriptRepositoryPublisher.assertLiteralScriptInvocations(script.getSource());
        List<String> detectedScriptIds = AiPackageIdRewriter.extractScriptDependenciesFromSource(script.getSource());
        if (detectedScriptIds.isEmpty()) {
            return List.of();
        }

        List<ResolvedDependency> resolved = new ArrayList<>();
        for (String dependencyScriptId : detectedScriptIds) {
            ScriptDependency declared = declaredDependencies.get(dependencyScriptId);
            if (declared != null) {
                resolved.add(new ResolvedDependency(normalizeVersionRange(declared.copy()), STATE_MANUAL));
                continue;
            }
            ScriptDefinition dependencyScript = loadPublishedScript(dependencyScriptId);
            ScriptDependency auto = resolveAutoDependency(dependencyScriptId, dependencyScript, preferredRepositoryId);
            if (auto == null) {
                resolved.add(new ResolvedDependency(new ScriptDependency().setScriptId(dependencyScriptId), STATE_UNRESOLVED));
                continue;
            }
            resolved.add(new ResolvedDependency(auto, STATE_AUTO));
        }
        return resolved;
    }

    private List<ScriptDependency> resolveDetectedDependencies(ScriptDefinition script,
                                                               String preferredRepositoryId,
                                                               List<ScriptDependency> declaredDependencies) {
        ScriptRepositoryPublisher.assertLiteralScriptInvocations(script.getSource());
        List<String> detectedScriptIds = AiPackageIdRewriter.extractScriptDependenciesFromSource(script.getSource());
        if (detectedScriptIds.isEmpty()) {
            return List.of();
        }

        Map<String, ScriptDependency> resolvedByScriptId = new LinkedHashMap<>();
        Map<String, ScriptDependency> declaredByScriptId = normalizeDeclaredDependencies(declaredDependencies);
        for (String dependencyScriptId : detectedScriptIds) {
            ScriptDependency declared = declaredByScriptId.get(dependencyScriptId);
            if (declared != null) {
                resolvedByScriptId.put(dependencyScriptId, normalizeVersionRange(declared.copy()));
                continue;
            }
            ScriptDefinition dependencyScript = loadPublishedScript(dependencyScriptId);
            ScriptDependency auto = resolveAutoDependency(dependencyScriptId, dependencyScript, preferredRepositoryId);
            if (auto == null) {
                throw new IllegalArgumentException("脚本依赖缺少仓库映射: " + dependencyScriptId);
            }
            resolvedByScriptId.put(dependencyScriptId, auto);
        }

        List<String> extras = declaredByScriptId.keySet().stream()
                .filter(scriptId -> !detectedScriptIds.contains(scriptId))
                .toList();
        if (!extras.isEmpty()) {
            throw new IllegalArgumentException("脚本依赖声明未在源码中使用: " + String.join(", ", extras));
        }
        return new ArrayList<>(resolvedByScriptId.values());
    }

    private ScriptDependency resolveAutoDependency(String dependencyScriptId,
                                                   ScriptDefinition dependencyScript,
                                                   String preferredRepositoryId) {
        if (NormalizeUtils.isNotBlank(preferredRepositoryId)) {
            try {
                RepositoryScriptDescriptor descriptor = catalog.getRepositoryScript(preferredRepositoryId, dependencyScriptId).descriptor();
                return new ScriptDependency()
                        .setScriptId(dependencyScriptId)
                        .setRepositoryId(preferredRepositoryId)
                        .setRepositoryScriptId(descriptor.scriptId())
                        .setVersionRange(">= " + descriptor.version());
            } catch (IllegalArgumentException ignored) {
                // fall through
            }
        }
        if (NormalizeUtils.isNotBlank(dependencyScript.getRepositoryId())
                && NormalizeUtils.isNotBlank(dependencyScript.getRepositoryScriptId())) {
            return new ScriptDependency()
                    .setScriptId(dependencyScriptId)
                    .setRepositoryId(dependencyScript.getRepositoryId())
                    .setRepositoryScriptId(dependencyScript.getRepositoryScriptId())
                    .setVersionRange(NormalizeUtils.normalizeOrDefault(
                            NormalizeUtils.normalizeNullable(dependencyScript.getRepositoryVersion()) == null
                                    ? null
                                    : ">= " + dependencyScript.getRepositoryVersion(),
                            null
                    ));
        }
        for (RepositoryDefinition repository : catalog.listEnabledDiscoveryRepositories()) {
            try {
                RepositoryScriptDescriptor descriptor = catalog.getRepositoryScript(repository.getId(), dependencyScriptId).descriptor();
                return new ScriptDependency()
                        .setScriptId(dependencyScriptId)
                        .setRepositoryId(descriptor.repositoryId())
                        .setRepositoryScriptId(descriptor.scriptId())
                        .setVersionRange(">= " + descriptor.version());
            } catch (IllegalArgumentException ignored) {
                // continue
            }
        }
        return null;
    }

    private ScriptDefinition loadPublishedScript(String scriptId) {
        return scriptApplicationService.getPublished(NormalizeUtils.normalize(scriptId, "scriptId 不能为空"));
    }

    private static RepositoryWebhookPublishDependencyDraft toDraft(ScriptDependency dependency, String state) {
        return new RepositoryWebhookPublishDependencyDraft(
                dependency.getScriptId(),
                dependency.getRepositoryId(),
                dependency.getRepositoryScriptId(),
                dependency.getVersionRange(),
                state
        );
    }

    private static Map<String, ScriptDependency> normalizeDeclaredDependencies(List<ScriptDependency> declaredDependencies) {
        Map<String, ScriptDependency> declaredByScriptId = new LinkedHashMap<>();
        for (ScriptDependency dependency : NormalizeUtils.nullSafeList(declaredDependencies)) {
            String scriptId = NormalizeUtils.normalize(dependency.getScriptId(), "脚本依赖 scriptId 不能为空");
            if (declaredByScriptId.containsKey(scriptId)) {
                throw new IllegalArgumentException("脚本依赖重复声明: " + scriptId);
            }
            declaredByScriptId.put(scriptId, normalizeVersionRange(dependency.copy()));
        }
        return declaredByScriptId;
    }

    private static ScriptDependency normalizeVersionRange(ScriptDependency dependency) {
        if (NormalizeUtils.isBlank(dependency.getVersionRange())) {
            dependency.setVersionRange(null);
        } else {
            dependency.setVersionRange(dependency.getVersionRange().trim());
        }
        return dependency;
    }

    private static String suggestNextVersion(String value) {
        if (NormalizeUtils.isBlank(value)) {
            return "0.1.0";
        }
        String[] parts = value.split("\\.");
        int lastIndex = parts.length - 1;
        try {
            int last = Integer.parseInt(parts[lastIndex]);
            parts[lastIndex] = Integer.toString(last + 1);
            return String.join(".", parts);
        } catch (NumberFormatException exception) {
            return value;
        }
    }

    private record ResolvedDependency(ScriptDependency dependency, String state) {
        String scriptId() {
            return dependency.getScriptId();
        }
    }
}
