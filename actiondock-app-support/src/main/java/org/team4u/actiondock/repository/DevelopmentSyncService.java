package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.ScriptStatus;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.exception.DevelopmentConflictException;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.Objects;

/**
 * 仓库工具开发同步服务，负责将远程仓库工具拉取到本地开发脚本。
 * <p>
 * 管理开发脚本的创建、状态查询和远程变更拉取，包含独立的状态机
 * （{@link DevelopmentSyncState}）来处理本地/远程变更冲突检测。
 *
 * @author jay.wu
 */
class DevelopmentSyncService {

    private final RepositoryCatalogService catalog;
    private final RepositoryCatalogService.Repositories repos;
    private final RepositoryCatalogService.ApplicationServices services;

    DevelopmentSyncService(RepositoryCatalogService catalog,
                           RepositoryCatalogService.Repositories repos,
                           RepositoryCatalogService.ApplicationServices services) {
        this.catalog = catalog;
        this.repos = repos;
        this.services = services;
    }

    // ---- 开发同步纯逻辑方法 ----

    static boolean isRemoteChanged(ScriptDefinition script, ToolSourceState state) {
        return !Objects.equals(script.getSourceCommit(), state.commit())
                || !Objects.equals(script.getSourceDigest(), state.digest());
    }

    static boolean isLocalChanged(ScriptDefinition script, String localDigest) {
        return !Objects.equals(script.getSourceDigest(), localDigest);
    }

    static DevelopmentSyncState resolveDevelopmentSyncState(ScriptDefinition script, String localDigest, ToolSourceState remoteState) {
        boolean localChanged = isLocalChanged(script, localDigest);
        boolean remoteChanged = isRemoteChanged(script, remoteState);
        if (localChanged && remoteChanged) {
            return DevelopmentSyncState.DIVERGED;
        }
        if (localChanged) {
            return DevelopmentSyncState.LOCAL_CHANGES;
        }
        if (remoteChanged) {
            return DevelopmentSyncState.REMOTE_CHANGES;
        }
        return DevelopmentSyncState.SYNCED;
    }

    static void ensureDevelopmentRepository(RepositoryDefinition repository) {
        if (!REPO_USAGE_DEVELOPMENT.equalsIgnoreCase(repository.getUsage())) {
            throw new IllegalArgumentException("仓库不是开发仓库: " + repository.getId());
        }
        if (REPO_TYPE_HTTP.equals(repository.getType())) {
            throw new IllegalArgumentException("HTTP 仓库不支持开发同步");
        }
    }

    static void ensureDevelopmentScript(ScriptDefinition script) {
        if (script.getScope() != ScriptScope.DEVELOPMENT) {
            throw new IllegalArgumentException("脚本不是开发仓库脚本: " + script.getId());
        }
        NormalizeUtils.normalize(script.getRepositoryId(), "开发脚本缺少来源仓库");
        NormalizeUtils.normalize(script.getRepositoryToolId(), "开发脚本缺少来源工具");
    }

    ScriptDefinition syncToolForDevelopment(String repositoryId, String toolId, DevelopmentSyncRequest request) {
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        ensureDevelopmentRepository(repository);
        RepositoryToolDetail detail = catalog.getRepositoryTool(repositoryId, toolId);
        String scriptId = NormalizeUtils.normalizeOrDefault(request == null ? null : request.scriptId(), detail.descriptor().toolId());
        ScriptDefinition existing = repos.scriptRepository().findById(scriptId).orElse(null);
        if (existing != null && existing.getScope() != ScriptScope.DEVELOPMENT) {
            throw new IllegalArgumentException("脚本 ID 已存在，请指定其他开发脚本 ID: " + scriptId);
        }
        if (existing != null) {
            return pullDevelopmentScript(scriptId, false);
        }
        ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        return saveDevelopmentScript(scriptId, existing, detail, state);
    }

