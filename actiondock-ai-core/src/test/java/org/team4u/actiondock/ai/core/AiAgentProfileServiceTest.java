package org.team4u.actiondock.ai.core;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiAgentSkill;
import org.team4u.actiondock.ai.api.AiAgentSkillRegistry;
import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiToolset;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.domain.exception.ActionDockException;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * AiAgentProfileService 的单元测试。
 *
 * @author jay.wu
 */
class AiAgentProfileServiceTest {

    private AiAgentProfileRepository repository;
    private AiModelProfileRepository modelProfileRepository;
    private AiToolsetRepository toolsetRepository;
    private AiAgentSkillRegistry skillRegistry;
    private AiAgentProfileService service;

    @BeforeEach
    void setUp() {
        repository = mock(AiAgentProfileRepository.class);
        modelProfileRepository = mock(AiModelProfileRepository.class);
        toolsetRepository = mock(AiToolsetRepository.class);
        skillRegistry = mock(AiAgentSkillRegistry.class);
        // 默认不带 toolRegistry 和 skillRegistry 的实例
        service = new AiAgentProfileService(repository, modelProfileRepository,
                toolsetRepository, null, skillRegistry);
    }

    // ==================== list() ====================

    /**
     * 查询全部 Agent Profile 列表。
     */
    @Test
    void shouldReturnAllProfilesWhenList() {
        AiAgentProfile profile1 = buildValidProfile("agent-1", "Agent 1");
        AiAgentProfile profile2 = buildValidProfile("agent-2", "Agent 2");
        when(repository.findAll()).thenReturn(List.of(profile1, profile2));

        List<AiAgentProfile> result = service.list();

        assertThat(result).hasSize(2)
                .extracting(AiAgentProfile::getId)
                .containsExactly("agent-1", "agent-2");
    }

    // ==================== list(boolean) ====================

    /**
     * 过滤托管 Agent Profile，仅返回非托管记录。
     */
    @Test
    void shouldExcludeManagedProfilesWhenIncludeManagedIsFalse() {
        AiAgentProfile managed = buildValidProfile("pkg.internal-agent", "托管 Agent");
        AiAgentProfile managedEntry = buildValidProfile("cap.entry-agent", "托管入口");
        AiAgentProfile custom = buildValidProfile("my-agent", "自定义 Agent");
        when(repository.findAll()).thenReturn(List.of(managed, managedEntry, custom));

        List<AiAgentProfile> result = service.list(false);

        assertThat(result).hasSize(1)
                .extracting(AiAgentProfile::getId)
                .containsExactly("my-agent");
    }

    /**
     * 包含托管 Agent Profile 时返回全部记录。
     */
    @Test
    void shouldReturnAllProfilesWhenIncludeManagedIsTrue() {
        AiAgentProfile managed = buildValidProfile("pkg.internal-agent", "托管 Agent");
        AiAgentProfile custom = buildValidProfile("my-agent", "自定义 Agent");
        when(repository.findAll()).thenReturn(List.of(managed, custom));

        List<AiAgentProfile> result = service.list(true);

        assertThat(result).hasSize(2);
    }

    /**
     * 空列表时返回空结果。
     */
    @Test
    void shouldReturnEmptyListWhenNoProfiles() {
        when(repository.findAll()).thenReturn(List.of());

        List<AiAgentProfile> result = service.list();

        assertThat(result).isEmpty();
    }

    // ==================== get() ====================

    /**
     * 根据ID成功获取Agent Profile。
     */
    @Test
    void shouldReturnProfileWhenGetById() {
        AiAgentProfile profile = buildValidProfile("agent-1", "Agent 1");
        when(repository.findById("agent-1")).thenReturn(Optional.of(profile));

        AiAgentProfile result = service.get("agent-1");

        assertThat(result).isNotNull();
        assertThat(result.getId()).isEqualTo("agent-1");
    }

    /**
     * 获取不存在的Agent Profile时抛出异常。
     */
    @Test
    void shouldThrowWhenGetNonExistentProfile() {
        when(repository.findById("non-existent")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.get("non-existent"))
                .isInstanceOf(ActionDockException.class)
                .hasMessageContaining("AI Agent Profile 不存在: non-existent");
    }

    // ==================== save() - 成功路径 ====================

