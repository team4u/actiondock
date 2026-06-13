package org.team4u.actiondock.repository;

import org.team4u.actiondock.common.NormalizeUtils;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookAgentSkillRef;
import org.team4u.actiondock.domain.model.PlaybookKnowledgeRef;
import org.team4u.actiondock.domain.model.PlaybookRelatedRef;
import org.team4u.actiondock.domain.model.PlaybookScriptRef;
import org.team4u.actiondock.domain.model.PlaybookRiskLevel;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.RepositoryLocalAssetMode;
import org.team4u.actiondock.domain.model.UpstreamAssetType;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

public class RepositoryPlaybookService {
    private final RepositoryCatalogService catalog;
    private final RepositoryCatalogService.Repositories repos;
    private final RepositoryScriptService scriptService;
    private final RepositoryKnowledgeService knowledgeService;
    private final RepositoryDependencyResolver dependencyResolver;

    public RepositoryPlaybookService(RepositoryCatalogService catalog) {
        this(catalog, null, null);
    }

    public RepositoryPlaybookService(RepositoryCatalogService catalog,
                                     RepositoryScriptService scriptService,
                                     RepositoryKnowledgeService knowledgeService) {
        this.catalog = catalog;
        this.repos = catalog.getRepos();
        this.scriptService = scriptService;
        this.knowledgeService = knowledgeService == null ? new RepositoryKnowledgeService(catalog) : knowledgeService;
        this.dependencyResolver = new RepositoryDependencyResolver(catalog);
    }

