package org.team4u.actiondock.repository;

import org.team4u.actiondock.common.NormalizeUtils;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookGroup;
import org.team4u.actiondock.domain.model.PlaybookRiskLevel;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.RepositoryLocalAssetMode;
import org.team4u.actiondock.domain.model.UpstreamAssetType;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

public class RepositoryPlaybookService {
    private final RepositoryCatalogService catalog;
    private final RepositoryCatalogService.Repositories repos;

    public RepositoryPlaybookService(RepositoryCatalogService catalog) {
        this.catalog = catalog;
        this.repos = catalog.getRepos();
    }

    public RepositoryPlaybookDescriptor publishPlaybook(String repositoryId, RepositoryPlaybookPublishRequest request) {
        WritableRepositorySession session = catalog.openWritableRepositorySession(repositoryId);
        Playbook source = repos.playbookRepository()
                .findById(NormalizeUtils.normalize(request.sourceId(), "sourceId 不能为空"))
                .orElseThrow(() -> new IllegalArgumentException("任务手册不存在: " + request.sourceId()));
        if (source.isManaged() && !request.force()) {
            throw new IllegalArgumentException("托管任务手册为只读，不能直接发布: " + source.getId());
        }
        PlaybookGroup group = repos.playbookGroupRepository().findById(source.getGroupId())
                .orElseThrow(() -> new IllegalArgumentException("任务分组不存在: " + source.getGroupId()));
        String playbookId = NormalizeUtils.normalize(request.playbookId(), "playbookId 不能为空");
        String version = NormalizeUtils.normalize(request.version(), "version 不能为空");
        assertPlaybookVersionAvailable(repositoryId, session.index(), playbookId, version);

        PlaybookGroupFile groupFile = buildGroupFile(group);
        PlaybookFile playbookFile = buildPlaybookFile(source, request, playbookId, version);
        Path groupDir = session.root().resolve(PLAYBOOK_GROUPS_DIR).resolve(group.getId());
        Path playbookDir = session.root().resolve(PLAYBOOKS_DIR).resolve(playbookId);
        catalog.writeJson(groupDir.resolve(PLAYBOOK_GROUP_DESCRIPTOR_FILE), groupFile);
        catalog.writeJson(playbookDir.resolve(PLAYBOOK_DESCRIPTOR_FILE), playbookFile);
        session.commitPublishedAsset(playbookId, version, request.releaseNotes());
        catalog.refreshRepositoryCache(repositoryId);
        return catalog.getRepositoryPlaybook(repositoryId, playbookId).descriptor();
    }

    public RepositoryLocalAsset addLocalAsset(String repositoryId, String playbookId) {
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
        String groupId = playbook.getGroupId();
        repos.playbookRepository().deleteById(playbook.getId());
        repos.repositoryLocalAssetRepository()
                .findByLocalAsset(UpstreamAssetType.PLAYBOOK, localAssetId)
                .ifPresent(asset -> repos.repositoryLocalAssetRepository().deleteById(asset.getId()));
        boolean groupStillUsed = repos.playbookRepository().findAll().stream()
                .anyMatch(item -> Objects.equals(item.getGroupId(), groupId));
        repos.playbookGroupRepository().findById(groupId)
                .filter(PlaybookGroup::isManaged)
                .filter(ignored -> !groupStillUsed)
                .ifPresent(group -> repos.playbookGroupRepository().deleteById(group.getId()));
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
        String localGroupId = repositoryId + "." + detail.group().groupId();
        PlaybookGroup existingGroup = repos.playbookGroupRepository().findById(localGroupId).orElse(null);
        if (existingGroup != null && !existingGroup.isManaged()) {
            throw new IllegalArgumentException("本地已存在同 ID 非托管任务分组: " + localGroupId);
        }
        LocalDateTime now = LocalDateTime.now();
        repos.playbookGroupRepository().save(buildManagedGroup(detail.group(), localGroupId, existingGroup, now));
        Playbook saved = buildManagedPlaybook(detail.playbook(), localPlaybookId, localGroupId, existingPlaybook, now);
        repos.playbookRepository().save(saved);
        return saveLocalAsset(detail, saved, existingAsset, now);
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

    private static PlaybookGroup buildManagedGroup(PlaybookGroupFile file,
                                                   String localGroupId,
                                                   PlaybookGroup existing,
                                                   LocalDateTime now) {
        return new PlaybookGroup()
                .setId(localGroupId)
                .setName(file.displayName())
                .setDescription(file.description())
                .setTags(file.tags())
                .setDefaultRepositoryIds(file.defaultRepositoryIds())
                .setEnabled(file.enabled())
                .setManaged(true)
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now);
    }