    /**
     * 保存新的Agent Profile，自动填充创建时间和更新时间。
     */
    @Test
    void shouldSaveNewProfileWithTimestamps() {
        AiAgentProfile profile = buildValidProfile("agent-new", "New Agent");
        when(modelProfileRepository.findById("model-1"))
                .thenReturn(Optional.of(new AiModelProfile()));
        when(repository.findById("agent-new")).thenReturn(Optional.empty());
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        AiAgentProfile result = service.save(profile);

        assertThat(result).isNotNull();
        assertThat(result.getCreatedAt()).isNotNull();
        assertThat(result.getUpdatedAt()).isNotNull();
        verify(repository).save(profile);
    }

    /**
     * 更新已有的Agent Profile，保留原始创建时间并更新更新时间。
     */
    @Test
    void shouldUpdateExistingProfilePreservingCreatedAt() {
        LocalDateTime originalCreatedAt = LocalDateTime.now().minusDays(1);
        AiAgentProfile existing = buildValidProfile("agent-1", "Agent 1");
        existing.setCreatedAt(originalCreatedAt);

        AiAgentProfile updated = buildValidProfile("agent-1", "Agent Updated");
        when(modelProfileRepository.findById("model-1"))
                .thenReturn(Optional.of(new AiModelProfile()));
        when(repository.findById("agent-1")).thenReturn(Optional.of(existing));
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        AiAgentProfile result = service.save(updated);

        assertThat(result.getCreatedAt()).isEqualTo(originalCreatedAt);
        assertThat(result.getUpdatedAt()).isNotNull();
    }

    // ==================== save() - 校验失败路径 ====================