    public RepositoryPlaybookDescriptor publishPlaybook(String repositoryId, RepositoryPlaybookPublishRequest request) {
        WritableRepositorySession session = catalog.openWritableRepositorySession(repositoryId);
        Playbook source = repos.playbookRepository()
                .findById(NormalizeUtils.normalize(request.sourceId(), "sourceId 不能为空"))
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.PLAYBOOK_NOT_FOUND,
                        "任务手册不存在: " + request.sourceId(),
                        Map.of("sourceId", request.sourceId())));
        if (source.isManaged() && !request.force()) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.PLAYBOOK_NOT_EDITABLE,
                    "托管任务手册为只读，不能直接发布: " + source.getId(),
                    Map.of("playbookId", source.getId()));
        }
        validateReferencedAssetsPublished(repositoryId, source);
        String playbookId = NormalizeUtils.normalize(request.playbookId(), "playbookId 不能为空");
        String version = NormalizeUtils.normalize(request.version(), "version 不能为空");
        assertPlaybookVersionAvailable(repositoryId, session.index(), playbookId, version);

        PlaybookFile playbookFile = buildPlaybookFile(source, request, playbookId, version);
        Path playbookDir = session.root().resolve(PLAYBOOKS_DIR).resolve(playbookId);
        catalog.writeJson(playbookDir.resolve(PLAYBOOK_DESCRIPTOR_FILE), playbookFile);
        session.commitPublishedAsset(playbookId, version, request.releaseNotes());
        catalog.refreshRepositoryCache(repositoryId);
        return catalog.getRepositoryPlaybook(repositoryId, playbookId).descriptor();
    }

    public RepositoryLocalAsset addLocalAsset(String repositoryId,
                                             String playbookId,
                                             RepositoryLocalAssetRequest request) {
        RepositoryLocalAssetMode mode = parseMode(request == null ? null : request.mode());
        if (mode == RepositoryLocalAssetMode.TRACKED) {
            return createTrackedWorkingCopy(repositoryId, playbookId, request);
        }
        return installOrUpdate(repositoryId, playbookId, false, new LinkedHashSet<>());
    }

    public RepositoryLocalAsset updateLocalAsset(String repositoryId, String playbookId) {
        return installOrUpdate(repositoryId, playbookId, true, new LinkedHashSet<>());
    }

    public void uninstallPlaybook(String localAssetId) {
        Playbook playbook = repos.playbookRepository().findById(NormalizeUtils.normalize(localAssetId, "localAssetId 不能为空"))
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.PLAYBOOK_NOT_FOUND,
                        "本地任务手册不存在: " + localAssetId,
                        Map.of("localAssetId", localAssetId)));
        if (!playbook.isManaged()) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.PLAYBOOK_NOT_EDITABLE,
                    "仅支持卸载仓库托管任务手册: " + localAssetId,
                    Map.of("localAssetId", localAssetId));
        }
        repos.playbookRepository().deleteById(playbook.getId());
        repos.repositoryLocalAssetRepository()
                .findByLocalAsset(UpstreamAssetType.PLAYBOOK, localAssetId)
                .ifPresent(asset -> repos.repositoryLocalAssetRepository().deleteById(asset.getId()));
    }

    private RepositoryLocalAsset installOrUpdate(String repositoryId,
                                                 String playbookId,
                                                 boolean updateOnly,
                                                 LinkedHashSet<String> visiting) {
        String installationKey = repositoryId + ":" + playbookId;
        if (!visiting.add(installationKey)) {
            throw ActionDockException.badRequest(
                    ActionDockErrorCodes.PLAYBOOK_CIRCULAR_DEPENDENCY,
                    "检测到任务手册循环依赖: " + String.join(" -> ", visiting) + " -> " + installationKey,
                    Map.of("dependencyChain", String.join(" -> ", visiting) + " -> " + installationKey));
        }
        try {
        RepositoryPlaybookDetail detail = catalog.getRepositoryPlaybook(repositoryId, playbookId);
        RepositoryLocalAsset existingAsset = repos.repositoryLocalAssetRepository()
                .findByUpstreamAsset(UpstreamAssetType.PLAYBOOK, repositoryId, playbookId)
                .orElse(null);
        if (existingAsset != null && existingAsset.getMode() == RepositoryLocalAssetMode.TRACKED) {
            if (updateOnly) {
                throw ActionDockException.conflict(
                        ActionDockErrorCodes.UPSTREAM_CONFLICT,
                        "上游任务手册已添加为可编辑跟踪资产，不能按只读资产更新: " + existingAsset.getLocalAssetId(),
                        Map.of("localAssetId", existingAsset.getLocalAssetId()));
            }
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.UPSTREAM_CONFLICT,
                    "上游任务手册已添加到本地: " + existingAsset.getLocalAssetId(),
                    Map.of("localAssetId", existingAsset.getLocalAssetId()));
        }
        if (!updateOnly && existingAsset != null) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.UPSTREAM_CONFLICT,
                    "上游任务手册已添加到本地: " + existingAsset.getLocalAssetId(),
                    Map.of("localAssetId", existingAsset.getLocalAssetId()));
        }
        if (updateOnly && existingAsset == null) {
            throw ActionDockException.notFound(
                    ActionDockErrorCodes.PLAYBOOK_NOT_FOUND,
                    "任务手册尚未安装: " + repositoryId + "/" + playbookId,
                    Map.of("repositoryId", repositoryId, "playbookId", playbookId));
        }
        String localPlaybookId = existingAsset == null ? repositoryId + "." + playbookId : existingAsset.getLocalAssetId();
        Playbook existingPlaybook = repos.playbookRepository().findById(localPlaybookId).orElse(null);
        if (existingPlaybook != null && !existingPlaybook.isManaged()) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.PLAYBOOK_EXISTS,
                    "本地已存在同 ID 非托管任务手册: " + localPlaybookId,
                    Map.of("playbookId", localPlaybookId));
        }
        PlaybookDependencyResolution dependencies = resolveAndInstallDependencies(repositoryId, detail.playbook(), true, visiting);
        LocalDateTime now = LocalDateTime.now();
        Playbook saved = buildManagedPlaybook(rewriteReferences(detail.playbook(), dependencies), localPlaybookId, existingPlaybook, now);
        repos.playbookRepository().save(saved);
        return saveLocalAsset(detail, saved, existingAsset, now);
        } finally {
            visiting.remove(installationKey);
        }
    }

    private RepositoryLocalAsset createTrackedWorkingCopy(String repositoryId,
                                                          String playbookId,
                                                          RepositoryLocalAssetRequest request) {
        if (repos.repositoryLocalAssetRepository()
                .findByUpstreamAsset(UpstreamAssetType.PLAYBOOK, repositoryId, playbookId).isPresent()) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.UPSTREAM_CONFLICT,
                    "上游任务手册已添加到本地: " + repositoryId + "/" + playbookId,
                    Map.of("repositoryId", repositoryId, "playbookId", playbookId));
        }
        RepositoryPlaybookDetail detail = catalog.getRepositoryPlaybook(repositoryId, playbookId);
        String localPlaybookId = NormalizeUtils.normalizeOrDefault(
                request == null ? null : request.localAssetId(),
                repositoryId + "." + playbookId);
        if (repos.playbookRepository().findById(localPlaybookId).isPresent()) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.PLAYBOOK_EXISTS,
                    "任务手册 ID 已存在，请指定其他本地副本 ID: " + localPlaybookId,
                    Map.of("playbookId", localPlaybookId));
        }
        LinkedHashSet<String> visiting = new LinkedHashSet<>();
        String installationKey = repositoryId + ":" + playbookId;
        visiting.add(installationKey);
        PlaybookDependencyResolution dependencies;
        try {
            dependencies = resolveAndInstallDependencies(repositoryId, detail.playbook(), false, visiting);
        } finally {
            visiting.remove(installationKey);
        }
        LocalDateTime now = LocalDateTime.now();
        Playbook saved = buildTrackedPlaybook(rewriteReferences(detail.playbook(), dependencies), localPlaybookId, now);
        repos.playbookRepository().save(saved);
        return saveTrackedLocalAsset(detail, saved, now);
    }

    private PlaybookDependencyResolution resolveAndInstallDependencies(String repositoryId,
                                                                       PlaybookFile playbook,
                                                                       boolean refreshLockedDependencies,
                                                                       LinkedHashSet<String> visiting) {
        PlaybookDependencyResolution resolution = new PlaybookDependencyResolution();
        for (PlaybookKnowledgeRef ref : NormalizeUtils.nullSafeList(playbook.knowledgeRefs())) {
            String knowledgeId = NormalizeUtils.normalizeNullable(ref.getRepositoryId());
            if (knowledgeId == null) {
                continue;
            }
            String dependencyRepositoryId = dependencyResolver.resolvePlaybookKnowledgeRepositoryId(repositoryId, knowledgeId, knowledgeId);
            String installedRepositoryId = ensureKnowledgeInstalled(dependencyRepositoryId, knowledgeId);
            resolution.knowledgeIds.put(knowledgeId, installedRepositoryId);
        }
        for (String repositoryIdRef : NormalizeUtils.nullSafeList(playbook.repositoryIds())) {
            String knowledgeId = NormalizeUtils.normalizeNullable(repositoryIdRef);
            if (knowledgeId == null) {
                continue;
            }
            try {
                String dependencyRepositoryId = dependencyResolver.resolvePlaybookKnowledgeRepositoryId(repositoryId, knowledgeId, knowledgeId);
                String installedRepositoryId = ensureKnowledgeInstalled(dependencyRepositoryId, knowledgeId);
                resolution.knowledgeIds.put(knowledgeId, installedRepositoryId);
            } catch (IllegalArgumentException ignored) {
                // repositoryIds can also point to local project repositories; only rewrite published knowledge refs.
            }
        }
        for (PlaybookScriptRef ref : NormalizeUtils.nullSafeList(playbook.scriptRefs())) {
            String scriptId = NormalizeUtils.normalizeNullable(ref.getScriptId());
            if (scriptId == null) {
                continue;
            }
            String dependencyRepositoryId = dependencyResolver.resolvePlaybookScriptRepositoryId(repositoryId, null, scriptId);
            RepositoryLocalAsset asset = ensureScriptInstalled(dependencyRepositoryId, scriptId, refreshLockedDependencies);
            resolution.scriptIds.put(scriptId, asset.getLocalAssetId());
        }
        for (PlaybookRelatedRef ref : NormalizeUtils.nullSafeList(playbook.relatedPlaybookRefs())) {
            String relatedPlaybookId = NormalizeUtils.normalizeNullable(ref.getPlaybookId());
            if (relatedPlaybookId == null) {
                continue;
            }
            String dependencyRepositoryId = dependencyResolver.resolvePlaybookRepositoryId(repositoryId, null, relatedPlaybookId);
            RepositoryLocalAsset asset = ensureRelatedPlaybookInstalled(dependencyRepositoryId, relatedPlaybookId, refreshLockedDependencies, visiting);
            resolution.playbookIds.put(relatedPlaybookId, asset.getLocalAssetId());
        }
        return resolution;
    }

    private String ensureKnowledgeInstalled(String repositoryId, String knowledgeId) {
        String installedRepositoryId = RepositoryKnowledgeService.buildInstalledRepositoryId(repositoryId, knowledgeId);
        if (catalog.findRepository(installedRepositoryId).isEmpty()) {
            knowledgeService.installKnowledge(repositoryId, knowledgeId);
        }
        return installedRepositoryId;
    }

    private RepositoryLocalAsset ensureScriptInstalled(String repositoryId,
                                                       String scriptId,
                                                       boolean refreshLockedDependencies) {
        RepositoryLocalAsset existing = repos.repositoryLocalAssetRepository()
                .findByUpstreamAsset(UpstreamAssetType.SCRIPT, repositoryId, scriptId)
                .orElse(null);
        if (existing != null) {
            if (existing.getMode() == RepositoryLocalAssetMode.LOCKED && refreshLockedDependencies) {
                return requiredScriptService().updateLocalAsset(repositoryId, scriptId, dependencyScriptOptions());
            }
            return existing;
        }
        return requiredScriptService().addLocalAsset(repositoryId, scriptId,
                new RepositoryLocalAssetRequest("LOCKED", null, true, true, true, false));
    }

    private RepositoryLocalAsset ensureRelatedPlaybookInstalled(String repositoryId,
                                                                String playbookId,
                                                                boolean refreshLockedDependencies,
                                                                LinkedHashSet<String> visiting) {
        RepositoryLocalAsset existing = repos.repositoryLocalAssetRepository()
                .findByUpstreamAsset(UpstreamAssetType.PLAYBOOK, repositoryId, playbookId)
                .orElse(null);
        if (existing != null) {
            if (existing.getMode() == RepositoryLocalAssetMode.LOCKED && refreshLockedDependencies) {
                return installOrUpdate(repositoryId, playbookId, true, visiting);
            }
            return existing;
        }
        return installOrUpdate(repositoryId, playbookId, false, visiting);
    }

    private RepositoryScriptService requiredScriptService() {
        if (scriptService == null) {
            throw ActionDockException.badRequest(
                    ActionDockErrorCodes.PLAYBOOK_REFERENCE_UNRESOLVED,
                    "RepositoryScriptService 未配置，无法安装任务手册脚本依赖",
                    Map.of());
        }
        return scriptService;
    }

    private ToolInstallationOptions dependencyScriptOptions() {
        return new ToolInstallationOptions(true, true, true, false);
    }

    private PlaybookFile rewriteReferences(PlaybookFile source, PlaybookDependencyResolution resolution) {
        return new PlaybookFile(
                source.schemaVersion(),
                source.playbookId(),
                source.displayName(),
                source.version(),
                source.description(),
                source.releaseNotes(),
                source.owner(),
                source.tags(),
                source.riskLevel(),
                rewriteRepositoryIds(source.repositoryIds(), resolution.knowledgeIds),
                rewriteKnowledgeRefs(source.knowledgeRefs(), resolution.knowledgeIds),
                rewriteScriptRefs(source.scriptRefs(), resolution.scriptIds),
                source.agentSkillRefs(),
                rewriteRelatedPlaybookRefs(source.relatedPlaybookRefs(), resolution.playbookIds),
                source.guideMarkdown(),
                source.stopConditions(),
                source.enabled(),
                source.digest()
        );
    }

    private List<String> rewriteRepositoryIds(List<String> repositoryIds, Map<String, String> knowledgeIds) {
        return NormalizeUtils.nullSafeList(repositoryIds).stream()
                .map(item -> knowledgeIds.getOrDefault(item, item))
                .toList();
    }

    private List<PlaybookKnowledgeRef> rewriteKnowledgeRefs(List<PlaybookKnowledgeRef> refs, Map<String, String> knowledgeIds) {
        return NormalizeUtils.nullSafeList(refs).stream()
                .map(ref -> new PlaybookKnowledgeRef()
                        .setType(ref.getType())
                        .setRepositoryId(knowledgeIds.getOrDefault(ref.getRepositoryId(), ref.getRepositoryId()))
                        .setPath(ref.getPath())
                        .setMarkdown(ref.getMarkdown()))
                .toList();
    }

    private List<PlaybookScriptRef> rewriteScriptRefs(List<PlaybookScriptRef> refs, Map<String, String> scriptIds) {
        return NormalizeUtils.nullSafeList(refs).stream()
                .map(ref -> new PlaybookScriptRef()
                        .setScriptId(scriptIds.getOrDefault(ref.getScriptId(), ref.getScriptId()))
                        .setPurpose(ref.getPurpose()))
                .toList();
    }

    private List<PlaybookRelatedRef> rewriteRelatedPlaybookRefs(List<PlaybookRelatedRef> refs, Map<String, String> playbookIds) {
        return NormalizeUtils.nullSafeList(refs).stream()
                .map(ref -> new PlaybookRelatedRef()
                        .setPlaybookId(playbookIds.getOrDefault(ref.getPlaybookId(), ref.getPlaybookId()))
                        .setRelation(ref.getRelation())
                        .setPurpose(ref.getPurpose()))
                .toList();
    }

    private static final class PlaybookDependencyResolution {
        private final Map<String, String> knowledgeIds = new LinkedHashMap<>();
        private final Map<String, String> scriptIds = new LinkedHashMap<>();
        private final Map<String, String> playbookIds = new LinkedHashMap<>();
    }

    private void validateReferencedAssetsPublished(String repositoryId, Playbook source) {
        LinkedHashSet<String> missingScriptIds = new LinkedHashSet<>();
        for (PlaybookScriptRef ref : NormalizeUtils.nullSafeList(source.getScriptRefs())) {
            String scriptId = NormalizeUtils.normalizeNullable(ref.getScriptId());
            if (scriptId == null) {
                continue;
            }
            boolean published = catalog.listRepositoryScripts(repositoryId).stream()
                    .anyMatch(item -> Objects.equals(item.scriptId(), scriptId));
            if (!published) {
                missingScriptIds.add(scriptId);
            }
        }

        LinkedHashSet<String> missingKnowledgeRepositoryIds = new LinkedHashSet<>();
        for (PlaybookKnowledgeRef ref : NormalizeUtils.nullSafeList(source.getKnowledgeRefs())) {
            String knowledgeRepositoryId = NormalizeUtils.normalizeNullable(ref.getRepositoryId());
            if (knowledgeRepositoryId == null) {
                continue;
            }
            boolean published = knowledgeService.listRepositoryKnowledge(repositoryId).stream()
                    .anyMatch(item -> Objects.equals(item.knowledgeId(), knowledgeRepositoryId));
            if (!published) {
                missingKnowledgeRepositoryIds.add(knowledgeRepositoryId);
            }
        }

        if (missingScriptIds.isEmpty() && missingKnowledgeRepositoryIds.isEmpty()) {
            return;
        }

        List<String> messages = new ArrayList<>();
        if (!missingScriptIds.isEmpty()) {
            messages.add("以下关联脚本尚未发布到目标仓库，请先分别发布脚本: " + String.join(", ", missingScriptIds));
        }
        if (!missingKnowledgeRepositoryIds.isEmpty()) {
            messages.add("以下知识引用对应的项目仓库尚未作为知识源发布到目标仓库，请先分别发布知识源: "
                    + String.join(", ", missingKnowledgeRepositoryIds));
        }
        throw ActionDockException.badRequest(
                ActionDockErrorCodes.PLAYBOOK_REFERENCE_UNRESOLVED,
                String.join("; ", messages),
                Map.of(
                        "missingScriptIds", new ArrayList<>(missingScriptIds),
                        "missingKnowledgeRepositoryIds", new ArrayList<>(missingKnowledgeRepositoryIds)
                ));
    }

    private RepositoryLocalAsset saveLocalAsset(RepositoryPlaybookDetail detail,
                                               Playbook playbook,
                                               RepositoryLocalAsset previous,
                                               LocalDateTime now) {
        return repos.repositoryLocalAssetRepository().save(new RepositoryLocalAsset()
                .setId(previous == null ? "PLAYBOOK:LOCKED:" + playbook.getId() : previous.getId())
                .setAssetType(UpstreamAssetType.PLAYBOOK)
                .setLocalAssetId(playbook.getId())
                .setRepositoryId(detail.descriptor().repositoryId())
                .setUpstreamAssetId(detail.descriptor().playbookId())
                .setMode(RepositoryLocalAssetMode.LOCKED)
                .setVersion(detail.descriptor().version())
                .setLatestVersion(detail.descriptor().version())
                .setName(playbook.getName())
                .setOwner(detail.descriptor().owner())
                .setDescription(playbook.getDescription())
                .setCreatedAt(previous == null ? now : previous.getCreatedAt())
                .setUpdatedAt(now));
    }

    private static Playbook buildManagedPlaybook(PlaybookFile file,
                                                 String localPlaybookId,
                                                 Playbook existing,
                                                 LocalDateTime now) {
        return new Playbook()
                .setId(localPlaybookId)
                .setName(file.displayName())
                .setDescription(file.description())
                .setTags(file.tags())
                .setRiskLevel(parseRiskLevel(file.riskLevel()))
                .setRepositoryIds(file.repositoryIds())
                .setKnowledgeRefs(file.knowledgeRefs())
                .setScriptRefs(file.scriptRefs())
                .setAgentSkillRefs(file.agentSkillRefs())
                .setRelatedPlaybookRefs(file.relatedPlaybookRefs())
                .setGuideMarkdown(file.guideMarkdown())
                .setStopConditions(file.stopConditions())
                .setEnabled(file.enabled())
                .setManaged(true)
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now);
    }

    private static Playbook buildTrackedPlaybook(PlaybookFile file,
                                                String localPlaybookId,
                                                LocalDateTime now) {
        return new Playbook()
                .setId(localPlaybookId)
                .setName(file.displayName())
                .setDescription(file.description())
                .setTags(file.tags())
                .setRiskLevel(parseRiskLevel(file.riskLevel()))
                .setRepositoryIds(file.repositoryIds())
                .setKnowledgeRefs(file.knowledgeRefs())
                .setScriptRefs(file.scriptRefs())
                .setAgentSkillRefs(file.agentSkillRefs())
                .setRelatedPlaybookRefs(file.relatedPlaybookRefs())
                .setGuideMarkdown(file.guideMarkdown())
                .setStopConditions(file.stopConditions())
                .setEnabled(file.enabled())
                .setManaged(false)
                .setCreatedAt(now)
                .setUpdatedAt(now);
    }

    private RepositoryLocalAsset saveTrackedLocalAsset(RepositoryPlaybookDetail detail,
                                                      Playbook playbook,
                                                      LocalDateTime now) {
        return repos.repositoryLocalAssetRepository().save(new RepositoryLocalAsset()
                .setId("PLAYBOOK:TRACKED:" + playbook.getId())
                .setAssetType(UpstreamAssetType.PLAYBOOK)
                .setLocalAssetId(playbook.getId())
                .setRepositoryId(detail.descriptor().repositoryId())
                .setUpstreamAssetId(detail.descriptor().playbookId())
                .setMode(RepositoryLocalAssetMode.TRACKED)
                .setVersion(detail.descriptor().version())
                .setLatestVersion(detail.descriptor().version())
                .setName(playbook.getName())
                .setOwner(detail.descriptor().owner())
                .setDescription(playbook.getDescription())
                .setCreatedAt(now)
                .setUpdatedAt(now));
    }

    private static RepositoryLocalAssetMode parseMode(String mode) {
        if (NormalizeUtils.isBlank(mode)) {
            return RepositoryLocalAssetMode.LOCKED;
        }
        return RepositoryLocalAssetMode.valueOf(mode);
    }

    private PlaybookFile buildPlaybookFile(Playbook source,
                                           RepositoryPlaybookPublishRequest request,
                                           String playbookId,
                                           String version) {
        PlaybookFile initial = new PlaybookFile(
                RepositoryIndexUtils.DEFAULT_VERSION,
                playbookId,
                NormalizeUtils.normalizeOrDefault(request.displayName(), source.getName()),
                version,
                source.getDescription(),
                NormalizeUtils.normalizeNullable(request.releaseNotes()),
                NormalizeUtils.normalizeNullable(request.owner()),
                NormalizeUtils.nullSafeList(request.tags()),
                source.getRiskLevel() == null ? null : source.getRiskLevel().name(),
                source.getRepositoryIds(),
                source.getKnowledgeRefs(),
                source.getScriptRefs(),
                source.getAgentSkillRefs(),
                source.getRelatedPlaybookRefs(),
                source.getGuideMarkdown(),
                source.getStopConditions(),
                source.isEnabled(),
                null
        );
        return new PlaybookFile(
                initial.schemaVersion(),
                initial.playbookId(),
                initial.displayName(),
                initial.version(),
                initial.description(),
                initial.releaseNotes(),
                initial.owner(),
                initial.tags(),
                initial.riskLevel(),
                initial.repositoryIds(),
                initial.knowledgeRefs(),
                initial.scriptRefs(),
                initial.agentSkillRefs(),
                initial.relatedPlaybookRefs(),
                initial.guideMarkdown(),
                initial.stopConditions(),
                initial.enabled(),
                computeDigest(initial)
        );
    }

    private String computeDigest(PlaybookFile file) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("playbookId", file.playbookId());
        values.put("displayName", file.displayName());
        values.put("version", file.version());
        values.put("description", file.description());
        values.put("owner", file.owner());
        values.put("tags", file.tags());
        values.put("riskLevel", file.riskLevel());
        values.put("repositoryIds", file.repositoryIds());
        values.put("knowledgeRefs", file.knowledgeRefs());
        values.put("scriptRefs", file.scriptRefs());
        values.put("agentSkillRefs", file.agentSkillRefs());
        values.put("relatedPlaybookRefs", file.relatedPlaybookRefs());
        values.put("guideMarkdown", file.guideMarkdown());
        values.put("stopConditions", file.stopConditions());
        values.put("enabled", file.enabled());
        return catalog.computeDigest(values);
    }

    private static PlaybookRiskLevel parseRiskLevel(String value) {
        return NormalizeUtils.isBlank(value) ? null : PlaybookRiskLevel.valueOf(value);
    }
}
