package org.team4u.actiondock.ai.core;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiTool;
import org.team4u.actiondock.ai.api.AiToolRegistry;
import org.team4u.actiondock.ai.api.AiToolset;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.domain.exception.ActionDockException;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * AiToolsetService 的单元测试。
 *
 * @author jay.wu
 */
class AiToolsetServiceTest {

    private AiToolsetRepository repository;
    private AiAgentProfileRepository agentProfileRepository;
    private AiToolRegistry toolRegistry;
    private AiToolsetService service;

    @BeforeEach
    void setUp() {
        repository = Mockito.mock(AiToolsetRepository.class);
        agentProfileRepository = Mockito.mock(AiAgentProfileRepository.class);
        toolRegistry = Mockito.mock(AiToolRegistry.class);
        service = new AiToolsetService(repository, agentProfileRepository, toolRegistry);
    }

    // ==================== list() ====================

    /**
     * 列出所有工具集时，应返回仓储中的全部记录。
     */
    @Test
    void listShouldReturnAllToolsets() {
        AiToolset toolset1 = new AiToolset().setId("ts-1").setName("工具集1");
        AiToolset toolset2 = new AiToolset().setId("ts-2").setName("工具集2");
        when(repository.findAll()).thenReturn(List.of(toolset1, toolset2));

        List<AiToolset> result = service.list();

        assertThat(result).hasSize(2);
        assertThat(result).extracting(AiToolset::getId).containsExactly("ts-1", "ts-2");
    }

    /**
     * 仓储为空时，列出工具集应返回空列表。
     */
    @Test
    void listShouldReturnEmptyWhenNoToolsets() {
        when(repository.findAll()).thenReturn(Collections.emptyList());

        List<AiToolset> result = service.list();

        assertThat(result).isEmpty();
    }

    // ==================== list(boolean includeManaged) ====================

