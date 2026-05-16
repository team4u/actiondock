package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.PublishedScriptRevision;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.port.RepositoryLocalAssetRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;


/**
 * 脚本应用服务，提供脚本定义的 CRUD 操作和发布管理。
 * <p>
 * 封装脚本创建、查询、更新、删除、发布、取消发布及脚本校验等业务逻辑，
 * 维护脚本的发布状态和版本号。
 *
 * @author jay.wu
 */
public class ScriptApplicationService {

    private final ScriptRepository scriptRepository;
    private final ScriptEngine scriptEngine;
    private final ScriptScheduleRepository scriptScheduleRepository;
    private final RepositoryLocalAssetRepository repositoryLocalAssetRepository;

    public ScriptApplicationService(ScriptRepository scriptRepository,
                                    ScriptEngine scriptEngine,
                                    ScriptScheduleRepository scriptScheduleRepository,
                                    RepositoryLocalAssetRepository repositoryLocalAssetRepository) {
        this.scriptRepository = scriptRepository;
        this.scriptEngine = scriptEngine;
        this.scriptScheduleRepository = scriptScheduleRepository;
        this.repositoryLocalAssetRepository = repositoryLocalAssetRepository;
    }

    /**
     * 保存脚本定义（新增或更新）。
     * <p>
     * 新增时自动设置创建时间、初始版本号和草稿状态；
     * 更新时保留原有的创建时间、版本号和状态，并在存在发布快照时保持发布状态。
     * 保存前会自动标准化发布状态。
     *
     * @param definition 脚本定义
     * @return 保存后的脚本定义
     */
    public ScriptDefinition save(ScriptDefinition definition) {
        PythonRequirementsSupport.validateScriptDefinition(definition);
        LocalDateTime now = LocalDateTime.now();
        ScriptDefinition existing = definition.getId() == null ? null : scriptRepository.findById(definition.getId()).orElse(null);
        if (existing == null) {
            definition.setCreatedAt(now);
            if (definition.getVersion() == null) {
                definition.setVersion(1);
            }
            if (definition.getPackaging() == null) {
                definition.setPackaging(ScriptPackaging.TOOL);
            }
            if (definition.getScope() == null) {
                definition.setScope(ScriptScope.PERSONAL);
            }
        } else {
            ensureEditable(existing);
            if (definition.getVersion() == null) {
                definition.setVersion(existing.getVersion());
            }
            definition.mergeFrom(existing);
        }
        definition.setUpdatedAt(now);
        return scriptRepository.save(definition);
    }

    /**
     * 根据 ID 查询脚本定义。
     *
     * @param id 脚本 ID
     * @return 脚本定义
     * @throws IllegalArgumentException 如果脚本不存在
     */
    public ScriptDefinition get(String id) {
        return scriptRepository.findById(id).orElseThrow(() -> ActionDockException.notFound(
                ActionDockErrorCodes.SCRIPT_NOT_FOUND,
                "脚本不存在: " + id,
                Map.of("scriptId", id)
        ));
    }

