package org.team4u.actiondock.repository;

import org.team4u.actiondock.common.NormalizeUtils;
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
    private final RepositoryKnowledgeService knowledgeService;

    public RepositoryPlaybookService(RepositoryCatalogService catalog) {
        this.catalog = catalog;
        this.repos = catalog.getRepos();
        this.knowledgeService = new RepositoryKnowledgeService(catalog);
    }

    public RepositoryPlaybookDescriptor publishPlaybook(String repositoryId, RepositoryPlaybookPublishRequest request) {
        WritableRepositorySession session = catalog.openWritableRepositorySession(repositoryId);
        Playbook source = repos.playbookRepository()
                .findById(NormalizeUtils.normalize(request.sourceId(), "sourceId 不能为空"))
                .orElseThrow(() -> new IllegalArgumentException("任务手册不存在: " + request.sourceId()));
        if (source.isManaged() && !request.force()) {
            throw new IllegalArgumentException("托管任务手册为只读，不能直接发布: " + source.getId());
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
        return installOrUpdate(repositoryId, playbookId, false);
    }

    public RepositoryLocalAsset updateLocalAsset(String repositoryId, String playbookId) {
        return installOrUpdate(repositoryId, playbookId, true);
    }

    public void uninstallPlaybook(String localAssetId) {
        Playbook playbook = repos.playbookRepository().findById(NormalizeUtils.normalize(localAssetId, "localAssetId 不能为空"))
                .orElseThrow(() -> new IllegalArgumentException("本地任务手册不存在: " + localAssetId));
        if (!playbook.isManaged()) {
            throw new IllegalArgumentException("仅支持卸载仓库托管任务手册: " + localAssetId);
        }
        repos.playbookRepository().deleteById(playbook.getId());
        repos.repositoryLocalAssetRepository()
                .findByLocalAsset(UpstreamAssetType.PLAYBOOK, localAssetId)
                .ifPresent(asset -> repos.repositoryLocalAssetRepository().deleteById(asset.getId()));
    }

    private RepositoryLocalAsset installOrUpdate(String repositoryId, String playbookId, boolean updateOnly) {
        RepositoryPlaybookDetail detail = catalog.getRepositoryPlaybook(repositoryId, playbookId);
        RepositoryLocalAsset existingAsset = repos.repositoryLocalAssetRepository()
                .findByUpstreamAsset(UpstreamAssetType.PLAYBOOK, repositoryId, playbookId)
                .orElse(null);
        if (!updateOnly && existingAsset != null) {
            throw new IllegalArgumentException("上游任务手册已添加到本地: " + existingAsset.getLocalAssetId());
        }
        if (updateOnly && existingAsset == null) {
            throw new IllegalArgumentException("任务手册尚未安装: " + repositoryId + "/" + playbookId);
        }
        String localPlaybookId = existingAsset == null ? repositoryId + "." + playbookId : existingAsset.getLocalAssetId();
        Playbook existingPlaybook = repos.playbookRepository().findById(localPlaybookId).orElse(null);
        if (existingPlaybook != null && !existingPlaybook.isManaged()) {
            throw new IllegalArgumentException("本地已存在同 ID 非托管任务手册: " + localPlaybookId);
        }
        LocalDateTime now = LocalDateTime.now();
        Playbook saved = buildManagedPlaybook(detail.playbook(), localPlaybookId, existingPlaybook, now);
        repos.playbookRepository().save(saved);
        return saveLocalAsset(detail, saved, existingAsset, now);
    }

    private RepositoryLocalAsset createTrackedWorkingCopy(String repositoryId,
                                                          String playbookId,
                                                          RepositoryLocalAssetRequest request) {
        if (repos.repositoryLocalAssetRepository()
                .findByUpstreamAsset(UpstreamAssetType.PLAYBOOK, repositoryId, playbookId).isPresent()) {
            throw new IllegalArgumentException("上游任务手册已添加到本地: " + repositoryId + "/" + playbookId);
        }
        RepositoryPlaybookDetail detail = catalog.getRepositoryPlaybook(repositoryId, playbookId);
        String localPlaybookId = NormalizeUtils.normalizeOrDefault(
                request == null ? null : request.localAssetId(),
                repositoryId + "." + playbookId);
        if (repos.playbookRepository().findById(localPlaybookId).isPresent()) {
            throw new IllegalArgumentException("任务手册 ID 已存在，请指定其他本地副本 ID: " + localPlaybookId);
        }
        LocalDateTime now = LocalDateTime.now();
        Playbook saved = buildTrackedPlaybook(detail.playbook(), localPlaybookId, now);
        repos.playbookRepository().save(saved);
        return saveTrackedLocalAsset(detail, saved, now);
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
        throw new IllegalArgumentException(String.join("; ", messages));
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

    private static void buildGroupFile() {} // Removed buildGroupFile method

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