    /**
     * 不包含托管资源时，应过滤掉以 pkg. 和 cap. 为前缀的工具集。
     */
    @Test
    void listShouldExcludeManagedWhenIncludeManagedIsFalse() {
        AiToolset managed1 = new AiToolset().setId("pkg.internal").setName("托管内部");
        AiToolset managed2 = new AiToolset().setId("cap.entry").setName("托管入口");
        AiToolset custom = new AiToolset().setId("my-toolset").setName("自定义");
        when(repository.findAll()).thenReturn(List.of(managed1, managed2, custom));

        List<AiToolset> result = service.list(false);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getId()).isEqualTo("my-toolset");
    }

    /**
     * 包含托管资源时，应返回全部工具集。
     */
    @Test
    void listShouldIncludeManagedWhenIncludeManagedIsTrue() {
        AiToolset managed = new AiToolset().setId("pkg.internal").setName("托管内部");
        AiToolset custom = new AiToolset().setId("my-toolset").setName("自定义");
        when(repository.findAll()).thenReturn(List.of(managed, custom));

        List<AiToolset> result = service.list(true);

        assertThat(result).hasSize(2);
    }

    // ==================== get() ====================

    /**
     * 根据存在的 ID 查询工具集时，应返回对应工具集。
     */
    @Test
    void getShouldReturnToolsetWhenIdExists() {
        AiToolset toolset = new AiToolset().setId("ts-1").setName("工具集1");
        when(repository.findById("ts-1")).thenReturn(Optional.of(toolset));

        AiToolset result = service.get("ts-1");

        assertThat(result.getId()).isEqualTo("ts-1");
        assertThat(result.getName()).isEqualTo("工具集1");
    }

    /**
     * 根据不存在的 ID 查询工具集时，应抛出 ActionDockException 异常。
     */
    @Test
    void getShouldThrowWhenIdNotFound() {
        when(repository.findById("nonexistent")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.get("nonexistent"))
                .isInstanceOf(ActionDockException.class)
                .hasMessageContaining("AI 工具集不存在: nonexistent");
    }

    // ==================== save() ====================

    /**
     * 保存新的工具集时，应设置创建时间和更新时间。
     */
    @Test
    void saveShouldSetTimestampsForNewToolset() {
        AiToolset toolset = new AiToolset()
                .setId("ts-new")
                .setName("新工具集")
                .setToolNames(List.of("tool-a"));
        when(repository.findById("ts-new")).thenReturn(Optional.empty());
        when(repository.save(Mockito.any(AiToolset.class))).thenAnswer(inv -> inv.getArgument(0));
        when(toolRegistry.getTool("tool-a")).thenReturn(Mockito.mock(AiTool.class));

        AiToolset result = service.save(toolset);

        assertThat(result.getCreatedAt()).isNotNull();
        assertThat(result.getUpdatedAt()).isNotNull();
        verify(repository).save(toolset);
    }

    /**
     * 保存已存在的工具集时，应保留原有创建时间并更新更新时间。
     */
    @Test
    void saveShouldPreserveCreatedAtForExistingToolset() {
        LocalDateTime originalCreatedAt = LocalDateTime.of(2025, 1, 1, 0, 0);
        AiToolset existing = new AiToolset()
                .setId("ts-existing")
                .setName("已存在")
                .setCreatedAt(originalCreatedAt);
        AiToolset updated = new AiToolset()
                .setId("ts-existing")
                .setName("已存在-更新")
                .setToolNames(List.of("tool-a"));

        when(repository.findById("ts-existing")).thenReturn(Optional.of(existing));
        when(repository.save(Mockito.any(AiToolset.class))).thenAnswer(inv -> inv.getArgument(0));
        when(toolRegistry.getTool("tool-a")).thenReturn(Mockito.mock(AiTool.class));

        AiToolset result = service.save(updated);

        assertThat(result.getCreatedAt()).isEqualTo(originalCreatedAt);
        assertThat(result.getUpdatedAt()).isNotNull();
    }

    /**
     * 保存时工具集为 null，应抛出 IllegalArgumentException。
     */
    @Test
    void saveShouldThrowWhenToolsetIsNull() {
        assertThatThrownBy(() -> service.save(null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 工具集不能为空");
    }

    /**
     * 保存时工具集 ID 为空，应抛出 IllegalArgumentException。
     */
    @Test
    void saveShouldThrowWhenIdIsBlank() {
        AiToolset toolset = new AiToolset().setId("").setName("有名字");

        assertThatThrownBy(() -> service.save(toolset))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 工具集 ID 不能为空");
    }

    /**
     * 保存时工具集 ID 为 null，应抛出 IllegalArgumentException。
     */
    @Test
    void saveShouldThrowWhenIdIsNull() {
        AiToolset toolset = new AiToolset().setId(null).setName("有名字");

        assertThatThrownBy(() -> service.save(toolset))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 工具集 ID 不能为空");
    }

    /**
     * 保存时工具集名称为空，应抛出 IllegalArgumentException。
     */
    @Test
    void saveShouldThrowWhenNameIsBlank() {
        AiToolset toolset = new AiToolset().setId("ts-1").setName("");

        assertThatThrownBy(() -> service.save(toolset))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 工具集名称不能为空");
    }

    /**
     * 保存时工具集名称为 null，应抛出 IllegalArgumentException。
     */
    @Test
    void saveShouldThrowWhenNameIsNull() {
        AiToolset toolset = new AiToolset().setId("ts-1").setName(null);

        assertThatThrownBy(() -> service.save(toolset))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 工具集名称不能为空");
    }

    /**
     * 保存托管前缀（pkg.）开头的工具集时，应抛出 IllegalArgumentException。
     */
    @Test
    void saveShouldThrowWhenToolsetIdIsManagedInternal() {
        AiToolset toolset = new AiToolset().setId("pkg.my-toolset").setName("托管");

        assertThatThrownBy(() -> service.save(toolset))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("托管工具集不允许直接修改");
    }

    /**
     * 保存托管前缀（cap.）开头的工具集时，应抛出 IllegalArgumentException。
     */
    @Test
    void saveShouldThrowWhenToolsetIdIsManagedEntry() {
        AiToolset toolset = new AiToolset().setId("cap.my-toolset").setName("托管入口");

        assertThatThrownBy(() -> service.save(toolset))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("托管工具集不允许直接修改");
    }

    /**
     * 保存时工具名列表中包含空字符串，应抛出 IllegalArgumentException。
     */
    @Test
    void saveShouldThrowWhenToolNameIsBlank() {
        AiToolset toolset = new AiToolset()
                .setId("ts-1")
                .setName("工具集")
                .setToolNames(List.of(""));

        assertThatThrownBy(() -> service.save(toolset))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 工具名不能为空");
    }

    /**
     * 保存时工具名不存在于注册表中，getTool 返回 null 不应抛异常（直接通过）。
     */
    @Test
    void saveShouldPassWhenToolRegistryReturnsNull() {
        AiToolset toolset = new AiToolset()
                .setId("ts-1")
                .setName("工具集")
                .setToolNames(List.of("unknown-tool"));
        when(repository.findById("ts-1")).thenReturn(Optional.empty());
        when(repository.save(Mockito.any(AiToolset.class))).thenAnswer(inv -> inv.getArgument(0));
        when(toolRegistry.getTool("unknown-tool")).thenReturn(null);

        AiToolset result = service.save(toolset);

        assertThat(result).isNotNull();
        verify(toolRegistry).getTool("unknown-tool");
    }

    /**
     * 使用只有 repository 的构造函数时，验证不执行工具名校验。
     */
    @Test
    void saveShouldSkipToolValidationWhenToolRegistryIsNull() {
        AiToolsetService serviceWithoutRegistry = new AiToolsetService(repository);
        AiToolset toolset = new AiToolset()
                .setId("ts-1")
                .setName("工具集")
                .setToolNames(List.of("any-tool"));
        when(repository.findById("ts-1")).thenReturn(Optional.empty());
        when(repository.save(Mockito.any(AiToolset.class))).thenAnswer(inv -> inv.getArgument(0));

        AiToolset result = serviceWithoutRegistry.save(toolset);

        assertThat(result).isNotNull();
    }

    // ==================== delete() ====================

    /**
     * 删除未被引用的工具集时，应正常删除。
     */
    @Test
    void deleteShouldRemoveToolsetWhenNotReferencedByAgent() {
        when(agentProfileRepository.findAll()).thenReturn(Collections.emptyList());

        service.delete("ts-1");

        verify(repository).deleteById("ts-1");
    }

    /**
     * 删除被 Agent 引用的工具集时，应抛出 IllegalArgumentException。
     */
    @Test
    void deleteShouldThrowWhenToolsetReferencedByAgent() {
        AiAgentProfile agent = new AiAgentProfile()
                .setId("agent-1")
                .setToolsetIds(List.of("ts-1"));
        when(agentProfileRepository.findAll()).thenReturn(List.of(agent));

        assertThatThrownBy(() -> service.delete("ts-1"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("AI 工具集已被 Agent 引用，不能删除: agent-1");
    }

    /**
     * 删除未被任何 Agent 的 toolsetIds 包含的工具集时，应正常删除。
     */
    @Test
    void deleteShouldSucceedWhenAgentReferencesOtherToolsets() {
        AiAgentProfile agent = new AiAgentProfile()
                .setId("agent-1")
                .setToolsetIds(List.of("ts-other"));
        when(agentProfileRepository.findAll()).thenReturn(List.of(agent));

        service.delete("ts-1");

        verify(repository).deleteById("ts-1");
    }

    /**
     * 删除托管前缀（pkg.）开头的工具集时，应抛出 IllegalArgumentException。
     */
    @Test
    void deleteShouldThrowWhenToolsetIdIsManaged() {
        assertThatThrownBy(() -> service.delete("pkg.managed-toolset"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("托管工具集不允许直接修改");
    }

    /**
     * 删除托管前缀（cap.）开头的工具集时，应抛出 IllegalArgumentException。
     */
    @Test
    void deleteShouldThrowWhenToolsetIdIsManagedEntry() {
        assertThatThrownBy(() -> service.delete("cap.managed-entry"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("托管工具集不允许直接修改");
    }

    /**
     * 使用只有 repository 的构造函数时，删除应跳过 Agent 引用检查。
     */
    @Test
    void deleteShouldSkipAgentReferenceCheckWhenAgentProfileRepositoryIsNull() {
        AiToolsetService serviceWithoutAgent = new AiToolsetService(repository);

        serviceWithoutAgent.delete("ts-1");

        verify(repository).deleteById("ts-1");
    }

    /**
     * 使用 repository 和 agentProfileRepository 的构造函数时，删除应执行 Agent 引用检查。
     */
    @Test
    void deleteShouldCheckAgentReferenceWhenAgentProfileRepositoryIsSet() {
        AiToolsetService serviceWithAgent = new AiToolsetService(repository, agentProfileRepository);
        when(agentProfileRepository.findAll()).thenReturn(Collections.emptyList());

        serviceWithAgent.delete("ts-1");

        verify(agentProfileRepository).findAll();
        verify(repository).deleteById("ts-1");
    }
}
