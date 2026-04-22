package org.team4u.scriptflow.application;

import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptStatus;
import org.team4u.scriptflow.domain.model.PublishedScriptSnapshot;
import org.team4u.scriptflow.domain.port.ScriptScheduleRepository;
import org.team4u.scriptflow.domain.port.ScriptEngine;
import org.team4u.scriptflow.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.List;

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
        return scriptRepository.findById(id).orElseThrow(() -> new IllegalArgumentException("Script not found: " + id));
    }

    public ScriptDefinition getPublished(String id) {
        ScriptDefinition definition = get(id);
        if (definition.getPublishedSnapshot() == null) {
            throw new IllegalArgumentException("Script not published: " + id);
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
