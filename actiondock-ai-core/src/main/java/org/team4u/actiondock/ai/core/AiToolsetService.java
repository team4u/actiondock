package org.team4u.actiondock.ai.core;

import org.team4u.actiondock.ai.api.AiToolset;
import org.team4u.actiondock.ai.api.AiToolsetRepository;

import java.time.LocalDateTime;
import java.util.List;

public class AiToolsetService {
    private final AiToolsetRepository repository;

    public AiToolsetService(AiToolsetRepository repository) {
        this.repository = repository;
    }

    public List<AiToolset> list() {
        return repository.findAll();
    }

    public AiToolset get(String id) {
        return repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("AI 工具集不存在: " + id));
    }

    public AiToolset save(AiToolset toolset) {
        validate(toolset);
        LocalDateTime now = LocalDateTime.now();
        AiToolset existing = repository.findById(toolset.getId()).orElse(null);
        if (existing == null) {
            toolset.setCreatedAt(now);
        } else if (toolset.getCreatedAt() == null) {
            toolset.setCreatedAt(existing.getCreatedAt());
        }
        toolset.setUpdatedAt(now);
        return repository.save(toolset);
    }

    public void delete(String id) {
        repository.deleteById(id);
    }

    private void validate(AiToolset toolset) {
        if (toolset == null) {
            throw new IllegalArgumentException("AI 工具集不能为空");
        }
        if (toolset.getId() == null || toolset.getId().isBlank()) {
            throw new IllegalArgumentException("AI 工具集 ID 不能为空");
        }
        if (toolset.getName() == null || toolset.getName().isBlank()) {
            throw new IllegalArgumentException("AI 工具集名称不能为空");
        }
    }
}