    private static Playbook buildManagedPlaybook(PlaybookFile file,
                                                 String localPlaybookId,
                                                 String localGroupId,
                                                 Playbook existing,
                                                 LocalDateTime now) {
        return new Playbook()
                .setId(localPlaybookId)
                .setGroupId(localGroupId)
                .setName(file.displayName())
                .setDescription(file.description())
                .setIntentAliases(file.intentAliases())
                .setTags(file.tags())
                .setRiskLevel(parseRiskLevel(file.riskLevel()))
                .setRepositoryIds(file.repositoryIds())
                .setKnowledgeRefs(file.knowledgeRefs())
                .setScriptRefs(file.scriptRefs())
                .setGuideMarkdown(file.guideMarkdown())
                .setStopConditions(file.stopConditions())
                .setEnabled(file.enabled())
                .setManaged(true)
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now);
    }

    private PlaybookFile buildPlaybookFile(Playbook source,
                                           RepositoryPlaybookPublishRequest request,
                                           String playbookId,
                                           String version) {
        PlaybookFile initial = new PlaybookFile(
                RepositoryIndexUtils.DEFAULT_VERSION,
                playbookId,
                source.getGroupId(),
                NormalizeUtils.normalizeOrDefault(request.displayName(), source.getName()),
                version,
                source.getDescription(),
                NormalizeUtils.normalizeNullable(request.releaseNotes()),
                NormalizeUtils.normalizeNullable(request.owner()),
                NormalizeUtils.nullSafeList(request.tags()),
                source.getRiskLevel() == null ? null : source.getRiskLevel().name(),
                source.getIntentAliases(),
                source.getRepositoryIds(),
                source.getKnowledgeRefs(),
                source.getScriptRefs(),
                source.getGuideMarkdown(),
                source.getStopConditions(),
                source.isEnabled(),
                null
        );
        return new PlaybookFile(
                initial.schemaVersion(),
                initial.playbookId(),
                initial.groupId(),
                initial.displayName(),
                initial.version(),
                initial.description(),
                initial.releaseNotes(),
                initial.owner(),
                initial.tags(),
                initial.riskLevel(),
                initial.intentAliases(),
                initial.repositoryIds(),
                initial.knowledgeRefs(),
                initial.scriptRefs(),
                initial.guideMarkdown(),
                initial.stopConditions(),
                initial.enabled(),
                computeDigest(initial)
        );
    }

    private static PlaybookGroupFile buildGroupFile(PlaybookGroup group) {
        return new PlaybookGroupFile(
                RepositoryIndexUtils.DEFAULT_VERSION,
                group.getId(),
                group.getName(),
                group.getDescription(),
                group.getTags(),
                group.getDefaultRepositoryIds(),
                group.isEnabled()
        );
    }

    private String computeDigest(PlaybookFile file) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("playbookId", file.playbookId());
        values.put("groupId", file.groupId());
        values.put("displayName", file.displayName());
        values.put("version", file.version());
        values.put("description", file.description());
        values.put("owner", file.owner());
        values.put("tags", file.tags());
        values.put("riskLevel", file.riskLevel());
        values.put("intentAliases", file.intentAliases());
        values.put("repositoryIds", file.repositoryIds());
        values.put("knowledgeRefs", file.knowledgeRefs());
        values.put("scriptRefs", file.scriptRefs());
        values.put("guideMarkdown", file.guideMarkdown());
        values.put("stopConditions", file.stopConditions());
        values.put("enabled", file.enabled());
        return catalog.computeDigest(values);
    }

    private static PlaybookRiskLevel parseRiskLevel(String value) {
        return NormalizeUtils.isBlank(value) ? null : PlaybookRiskLevel.valueOf(value);
    }
}
