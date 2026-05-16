package org.team4u.actiondock.ai.core;

import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiToolRegistry;
import org.team4u.actiondock.ai.api.AiToolset;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import org.team4u.actiondock.domain.model.ScriptPackaging;


public class AiToolsetService {

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
                .filter(toolset -> includeManaged || !ScriptPackaging.isManagedId(toolset.getId()))
                .toList();
    }

    public AiToolset get(String id) {
        return repository.findById(id)
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.AI_TOOLSET_NOT_FOUND,
                        "AI 工具集不存在: " + id,
                        Map.of("toolsetId", id)
                ));
    }

    public AiToolset save(AiToolset toolset) {
        validate(toolset);
        assertMutable(toolset.getId());
        return AiTimestampSupport.saveWithTimestamps(toolset, toolset.getId(),
                repository::findById, AiToolset::getCreatedAt,
                AiToolset::setCreatedAt, AiToolset::setUpdatedAt, repository::save);
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

    private static void assertMutable(String id) {
        ScriptPackaging.assertMutable(id, "工具集");
    }
}
