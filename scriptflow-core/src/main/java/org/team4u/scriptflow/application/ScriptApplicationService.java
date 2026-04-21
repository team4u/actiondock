package org.team4u.scriptflow.application;

import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptStatus;
import org.team4u.scriptflow.domain.port.ScriptEngine;
import org.team4u.scriptflow.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.List;

public class ScriptApplicationService {
    private final ScriptRepository scriptRepository;
    private final ScriptEngine scriptEngine;

    public ScriptApplicationService(ScriptRepository scriptRepository, ScriptEngine scriptEngine) {
        this.scriptRepository = scriptRepository;
        this.scriptEngine = scriptEngine;
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
        }
        definition.setUpdatedAt(now);
        return scriptRepository.save(definition);
    }

    public ScriptDefinition get(String id) {
        return scriptRepository.findById(id).orElseThrow(() -> new IllegalArgumentException("Script not found: " + id));
    }

    public List<ScriptDefinition> list() {
        return scriptRepository.findAll();
    }

    public void delete(String id) {
        scriptRepository.deleteById(id);
    }

    public void validate(String id) {
        scriptEngine.validate(get(id));
    }

    public ScriptDefinition publish(String id) {
        ScriptDefinition definition = get(id);
        definition.setStatus(ScriptStatus.PUBLISHED);
        definition.setVersion((definition.getVersion() == null ? 0 : definition.getVersion()) + 1);
        definition.setUpdatedAt(LocalDateTime.now());
        return scriptRepository.save(definition);
    }
}
