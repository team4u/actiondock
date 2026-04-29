package org.team4u.actiondock.ai.core;

import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiToolRegistry;
import org.team4u.actiondock.ai.api.AiToolset;
import org.team4u.actiondock.ai.api.AiToolsetRepository;

import java.time.LocalDateTime;
import java.util.List;

public class AiToolsetService {
    private static final String MANAGED_INTERNAL_PREFIX = "pkg.";

    private final AiToolsetRepository repository;
    private final AiAgentProfileRepository agentProfileRepository;
    private final AiToolRegistry toolRegistry;

    public AiToolsetService(AiToolsetRepository repository) {
        this(repository, null, null);
    }

    public AiToolsetService(AiToolsetRepository repository, AiAgentProfileRepository agentProfileRepository) {
        this(repository, agentProfileRepository, null);
    }

    public AiToolsetService(AiToolsetRepository repository,
                            AiAgentProfileRepository agentProfileRepository,
                            AiToolRegistry toolRegistry) {
        this.repository = repository;
        this.agentProfileRepository = agentProfileRepository;
        this.toolRegistry = toolRegistry;
    }

    public List<AiToolset> list() {
        return repository.findAll();
    }

    public List<AiToolset> list(boolean includeManaged) {
        return list().stream()
                .filter(toolset -> includeManaged || !toolset.getId().startsWith(MANAGED_INTERNAL_PREFIX))
                .toList();
    }

    public AiToolset get(String id) {
        return repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("AI 工具集不存在: " + id));
    }

    public AiToolset save(AiToolset toolset) {
        validate(toolset);
        assertMutable(toolset.getId());
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
        assertMutable(id);
        if (agentProfileRepository != null) {
            agentProfileRepository.findAll().stream()
                    .filter(agent -> agent.getToolsetIds().contains(id))
                    .findFirst()
                    .ifPresent(agent -> {
                        throw new IllegalArgumentException("AI 工具集已被 Agent 引用，不能删除: " + agent.getId());
                    });
        }
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
        if (toolRegistry != null) {
            for (String toolName : toolset.getToolNames()) {
                if (toolName == null || toolName.isBlank()) {
                    throw new IllegalArgumentException("AI 工具名不能为空");
                }
                toolRegistry.getTool(toolName);
            }
        }
    }

    private void assertMutable(String id) {
        if (id != null && id.startsWith(MANAGED_INTERNAL_PREFIX)) {
            throw new IllegalArgumentException("AI 能力包托管工具集不允许直接修改: " + id);
        }
    }
}