    DevelopmentStatus getDevelopmentStatus(String scriptId) {
        ScriptDefinition script = services.scriptApplicationService().get(scriptId);
        ensureDevelopmentScript(script);
        RepositoryDefinition repository = catalog.getRepository(script.getRepositoryId());
        RepositoryToolDetail detail = catalog.getRepositoryTool(repository.getId(), script.getRepositoryToolId());
        ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        String localDigest = catalog.computeDevelopmentLocalDigest(script);
        DevelopmentSyncState syncState = resolveDevelopmentSyncState(script, localDigest, state);
        boolean remoteChanged = isRemoteChanged(script, state);
        boolean dirty = isLocalChanged(script, localDigest);
        String remoteVersion = detail.descriptor().version();
        return new DevelopmentStatus(
                script.getId(),
                script.getRepositoryId(),
                script.getRepositoryToolId(),
                script.getRepositoryVersion(),
                script.getSourceCommit(),
                state.commit(),
                script.getSourceDigest(),
                localDigest,
                state.digest(),
                dirty,
                remoteChanged,
                syncState.name(),
                remoteVersion,
                script.getSourceSyncedAt()
        );
    }

    ScriptDefinition pullDevelopmentScript(String scriptId, boolean force) {
        ScriptDefinition script = services.scriptApplicationService().get(scriptId);
        ensureDevelopmentScript(script);
        RepositoryDefinition repository = catalog.getRepository(script.getRepositoryId());
        catalog.syncRepository(repository.getId());
        RepositoryToolDetail detail = catalog.getRepositoryTool(repository.getId(), script.getRepositoryToolId());
        ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        String localDigest = catalog.computeDevelopmentLocalDigest(script);
        DevelopmentSyncState syncState = resolveDevelopmentSyncState(script, localDigest, state);
        if (syncState == DevelopmentSyncState.SYNCED) {
            return script;
        }
        if (syncState == DevelopmentSyncState.LOCAL_CHANGES && !force) {
            return script;
        }
        if (syncState == DevelopmentSyncState.DIVERGED && !force) {
            throw new DevelopmentConflictException(script.getId(), script.getRepositoryId(), script.getRepositoryToolId());
        }
        return saveDevelopmentScript(script.getId(), script, detail, state);
    }

    ScriptDefinition buildBaseScriptDefinition(String scriptId, RepositoryToolDetail detail, String repositoryId) {
        RepositoryCatalogTypes.RepositoryToolDescriptor d = detail.descriptor();
        ScriptPackaging packaging = ScriptPackaging.fromNullableName(d.packaging());
        Map<String, Object> inputSchema = catalog.readSchema(repositoryId, d.inputSchemaPath());
        Map<String, Object> outputSchema = catalog.readSchema(repositoryId, d.outputSchemaPath());
        ScriptDefinition definition = new ScriptDefinition()
                .setId(scriptId)
                .setName(d.displayName())
                .setType(ScriptType.valueOf(d.type()))
                .setPackaging(packaging)
                .setSource(detail.source())
                .setPythonRequirements(detail.pythonRequirements())
                .setInputSchema(inputSchema)
                .setOutputSchema(outputSchema)
                .setStatus(ScriptStatus.PUBLISHED)
                .setRepositoryId(repositoryId)
                .setRepositoryToolId(d.toolId())
                .setRepositoryVersion(d.version())
                .setOwner(d.owner())
                .setDescription(d.description())
                .setTags(d.tags())
                .setScriptDependencies(d.scriptDependencies())
                .setPluginDependencies(d.pluginDependencies());
        definition.setPublishedSnapshot(definition.snapshotCurrent());
        return definition;
    }

    static ScriptDefinition applyLifecycle(ScriptDefinition def, ScriptDefinition existing,
                                           ScriptScope scope, boolean editable, LocalDateTime now) {
        return def.setScope(scope)
                .setEditable(editable)
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now);
    }

    private ScriptDefinition saveDevelopmentScript(String scriptId,
                                                   ScriptDefinition existing,
                                                   RepositoryToolDetail detail,
                                                   ToolSourceState state) {
        ScriptDefinition def = buildDevelopmentScriptDefinition(scriptId, existing, detail, state);
        return repos.scriptRepository().save(def);
    }

    private ScriptDefinition buildDevelopmentScriptDefinition(String scriptId,
                                                               ScriptDefinition existing,
                                                               RepositoryToolDetail detail,
                                                               ToolSourceState state) {
        LocalDateTime now = LocalDateTime.now();
        return applyLifecycle(buildBaseScriptDefinition(scriptId, detail, detail.descriptor().repositoryId()),
                existing, ScriptScope.DEVELOPMENT, true, now)
                .setVersion(existing == null ? 1 : existing.getVersion())
                .setSourcePath(state.path())
                .setSourceCommit(state.commit())
                .setSourceDigest(state.digest())
                .setSourceSyncedAt(now)
                .setDirty(false);
    }
}