    /**
     * 保存空Agent Profile时抛出异常。
     */
    @Test
    void shouldThrowWhenSaveNullProfile() {
        assertThatThrownBy(() -> service.save(null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI Agent Profile 不能为空");
    }

    /**
     * 保存ID为空的Agent Profile时抛出异常。
     */
    @Test
    void shouldThrowWhenSaveProfileWithBlankId() {
        AiAgentProfile profile = buildValidProfile("", "Agent");

        assertThatThrownBy(() -> service.save(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI Agent Profile ID 不能为空");
    }

    /**
     * 保存ID为null的Agent Profile时抛出异常。
     */
    @Test
    void shouldThrowWhenSaveProfileWithNullId() {
        AiAgentProfile profile = new AiAgentProfile();
        profile.setName("Agent");

        assertThatThrownBy(() -> service.save(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI Agent Profile ID 不能为空");
    }

    /**
     * 保存名称为空的Agent Profile时抛出异常。
     */
    @Test
    void shouldThrowWhenSaveProfileWithBlankName() {
        AiAgentProfile profile = new AiAgentProfile();
        profile.setId("agent-1");

        assertThatThrownBy(() -> service.save(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI Agent Profile 名称不能为空");
    }

    /**
     * 保存模型Profile引用为空的Agent Profile时抛出异常。
     */
    @Test
    void shouldThrowWhenSaveProfileWithBlankModelProfileId() {
        AiAgentProfile profile = new AiAgentProfile();
        profile.setId("agent-1");
        profile.setName("Agent");

        assertThatThrownBy(() -> service.save(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("模型 Profile 不能为空");
    }

    /**
     * 保存引用不存在的模型Profile时抛出异常。
     */
    @Test
    void shouldThrowWhenSaveProfileWithNonExistentModelProfile() {
        AiAgentProfile profile = buildValidProfile("agent-1", "Agent");
        when(modelProfileRepository.findById("model-1")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.save(profile))
                .isInstanceOf(ActionDockException.class)
                .hasMessageContaining("模型 Profile 不存在: model-1");
    }

    /**
     * 保存托管ID的Agent Profile时抛出异常（pkg.前缀）。
     */
    @Test
    void shouldThrowWhenSaveManagedProfileWithInternalPrefix() {
        AiAgentProfile profile = buildValidProfile("pkg.agent", "托管Agent");
        when(modelProfileRepository.findById("model-1"))
                .thenReturn(Optional.of(new AiModelProfile()));

        assertThatThrownBy(() -> service.save(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("AI 能力包托管Agent不允许直接修改: pkg.agent");
    }

    /**
     * 保存托管ID的Agent Profile时抛出异常（cap.前缀）。
     */
    @Test
    void shouldThrowWhenSaveManagedProfileWithEntryPrefix() {
        AiAgentProfile profile = buildValidProfile("cap.agent", "托管入口");
        when(modelProfileRepository.findById("model-1"))
                .thenReturn(Optional.of(new AiModelProfile()));

        assertThatThrownBy(() -> service.save(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("AI 能力包托管Agent不允许直接修改: cap.agent");
    }

    // ==================== save() - toolsetRepository 路径 ====================

    /**
     * 当 toolRegistry 为空但 toolsetRepository 不为空时，校验工具集引用有效性。
     */
    @Test
    void shouldValidateToolsetIdsWhenToolRegistryIsNull() {
        AiAgentProfile profile = buildValidProfile("agent-1", "Agent 1");
        profile.setToolsetIds(List.of("toolset-1"));
        when(modelProfileRepository.findById("model-1"))
                .thenReturn(Optional.of(new AiModelProfile()));
        when(toolsetRepository.findById("toolset-1"))
                .thenReturn(Optional.of(mock(AiToolset.class)));
        when(repository.findById("agent-1")).thenReturn(Optional.empty());
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        AiAgentProfile result = service.save(profile);

        assertThat(result).isNotNull();
    }

    /**
     * 当 toolRegistry 为空且引用不存在的工具集时抛出异常。
     */
    @Test
    void shouldThrowWhenToolsetNotFoundAndNoToolRegistry() {
        AiAgentProfile profile = buildValidProfile("agent-1", "Agent 1");
        profile.setToolsetIds(List.of("non-existent-toolset"));
        when(modelProfileRepository.findById("model-1"))
                .thenReturn(Optional.of(new AiModelProfile()));
        when(toolsetRepository.findById("non-existent-toolset")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.save(profile))
                .isInstanceOf(ActionDockException.class)
                .hasMessageContaining("AI 工具集不存在: non-existent-toolset");
    }

    /**
     * 当 toolRegistry 为空且工具集ID为空白时抛出异常。
     */
    @Test
    void shouldThrowWhenToolsetIdIsBlankAndNoToolRegistry() {
        AiAgentProfile profile = buildValidProfile("agent-1", "Agent 1");
        profile.setToolsetIds(List.of("  "));
        when(modelProfileRepository.findById("model-1"))
                .thenReturn(Optional.of(new AiModelProfile()));

        assertThatThrownBy(() -> service.save(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("工具集 ID 不能为空");
    }

    /**
     * 当 toolRegistry 和 toolsetRepository 都为空时，跳过工具集校验。
     */
    @Test
    void shouldSkipToolsetValidationWhenBothRegistryAndToolsetRepoAreNull() {
        AiAgentProfileService minimalService = new AiAgentProfileService(
                repository, modelProfileRepository);
        AiAgentProfile profile = buildValidProfile("agent-1", "Agent 1");
        profile.setToolsetIds(List.of("toolset-1"));
        when(modelProfileRepository.findById("model-1"))
                .thenReturn(Optional.of(new AiModelProfile()));
        when(repository.findById("agent-1")).thenReturn(Optional.empty());
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        AiAgentProfile result = minimalService.save(profile);

        assertThat(result).isNotNull();
    }

    // ==================== save() - skillRegistry 路径 ====================

    /**
     * 当 skillRegistry 不为空时，校验所有 skillId 引用有效性。
     */
    @Test
    void shouldRequireSkillsViaSkillRegistry() {
        AiAgentProfile profile = buildValidProfile("agent-1", "Agent 1");
        profile.setSkillIds(List.of("skill-1", "skill-2"));
        when(modelProfileRepository.findById("model-1"))
                .thenReturn(Optional.of(new AiModelProfile()));
        when(skillRegistry.requireSkill(any())).thenReturn(mock(AiAgentSkill.class));
        when(repository.findById("agent-1")).thenReturn(Optional.empty());
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        service.save(profile);

        verify(skillRegistry).requireSkill("skill-1");
        verify(skillRegistry).requireSkill("skill-2");
    }

    /**
     * 当 skillId 为空白时抛出异常。
     */
    @Test
    void shouldThrowWhenSkillIdIsBlank() {
        AiAgentProfile profile = buildValidProfile("agent-1", "Agent 1");
        profile.setSkillIds(List.of("  "));
        when(modelProfileRepository.findById("model-1"))
                .thenReturn(Optional.of(new AiModelProfile()));

        assertThatThrownBy(() -> service.save(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Agent Skill ID 不能为空");
    }

    /**
     * 重复的 skillId 只校验一次（去重）。
     */
    @Test
    void shouldDeduplicateSkillIdsBeforeValidation() {
        AiAgentProfile profile = buildValidProfile("agent-1", "Agent 1");
        profile.setSkillIds(List.of("skill-1", "skill-1"));
        when(modelProfileRepository.findById("model-1"))
                .thenReturn(Optional.of(new AiModelProfile()));
        when(skillRegistry.requireSkill(any())).thenReturn(mock(AiAgentSkill.class));
        when(repository.findById("agent-1")).thenReturn(Optional.empty());
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        service.save(profile);

        verify(skillRegistry, times(1)).requireSkill("skill-1");
    }

    // ==================== save() - 无 skillRegistry ====================

    /**
     * 当 skillRegistry 为空时，不校验 skillId 引用。
     */
    @Test
    void shouldNotValidateSkillsWhenSkillRegistryIsNull() {
        AiAgentProfileService serviceWithoutSkillRegistry = new AiAgentProfileService(
                repository, modelProfileRepository, toolsetRepository, null, null);
        AiAgentProfile profile = buildValidProfile("agent-1", "Agent 1");
        profile.setSkillIds(List.of("skill-1"));
        when(modelProfileRepository.findById("model-1"))
                .thenReturn(Optional.of(new AiModelProfile()));
        when(repository.findById("agent-1")).thenReturn(Optional.empty());
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        AiAgentProfile result = serviceWithoutSkillRegistry.save(profile);

        assertThat(result).isNotNull();
    }

    // ==================== delete() ====================

    /**
     * 成功删除非托管的Agent Profile。
     */
    @Test
    void shouldDeleteProfileWhenIdIsNotManaged() {
        service.delete("my-agent");

        verify(repository).deleteById("my-agent");
    }

    /**
     * 删除托管的Agent Profile时抛出异常（pkg.前缀）。
     */
    @Test
    void shouldThrowWhenDeleteManagedProfile() {
        assertThatThrownBy(() -> service.delete("pkg.agent"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("AI 能力包托管Agent不允许直接修改: pkg.agent");
    }

    /**
     * 删除cap.前缀的托管Agent Profile时抛出异常。
     */
    @Test
    void shouldThrowWhenDeleteManagedEntryProfile() {
        assertThatThrownBy(() -> service.delete("cap.agent"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("AI 能力包托管Agent不允许直接修改: cap.agent");
    }

    /**
     * 删除时不会实际调用 repository，因为断言失败在先。
     */
    @Test
    void shouldNotCallRepositoryWhenDeleteManagedProfile() {
        assertThatThrownBy(() -> service.delete("pkg.agent"))
                .isInstanceOf(IllegalArgumentException.class);

        verify(repository, never()).deleteById(any());
    }

    // ==================== 构造器重载测试 ====================

    /**
     * 双参数构造器创建的实例能正常调用 list()。
     */
    @Test
    void shouldWorkWithTwoArgConstructor() {
        AiAgentProfileService minimalService = new AiAgentProfileService(
                repository, modelProfileRepository);
        when(repository.findAll()).thenReturn(List.of());

        List<AiAgentProfile> result = minimalService.list();

        assertThat(result).isEmpty();
    }

    /**
     * 三参数构造器创建的实例能正常调用 list()。
     */
    @Test
    void shouldWorkWithThreeArgConstructor() {
        AiAgentProfileService serviceWithToolset = new AiAgentProfileService(
                repository, modelProfileRepository, toolsetRepository);
        when(repository.findAll()).thenReturn(List.of());

        List<AiAgentProfile> result = serviceWithToolset.list();

        assertThat(result).isEmpty();
    }

    // ==================== 辅助方法 ====================

    private static AiAgentProfile buildValidProfile(String id, String name) {
        return new AiAgentProfile()
                .setId(id)
                .setName(name)
                .setModelProfileId("model-1");
    }
}
