package org.team4u.scriptflow.application;

import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptStatus;
import org.team4u.scriptflow.domain.model.PublishedScriptSnapshot;
import org.team4u.scriptflow.domain.port.ScriptScheduleRepository;
import org.team4u.scriptflow.domain.port.ScriptEngine;
import org.team4u.scriptflow.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.List;

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
        } else {
            definition.setCreatedAt(existing.getCreatedAt());
            if (definition.getVersion() == null) {
                definition.setVersion(existing.getVersion());
            }
            if (definition.getStatus() == null) {
                definition.setStatus(existing.getStatus());
            }
            if (!definition.hasStoredPublishedSnapshot()) {
                definition.setPublishedSnapshot(existing.getPublishedSnapshot());
            }
        }
        normalizePublicationState(definition);
        definition.setUpdatedAt(now);
        return scriptRepository.save(definition);
    }

    public ScriptDefinition get(String id) {
        return scriptRepository.findById(id).orElseThrow(() -> new IllegalArgumentException("脚本不存在: " + id));
    }

    public ScriptDefinition getPublished(String id) {
        ScriptDefinition definition = get(id);
        if (definition.getPublishedSnapshot() == null) {
            throw new IllegalArgumentException("脚本未发布: " + id);
        }
        return definition.toPublishedDefinition();
    }

    public List<ScriptDefinition> list() {
        return scriptRepository.findAll();
    }

    public void delete(String id) {
        scriptScheduleRepository.deleteByScriptId(id);
        scriptRepository.deleteById(id);
    }

    public void validate(String id) {
        scriptEngine.validate(get(id));
    }

    public ScriptDefinition publish(String id) {
        ScriptDefinition definition = get(id);
        definition.setPublishedSnapshot(definition.snapshotCurrent());
        definition.setStatus(ScriptStatus.PUBLISHED);
        definition.setVersion((definition.getVersion() == null ? 0 : definition.getVersion()) + 1);
        definition.setUpdatedAt(LocalDateTime.now());
        return scriptRepository.save(definition);
    }

    public ScriptDefinition discardDraft(String id) {
        ScriptDefinition published = getPublished(id);
        published.setUpdatedAt(LocalDateTime.now());
        return scriptRepository.save(published);
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
}