    /**
     * 获取指定脚本的已发布版本。
     * <p>
     * 基于脚本的发布快照构建已发布版本的脚本定义，用于实际执行。
     *
     * @param id 脚本 ID
     * @return 已发布的脚本定义
     * @throws IllegalArgumentException 如果脚本不存在或尚未发布
     */
    public ScriptDefinition getPublished(String id) {
        ScriptDefinition definition = get(id);
        if (!definition.hasPublishedRevision()) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.SCRIPT_NOT_PUBLISHED,
                    "脚本未发布: " + id,
                    Map.of("scriptId", id)
            );
        }
        return definition.toPublishedDefinition();
    }

    /**
     * 查询所有脚本定义。
     *
     * @return 脚本定义列表
     */
    public List<ScriptDefinition> list() {
        return scriptRepository.findAll();
    }

    public List<ScriptDefinition> list(boolean includeManaged) {
        return list().stream()
                .filter(definition -> includeManaged || !ScriptPackaging.isManagedId(definition.getId()))
                .toList();
    }

    /**
     * 删除脚本定义及其关联的调度配置。
     * <p>
     * 同时清除该脚本下所有定时调度配置，再删除脚本本身。
     *
     * @param id 脚本 ID
     */
    public void delete(String id) {
        ensureEditable(get(id));
        scriptScheduleRepository.deleteByScriptId(id);
        repositoryLocalAssetRepository.findByLocalAsset(UpstreamAssetType.SCRIPT, id)
                .map(RepositoryLocalAsset::getId)
                .ifPresent(repositoryLocalAssetRepository::deleteById);
        scriptRepository.deleteById(id);
    }

    /**
     * 校验脚本定义的合法性。
     * <p>
     * 委托脚本引擎对脚本内容进行语法和语义校验。
     *
     * @param id 脚本 ID
     * @throws IllegalArgumentException 如果脚本不存在或校验失败
     */
    public void validate(String id) {
        scriptEngine.validate(get(id));
    }

    /**
     * 发布脚本定义。
     * <p>
     * 将脚本状态设置为已发布，并基于当前内容创建发布快照。
     * 已发布的脚本将用于实际执行。每次发布自动递增版本号。
     *
     * @param id 要发布的脚本 ID
     * @return 发布后的脚本定义
     * @throws IllegalArgumentException 如果脚本不存在
     */
    public ScriptDefinition publish(String id) {
        ScriptDefinition definition = get(id);
        LocalDateTime now = LocalDateTime.now();
        String revisionId = UUID.randomUUID().toString();
        PublishedScriptRevision revision = PublishedScriptRevision.fromDraft(definition, revisionId, definition.getVersion() + 1, now);
        definition.setPublishedRevision(revision);
        definition.setVersion(revision.getVersion());
        definition.setUpdatedAt(now);
        definition.setDirty(false);
        return scriptRepository.save(definition);
    }

    /**
     * 丢弃草稿，恢复为已发布版本。
     * <p>
     * 将脚本内容恢复到上次发布时的快照状态，丢弃未发布的草稿修改。
     *
     * @param id 脚本 ID
     * @return 恢复后的脚本定义
     * @throws IllegalArgumentException 如果脚本不存在或尚未发布
     */
    public ScriptDefinition discardDraft(String id) {
        ScriptDefinition definition = get(id);
        if (!definition.hasPublishedRevision()) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.SCRIPT_NOT_PUBLISHED,
                    "脚本未发布: " + id,
                    Map.of("scriptId", id)
            );
        }
        definition.revertToPublished();
        definition.setUpdatedAt(LocalDateTime.now());
        return scriptRepository.save(definition);
    }

    public ScriptDefinition createFork(String id, String targetId, String targetName) {
        ScriptDefinition source = get(id);
        if (source.getScope() != ScriptScope.REPOSITORY) {
            throw new IllegalArgumentException("仅支持从仓库工具创建 Fork");
        }
        String normalizedId = ApplicationServiceSupport.normalize(targetId, "Fork 脚本 ID 不能为空");
        if (scriptRepository.findById(normalizedId).isPresent()) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.SCRIPT_EXISTS,
                    "脚本已存在: " + normalizedId,
                    Map.of("scriptId", normalizedId)
            );
        }
        ScriptDefinition fork = source.hasPublishedRevision() ? source.toPublishedDefinition() : source.fullCopy();
        fork.setId(normalizedId)
                .setName(ApplicationServiceSupport.normalize(targetName, "Fork 名称不能为空"))
                .setVersion(1)
                .setScope(ScriptScope.PERSONAL)
                .setRepositoryId(source.getRepositoryId())
                .setRepositoryScriptId(source.getRepositoryScriptId())
                .setRepositoryVersion(source.getRepositoryVersion())
                .setEditable(true)
                .setCreatedAt(null)
                .setUpdatedAt(null);
        if (source.hasPublishedRevision()) {
            PublishedScriptRevision sourceRevision = source.getPublishedRevision();
            String forkRevisionId = UUID.randomUUID().toString();
            fork.setPublishedRevision(new PublishedScriptRevision()
                    .setId(forkRevisionId)
                    .setScriptId(normalizedId)
                    .setVersion(1)
                    .setPublishedAt(LocalDateTime.now())
                    .setName(sourceRevision.getName())
                    .setType(sourceRevision.getType())
                    .setPackaging(sourceRevision.getPackaging())
                    .setSource(sourceRevision.getSource())
                    .setPythonRequirements(sourceRevision.getPythonRequirements())
                    .setInputSchema(sourceRevision.getInputSchema())
                    .setOutputSchema(sourceRevision.getOutputSchema())
                    .setOwner(sourceRevision.getOwner())
                    .setDescription(sourceRevision.getDescription())
                    .setTags(sourceRevision.getTags())
                    .setScriptDependencies(sourceRevision.getScriptDependencies())
                    .setPluginDependencies(sourceRevision.getPluginDependencies())
                    .setAiDependencies(sourceRevision.getAiDependencies()));
        } else {
            fork.setPublishedRevisionId(null)
                    .setPublishedAt(null)
                    .setPublishedRevision(null);
        }
        ScriptDefinition saved = save(fork);
        copySchedulesToFork(source.getId(), saved.getId());
        return saved;
    }

    private void copySchedulesToFork(String sourceScriptId, String forkScriptId) {
        LocalDateTime now = LocalDateTime.now();
        for (ScriptSchedule sourceSchedule : scriptScheduleRepository.findByScriptId(sourceScriptId)) {
            scriptScheduleRepository.save(sourceSchedule.copy()
                    .setId(UUID.randomUUID().toString())
                    .setScriptId(forkScriptId)
                    .setEnabled(false)
                    .setEditable(true)
                    .setRepositoryId(null)
                    .setRepositoryScriptId(null)
                    .setRepositoryVersion(null)
                    .setLastTriggeredAt(null)
                    .setLastExecutionId(null)
                    .setCreatedAt(now)
                    .setUpdatedAt(now));
        }
    }

    private static void ensureEditable(ScriptDefinition definition) {
        if (!definition.isEditable()) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.SCRIPT_NOT_EDITABLE,
                    "仓库工具为只读，请先 Fork",
                    Map.of("scriptId", definition.getId())
            );
        }
    }

}
