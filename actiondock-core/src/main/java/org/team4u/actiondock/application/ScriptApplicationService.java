package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.ScriptStatus;
import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.List;
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

    public ScriptApplicationService(ScriptRepository scriptRepository,
                                    ScriptEngine scriptEngine,
                                    ScriptScheduleRepository scriptScheduleRepository) {
        this.scriptRepository = scriptRepository;
        this.scriptEngine = scriptEngine;
        this.scriptScheduleRepository = scriptScheduleRepository;
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
        LocalDateTime now = LocalDateTime.now();
        ScriptDefinition existing = definition.getId() == null ? null : scriptRepository.findById(definition.getId()).orElse(null);
        if (existing == null) {
            definition.setCreatedAt(now);
            if (definition.getVersion() == null) {
                definition.setVersion(1);
            }
            if (definition.getStatus() == null) {
                definition.setStatus(ScriptStatus.DRAFT);
            }
            if (definition.getPackaging() == null) {
                definition.setPackaging(ScriptPackaging.TOOL);
            }
            if (definition.getScope() == null) {
                definition.setScope(ScriptScope.PERSONAL);
            }
        } else {
            ensureEditable(existing);
            definition.setCreatedAt(existing.getCreatedAt());
            if (definition.getVersion() == null) {
                definition.setVersion(existing.getVersion());
            }
            if (definition.getOwner() == null) {
                definition.setOwner(existing.getOwner());
            }
            if (definition.getPackaging() == null) {
                definition.setPackaging(existing.getPackaging());
            }
            if (definition.getDescription() == null) {
                definition.setDescription(existing.getDescription());
            }
            if (definition.getStatus() == null) {
                definition.setStatus(existing.getStatus());
            }
            if (!definition.hasStoredPublishedSnapshot()) {
                definition.setPublishedSnapshot(existing.getPublishedSnapshot());
            }
            if (definition.getScope() == null) {
                definition.setScope(existing.getScope());
            }
            if (definition.getRepositoryId() == null) {
                definition.setRepositoryId(existing.getRepositoryId());
            }
            if (definition.getRepositoryToolId() == null) {
                definition.setRepositoryToolId(existing.getRepositoryToolId());
            }
            if (definition.getRepositoryVersion() == null) {
                definition.setRepositoryVersion(existing.getRepositoryVersion());
            }
            if (definition.getSourcePath() == null) {
                definition.setSourcePath(existing.getSourcePath());
            }
            if (definition.getSourceCommit() == null) {
                definition.setSourceCommit(existing.getSourceCommit());
            }
            if (definition.getSourceDigest() == null) {
                definition.setSourceDigest(existing.getSourceDigest());
            }
            if (definition.getSourceSyncedAt() == null) {
                definition.setSourceSyncedAt(existing.getSourceSyncedAt());
            }
            if (definition.getScope() == ScriptScope.DEVELOPMENT) {
                definition.setDirty(existing.isDirty() || !definition.snapshotCurrent().equals(existing.snapshotCurrent()));
            } else {
                definition.setDirty(existing.isDirty());
            }
            definition.setEditable(existing.isEditable());
        }
        normalizePublicationState(definition);
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
        return scriptRepository.findById(id).orElseThrow(() -> new IllegalArgumentException("脚本不存在: " + id));
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
        if (definition.getPublishedSnapshot() == null) {
            throw new IllegalArgumentException("脚本未发布: " + id);
        }
        return definition.toPublishedDefinition();
    }

    /**
     * 查询所有脚本定义。
     *
     * @return 脚本定义列表
     */
    private static final String MANAGED_INTERNAL_PREFIX = "pkg.";

    public List<ScriptDefinition> list() {
        return scriptRepository.findAll();
    }

    public List<ScriptDefinition> list(boolean includeManaged) {
        return list().stream()
                .filter(definition -> includeManaged || !definition.getId().startsWith(MANAGED_INTERNAL_PREFIX))
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
        definition.setPublishedSnapshot(definition.snapshotCurrent());
        definition.setStatus(ScriptStatus.PUBLISHED);
        definition.setVersion((definition.getVersion() == null ? 0 : definition.getVersion()) + 1);
        definition.setUpdatedAt(LocalDateTime.now());
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
        ScriptDefinition published = getPublished(id);
        published.setUpdatedAt(LocalDateTime.now());
        return scriptRepository.save(published);
    }

    public ScriptDefinition createFork(String id, String targetId, String targetName) {
        ScriptDefinition source = get(id);
        if (source.getScope() != ScriptScope.REPOSITORY) {
            throw new IllegalArgumentException("仅支持从仓库工具创建 Fork");
        }
        String normalizedId = ApplicationServiceSupport.normalize(targetId, "Fork 脚本 ID 不能为空");
        if (scriptRepository.findById(normalizedId).isPresent()) {
            throw new IllegalArgumentException("脚本已存在: " + normalizedId);
        }
        PublishedScriptSnapshot sourceSnapshot = source.getPublishedSnapshot();
        ScriptDefinition fork = sourceSnapshot == null ? copyCurrentDefinition(source) : source.toPublishedDefinition();
        fork.setId(normalizedId)
                .setName(ApplicationServiceSupport.normalize(targetName, "Fork 名称不能为空"))
                .setStatus(ScriptStatus.DRAFT)
                .setPublishedSnapshot(sourceSnapshot)
                .setVersion(1)
                .setScope(ScriptScope.FORK)
                .setRepositoryId(source.getRepositoryId())
                .setRepositoryToolId(source.getRepositoryToolId())
                .setRepositoryVersion(source.getRepositoryVersion())
                .setEditable(true)
                .setCreatedAt(null)
                .setUpdatedAt(null);
        ScriptDefinition saved = save(fork);
        copySchedulesToFork(source.getId(), saved.getId());
        return saved;
    }

    private ScriptDefinition copyCurrentDefinition(ScriptDefinition source) {
        return new ScriptDefinition()
                .setId(source.getId())
                .setName(source.getName())
                .setType(source.getType())
                .setPackaging(source.getPackaging())
                .setSource(source.getSource())
                .setInputSchema(source.getInputSchema())
                .setOutputSchema(source.getOutputSchema())
                .setStatus(source.getStatus())
                .setVersion(source.getVersion())
                .setPublishedSnapshot(source.getPublishedSnapshot())
                .setScope(source.getScope())
                .setRepositoryId(source.getRepositoryId())
                .setRepositoryToolId(source.getRepositoryToolId())
                .setRepositoryVersion(source.getRepositoryVersion())
                .setSourcePath(source.getSourcePath())
                .setSourceCommit(source.getSourceCommit())
                .setSourceDigest(source.getSourceDigest())
                .setSourceSyncedAt(source.getSourceSyncedAt())
                .setDirty(source.isDirty())
                .setEditable(source.isEditable())
                .setOwner(source.getOwner())
                .setDescription(source.getDescription())
                .setTags(source.getTags())
                .setScriptDependencies(source.getScriptDependencies())
                .setAiDependencies(source.getAiDependencies())
                .setCreatedAt(source.getCreatedAt())
                .setUpdatedAt(source.getUpdatedAt());
    }

    private void copySchedulesToFork(String sourceScriptId, String forkScriptId) {
        LocalDateTime now = LocalDateTime.now();
        for (ScriptSchedule sourceSchedule : scriptScheduleRepository.findByScriptId(sourceScriptId)) {
            scriptScheduleRepository.save(new ScriptSchedule()
                    .setId(UUID.randomUUID().toString())
                    .setScriptId(forkScriptId)
                    .setName(sourceSchedule.getName())
                    .setCronExpression(sourceSchedule.getCronExpression())
                    .setInput(sourceSchedule.getInput())
                    .setEnabled(false)
                    .setEditable(true)
                    .setRepositoryId(null)
                    .setRepositoryToolId(null)
                    .setRepositoryVersion(null)
                    .setLastTriggeredAt(null)
                    .setLastExecutionId(null)
                    .setCreatedAt(now)
                    .setUpdatedAt(now));
        }
    }

    private void normalizePublicationState(ScriptDefinition definition) {
        if (definition.hasStoredPublishedSnapshot()) {
            definition.setStatus(ScriptStatus.PUBLISHED);
            return;
        }
        if (definition.getStatus() == ScriptStatus.PUBLISHED) {
            definition.setPublishedSnapshot(definition.snapshotCurrent());
        }
    }

    private void ensureEditable(ScriptDefinition definition) {
        if (!definition.isEditable()) {
            throw new IllegalArgumentException("仓库工具为只读，请先 Fork");
        }
    }

}
