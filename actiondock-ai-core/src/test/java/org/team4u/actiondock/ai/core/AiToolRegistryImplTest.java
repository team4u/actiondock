package org.team4u.actiondock.ai.core;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiCallerType;
import org.team4u.actiondock.ai.api.AiTool;
import org.team4u.actiondock.ai.api.AiToolExecutionContext;
import org.team4u.actiondock.ai.api.AiToolExecutionResult;
import org.team4u.actiondock.ai.api.AiToolPermission;
import org.team4u.actiondock.ai.api.AiToolProvider;
import org.team4u.actiondock.ai.api.AiToolset;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.ai.api.ConfigurableAiTool;
import org.team4u.actiondock.domain.exception.ActionDockException;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * AiToolRegistryImpl 的单元测试。
 * <p>
 * 覆盖工具注册表的静态工具注册、动态工具提供者、工具集查询、
 * Agent 工具解析、工具调用和权限校验等核心场景。
 *
 * @author jay.wu
 */
class AiToolRegistryImplTest {

    private AiToolsetRepository toolsetRepository;
    private AiToolRegistryImpl registry;

    private AiTool readOnlyTool;
    private AiTool dangerousTool;

    @BeforeEach
    void setUp() {
        toolsetRepository = mock(AiToolsetRepository.class);
        readOnlyTool = mockTool("read-tool", AiToolPermission.READ_ONLY);
        dangerousTool = mockTool("danger-tool", AiToolPermission.DANGEROUS_ACTION);
        registry = new AiToolRegistryImpl(toolsetRepository, List.of(readOnlyTool, dangerousTool));
    }

    // ========== getTool ==========

    /**
     * 根据名称获取已注册的静态工具。
     */
    @Test
    void shouldReturnStaticToolByName() {
        AiTool result = registry.getTool("read-tool");

        assertThat(result).isSameAs(readOnlyTool);
    }

    /**
     * 获取不存在的工具时抛出异常。
     */
    @Test
    void shouldThrowWhenToolNotFound() {
        assertThatThrownBy(() -> registry.getTool("non-existent"))
                .isInstanceOf(ActionDockException.class)
                .hasMessageContaining("AI 工具不存在: non-existent");
    }

    /**
     * 通过动态提供者查找工具，当静态工具不存在时回退到提供者。
     */
    @Test
    void shouldFallBackToProviderWhenStaticToolNotFound() {
        AiTool providerTool = mockTool("dynamic-tool", AiToolPermission.READ_ONLY);
        AiToolProvider provider = mock(AiToolProvider.class);
        when(provider.findTool("dynamic-tool")).thenReturn(Optional.of(providerTool));

        AiToolRegistryImpl registryWithProvider = new AiToolRegistryImpl(
                toolsetRepository, List.of(), List.of(provider));

        AiTool result = registryWithProvider.getTool("dynamic-tool");

        assertThat(result).isSameAs(providerTool);
        verify(provider).findTool("dynamic-tool");
    }

    /**
     * 静态工具优先于动态提供者中的同名工具。
     */
    @Test
    void shouldPreferStaticToolOverProvider() {
        AiTool staticTool = mockTool("shared-name", AiToolPermission.READ_ONLY);
        AiTool providerTool = mockTool("shared-name", AiToolPermission.READ_ONLY);
        AiToolProvider provider = mock(AiToolProvider.class);
        when(provider.findTool("shared-name")).thenReturn(Optional.of(providerTool));

        AiToolRegistryImpl registryWithProvider = new AiToolRegistryImpl(
                toolsetRepository, List.of(staticTool), List.of(provider));

        AiTool result = registryWithProvider.getTool("shared-name");

        assertThat(result).isSameAs(staticTool);
        verifyNoInteractions(provider);
    }

    // ========== listTools ==========

    /**
     * 传入 null 的工具集 ID 时，返回所有已注册的静态工具和动态工具。
     */
    @Test
    void shouldListAllToolsWhenToolsetIdIsNull() {
        AiTool providerTool = mockTool("provider-tool", AiToolPermission.READ_ONLY);
        AiToolProvider provider = mock(AiToolProvider.class);
        when(provider.listTools()).thenReturn(List.of(providerTool));

        AiToolRegistryImpl registryWithProvider = new AiToolRegistryImpl(
                toolsetRepository, List.of(readOnlyTool), List.of(provider));

        List<AiTool> tools = registryWithProvider.listTools(null);

        assertThat(tools).hasSize(2);
        assertThat(tools.stream().map(AiTool::name).toList())
                .containsExactly("read-tool", "provider-tool");
    }

    /**
     * 传入空白的工具集 ID 时，返回所有已注册的工具。
     */
    @Test
    void shouldListAllToolsWhenToolsetIdIsBlank() {
        List<AiTool> tools = registry.listTools("   ");

        assertThat(tools).hasSize(2);
    }

    /**
     * 动态提供者中的同名工具不会覆盖静态工具（putIfAbsent 语义）。
     */
    @Test
    void shouldNotOverrideStaticToolFromProvider() {
        AiTool providerTool = mockTool("read-tool", AiToolPermission.READ_ONLY);
        AiToolProvider provider = mock(AiToolProvider.class);
        when(provider.listTools()).thenReturn(List.of(providerTool));

        AiToolRegistryImpl registryWithProvider = new AiToolRegistryImpl(
                toolsetRepository, List.of(readOnlyTool), List.of(provider));

        List<AiTool> tools = registryWithProvider.listTools(null);

        assertThat(tools).hasSize(1);
        assertThat(tools.get(0)).isSameAs(readOnlyTool);
    }

    /**
     * 根据工具集 ID 列出工具，工具集存在且启用时返回工具列表。
     */
    @Test
    void shouldListToolsByToolsetId() {
        AiToolset toolset = new AiToolset()
                .setId("ts-1")
                .setEnabled(true)
                .setToolNames(List.of("read-tool"))
                .setMaxPermission(AiToolPermission.DANGEROUS_ACTION);
        when(toolsetRepository.findById("ts-1")).thenReturn(Optional.of(toolset));

        List<AiTool> tools = registry.listTools("ts-1");

        assertThat(tools).hasSize(1);
        assertThat(tools.get(0).name()).isEqualTo("read-tool");
    }

    /**
     * 工具集不存在时返回空列表。
     */
    @Test
    void shouldReturnEmptyWhenToolsetNotFound() {
        when(toolsetRepository.findById("missing")).thenReturn(Optional.empty());

        List<AiTool> tools = registry.listTools("missing");

        assertThat(tools).isEmpty();
    }

    /**
     * 工具集被禁用时返回空列表。
     */
    @Test
    void shouldReturnEmptyWhenToolsetIsDisabled() {
        AiToolset toolset = new AiToolset()
                .setId("ts-1")
                .setEnabled(false)
                .setToolNames(List.of("read-tool"))
                .setMaxPermission(AiToolPermission.DANGEROUS_ACTION);
        when(toolsetRepository.findById("ts-1")).thenReturn(Optional.of(toolset));

        List<AiTool> tools = registry.listTools("ts-1");

        assertThat(tools).isEmpty();
    }

    /**
     * 工具集中工具的权限超出上限时抛出异常。
     */
    @Test
    void shouldThrowWhenToolExceedsToolsetMaxPermission() {
        AiToolset toolset = new AiToolset()
                .setId("ts-1")
                .setEnabled(true)
                .setToolNames(List.of("danger-tool"))
                .setMaxPermission(AiToolPermission.READ_ONLY);
        when(toolsetRepository.findById("ts-1")).thenReturn(Optional.of(toolset));

        assertThatThrownBy(() -> registry.listTools("ts-1"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("AI 工具集权限上限")
                .hasMessageContaining("danger-tool");
    }

    /**
     * 工具集中的 ConfigurableAiTool 会被应用配置选项。
     */
    @Test
    void shouldApplyToolOptionsForConfigurableTool() {
        ConfigurableAiTool configurableTool = mock(ConfigurableAiTool.class, Mockito.withSettings().extraInterfaces(AiTool.class));
        AiTool configuredTool = mockTool("config-tool", AiToolPermission.READ_ONLY);
        when(((AiTool) configurableTool).name()).thenReturn("config-tool");
        when(((AiTool) configurableTool).permission()).thenReturn(AiToolPermission.READ_ONLY);
        when(configurableTool.configure(Map.of("key", "value"))).thenReturn(configuredTool);

        AiToolRegistryImpl configurableRegistry = new AiToolRegistryImpl(
                toolsetRepository, List.of((AiTool) configurableTool));

        AiToolset toolset = new AiToolset()
                .setId("ts-1")
                .setEnabled(true)
                .setToolNames(List.of("config-tool"))
                .setToolOptions(Map.of("config-tool", Map.of("key", "value")))
                .setMaxPermission(AiToolPermission.DANGEROUS_ACTION);
        when(toolsetRepository.findById("ts-1")).thenReturn(Optional.of(toolset));

        List<AiTool> tools = configurableRegistry.listTools("ts-1");

        assertThat(tools).hasSize(1);
        verify(configurableTool).configure(Map.of("key", "value"));
    }

    // ========== invoke ==========

    /**
     * 成功调用工具并返回执行结果。
     */
    @Test
    void shouldInvokeToolSuccessfully() {
        AiToolExecutionResult expectedResult = AiToolExecutionResult.success(Map.of("result", "ok"), 10);
        when(readOnlyTool.invoke(Map.of(), null)).thenReturn(expectedResult);

        AiToolExecutionResult result = registry.invoke("read-tool", Map.of(), null);

        assertThat(result.success()).isTrue();
        assertThat(result.output()).containsEntry("result", "ok");
    }

    /**
     * 调用工具时传入 null 的 input 被处理为空 Map。
     */
    @Test
    void shouldHandleNullInputWhenInvoking() {
        AiToolExecutionResult expectedResult = AiToolExecutionResult.success(Map.of(), 5);
        when(readOnlyTool.invoke(Map.of(), null)).thenReturn(expectedResult);

        AiToolExecutionResult result = registry.invoke("read-tool", null, null);

        assertThat(result.success()).isTrue();
        verify(readOnlyTool).invoke(Map.of(), null);
    }

    /**
     * 调用不存在的工具时抛出异常。
     */
    @Test
    void shouldThrowWhenInvokingNonExistentTool() {
        assertThatThrownBy(() -> registry.invoke("missing", Map.of(), null))
                .isInstanceOf(ActionDockException.class)
                .hasMessageContaining("AI 工具不存在: missing");
    }

    /**
     * 工具执行抛出非 IllegalArgumentException 异常时，返回失败结果。
     */
    @Test
    void shouldReturnFailedResultWhenToolThrowsException() {
        when(readOnlyTool.invoke(Map.of(), null))
                .thenThrow(new RuntimeException("something went wrong"));

        AiToolExecutionResult result = registry.invoke("read-tool", Map.of(), null);

        assertThat(result.success()).isFalse();
        assertThat(result.errorMessage()).contains("something went wrong");
        assertThat(result.latencyMs()).isNotNull();
    }

    /**
     * 工具执行抛出 IllegalArgumentException 时，直接向上传播异常。
     */
    @Test
    void shouldPropagateIllegalArgumentExceptionFromTool() {
        when(readOnlyTool.invoke(Map.of(), null))
                .thenThrow(new IllegalArgumentException("bad argument"));

        assertThatThrownBy(() -> registry.invoke("read-tool", Map.of(), null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("bad argument");
    }

    /**
     * 调用工具时，context 中 maxToolPermission 元数据限制工具权限。
     */
    @Test
    void shouldEnforcePermissionFromContextMetadata() {
        AiToolExecutionContext context = new AiToolExecutionContext(
                "run-1", "step-1", AiCallerType.AGENT, null, null, null,
                Map.of("maxToolPermission", "READ_ONLY"));

        assertThatThrownBy(() -> registry.invoke("danger-tool", Map.of(), context))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("AI 工具调用权限上限")
                .hasMessageContaining("danger-tool");
    }

    /**
     * 调用工具时，context 为 null 则默认权限为 DANGEROUS_ACTION。
     */
    @Test
    void shouldDefaultToDangerousActionWhenContextIsNull() {
        AiToolExecutionResult expectedResult = AiToolExecutionResult.success(Map.of(), 1);
        when(dangerousTool.invoke(Map.of(), null)).thenReturn(expectedResult);

        AiToolExecutionResult result = registry.invoke("danger-tool", Map.of(), null);

        assertThat(result.success()).isTrue();
    }

    /**
     * 调用工具时，context 的 metadata 为 null 则默认权限为 DANGEROUS_ACTION。
     */
    @Test
    void shouldDefaultToDangerousActionWhenMetadataIsNull() {
        AiToolExecutionContext context = new AiToolExecutionContext(
                "run-1", "step-1", AiCallerType.AGENT, null, null, null, null);
        AiToolExecutionResult expectedResult = AiToolExecutionResult.success(Map.of(), 1);
        when(dangerousTool.invoke(Map.of(), context)).thenReturn(expectedResult);

        AiToolExecutionResult result = registry.invoke("danger-tool", Map.of(), context);

        assertThat(result.success()).isTrue();
    }

    // ========== listAgentTools ==========

    /**
     * Agent 配置为 null 时返回空列表。
     */
    @Test
    void shouldReturnEmptyWhenAgentProfileIsNull() {
        List<AiTool> tools = registry.listAgentTools(null);

        assertThat(tools).isEmpty();
    }

    /**
     * Agent 配置中引用不存在的工具集时抛出异常。
     */
    @Test
    void shouldThrowWhenAgentReferencesNonExistentToolset() {
        AiAgentProfile profile = new AiAgentProfile()
                .setToolsetIds(List.of("missing-ts"));
        when(toolsetRepository.findById("missing-ts")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> registry.listAgentTools(profile))
                .isInstanceOf(ActionDockException.class)
                .hasMessageContaining("AI 工具集不存在: missing-ts");
    }

    /**
     * Agent 配置中工具集 ID 为空时抛出异常。
     */
    @Test
    void shouldThrowWhenAgentHasBlankToolsetId() {
        AiAgentProfile profile = new AiAgentProfile()
                .setToolsetIds(List.of("  "));

        assertThatThrownBy(() -> registry.listAgentTools(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("工具集 ID 不能为空");
    }

    /**
     * Agent 配置中直接工具名为空时抛出异常。
     */
    @Test
    void shouldThrowWhenAgentHasBlankDirectToolName() {
        AiAgentProfile profile = new AiAgentProfile()
                .setDirectToolNames(List.of("  "));

        assertThatThrownBy(() -> registry.listAgentTools(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("AI 直接工具名不能为空");
    }

    /**
     * Agent 配置中工具集内的工具名为空时抛出异常。
     */
    @Test
    void shouldThrowWhenToolsetContainsBlankToolName() {
        AiToolset toolset = new AiToolset()
                .setId("ts-1")
                .setEnabled(true)
                .setToolNames(List.of("  "))
                .setMaxPermission(AiToolPermission.DANGEROUS_ACTION);
        when(toolsetRepository.findById("ts-1")).thenReturn(Optional.of(toolset));

        AiAgentProfile profile = new AiAgentProfile()
                .setToolsetIds(List.of("ts-1"));

        assertThatThrownBy(() -> registry.listAgentTools(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("AI 工具名不能为空");
    }

    /**
     * Agent 通过直接引用获取工具列表。
     */
    @Test
    void shouldListDirectToolsForAgent() {
        AiAgentProfile profile = new AiAgentProfile()
                .setDirectToolNames(List.of("read-tool"));

        List<AiTool> tools = registry.listAgentTools(profile);

        assertThat(tools).hasSize(1);
        assertThat(tools.get(0).name()).isEqualTo("read-tool");
    }

    /**
     * Agent 通过工具集和直接引用组合获取工具列表。
     */
    @Test
    void shouldListCombinedToolsFromToolsetAndDirect() {
        AiToolset toolset = new AiToolset()
                .setId("ts-1")
                .setEnabled(true)
                .setToolNames(List.of("read-tool"))
                .setMaxPermission(AiToolPermission.DANGEROUS_ACTION);
        when(toolsetRepository.findById("ts-1")).thenReturn(Optional.of(toolset));

        AiAgentProfile profile = new AiAgentProfile()
                .setToolsetIds(List.of("ts-1"))
                .setDirectToolNames(List.of("danger-tool"));

        List<AiTool> tools = registry.listAgentTools(profile);

        assertThat(tools).hasSize(2);
        assertThat(tools.stream().map(AiTool::name).toList())
                .containsExactly("read-tool", "danger-tool");
    }

    /**
     * Agent 配置中工具集被禁用时跳过该工具集。
     */
    @Test
    void shouldSkipDisabledToolsetForAgent() {
        AiToolset toolset = new AiToolset()
                .setId("ts-1")
                .setEnabled(false)
                .setToolNames(List.of("read-tool"))
                .setMaxPermission(AiToolPermission.DANGEROUS_ACTION);
        when(toolsetRepository.findById("ts-1")).thenReturn(Optional.of(toolset));

        AiAgentProfile profile = new AiAgentProfile()
                .setToolsetIds(List.of("ts-1"))
                .setDirectToolNames(List.of("danger-tool"));

        List<AiTool> tools = registry.listAgentTools(profile);

        assertThat(tools).hasSize(1);
        assertThat(tools.get(0).name()).isEqualTo("danger-tool");
    }

    /**
     * Agent 工具集中工具的权限超出上限时抛出异常。
     */
    @Test
    void shouldThrowWhenAgentToolExceedsPermission() {
        AiToolset toolset = new AiToolset()
                .setId("ts-1")
                .setEnabled(true)
                .setToolNames(List.of("danger-tool"))
                .setMaxPermission(AiToolPermission.READ_ONLY);
        when(toolsetRepository.findById("ts-1")).thenReturn(Optional.of(toolset));

        AiAgentProfile profile = new AiAgentProfile()
                .setToolsetIds(List.of("ts-1"));

        assertThatThrownBy(() -> registry.listAgentTools(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("AI 工具集权限上限");
    }

    /**
     * 同一工具在不同来源（工具集与直接引用）中使用相同选项时不产生冲突。
     */
    @Test
    void shouldNotConflictWhenSameToolFromDifferentSourcesWithSameOptions() {
        AiToolset toolset = new AiToolset()
                .setId("ts-1")
                .setEnabled(true)
                .setToolNames(List.of("read-tool"))
                .setMaxPermission(AiToolPermission.DANGEROUS_ACTION);
        when(toolsetRepository.findById("ts-1")).thenReturn(Optional.of(toolset));

        AiAgentProfile profile = new AiAgentProfile()
                .setToolsetIds(List.of("ts-1"))
                .setDirectToolNames(List.of("read-tool"));

        List<AiTool> tools = registry.listAgentTools(profile);

        assertThat(tools).hasSize(1);
        assertThat(tools.get(0).name()).isEqualTo("read-tool");
    }

    /**
     * 同一工具在不同来源中使用不同选项时产生冲突并抛出异常。
     */
    @Test
    void shouldThrowWhenSameToolFromDifferentSourcesWithDifferentOptions() {
        AiToolset toolset = new AiToolset()
                .setId("ts-1")
                .setEnabled(true)
                .setToolNames(List.of("read-tool"))
                .setToolOptions(Map.of("read-tool", Map.of("mode", "fast")))
                .setMaxPermission(AiToolPermission.DANGEROUS_ACTION);
        when(toolsetRepository.findById("ts-1")).thenReturn(Optional.of(toolset));

        AiAgentProfile profile = new AiAgentProfile()
                .setToolsetIds(List.of("ts-1"))
                .setDirectToolNames(List.of("read-tool"))
                .setDirectToolOptions(Map.of("read-tool", Map.of("mode", "slow")));

        assertThatThrownBy(() -> registry.listAgentTools(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Agent 工具配置冲突")
                .hasMessageContaining("read-tool")
                .hasMessageContaining("配置不一致");
    }

    /**
     * 同一工具在多个工具集中使用相同选项时不产生冲突。
     */
    @Test
    void shouldNotConflictWhenSameToolInMultipleToolsetsWithSameOptions() {
        AiToolset toolset1 = new AiToolset()
                .setId("ts-1")
                .setEnabled(true)
                .setToolNames(List.of("read-tool"))
                .setToolOptions(Map.of("read-tool", Map.of("mode", "fast")))
                .setMaxPermission(AiToolPermission.DANGEROUS_ACTION);
        AiToolset toolset2 = new AiToolset()
                .setId("ts-2")
                .setEnabled(true)
                .setToolNames(List.of("read-tool"))
                .setToolOptions(Map.of("read-tool", Map.of("mode", "fast")))
                .setMaxPermission(AiToolPermission.DANGEROUS_ACTION);
        when(toolsetRepository.findById("ts-1")).thenReturn(Optional.of(toolset1));
        when(toolsetRepository.findById("ts-2")).thenReturn(Optional.of(toolset2));

        AiAgentProfile profile = new AiAgentProfile()
                .setToolsetIds(List.of("ts-1", "ts-2"));

        List<AiTool> tools = registry.listAgentTools(profile);

        assertThat(tools).hasSize(1);
    }

    /**
     * 同一工具在多个工具集中使用不同选项时产生冲突。
     */
    @Test
    void shouldConflictWhenSameToolInMultipleToolsetsWithDifferentOptions() {
        AiToolset toolset1 = new AiToolset()
                .setId("ts-1")
                .setEnabled(true)
                .setToolNames(List.of("read-tool"))
                .setToolOptions(Map.of("read-tool", Map.of("mode", "fast")))
                .setMaxPermission(AiToolPermission.DANGEROUS_ACTION);
        AiToolset toolset2 = new AiToolset()
                .setId("ts-2")
                .setEnabled(true)
                .setToolNames(List.of("read-tool"))
                .setToolOptions(Map.of("read-tool", Map.of("mode", "slow")))
                .setMaxPermission(AiToolPermission.DANGEROUS_ACTION);
        when(toolsetRepository.findById("ts-1")).thenReturn(Optional.of(toolset1));
        when(toolsetRepository.findById("ts-2")).thenReturn(Optional.of(toolset2));

        AiAgentProfile profile = new AiAgentProfile()
                .setToolsetIds(List.of("ts-1", "ts-2"));

        assertThatThrownBy(() -> registry.listAgentTools(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Agent 工具配置冲突")
                .hasMessageContaining("read-tool")
                .hasMessageContaining("toolset:ts-1")
                .hasMessageContaining("toolset:ts-2");
    }

    // ========== 构造器边界 ==========

    /**
     * 工具列表为 null 时初始化成功，列出工具返回空列表。
     */
    @Test
    void shouldHandleNullToolsList() {
        AiToolRegistryImpl emptyRegistry = new AiToolRegistryImpl(toolsetRepository, null);

        List<AiTool> tools = emptyRegistry.listTools(null);

        assertThat(tools).isEmpty();
    }

    /**
     * 工具提供者列表为 null 时初始化成功，不抛出异常。
     */
    @Test
    void shouldHandleNullProvidersList() {
        AiToolRegistryImpl registryWithNullProviders = new AiToolRegistryImpl(
                toolsetRepository, List.of(readOnlyTool), null);

        List<AiTool> tools = registryWithNullProviders.listTools(null);

        assertThat(tools).hasSize(1);
    }

    // ========== 辅助方法 ==========

    private AiTool mockTool(String name, AiToolPermission permission) {
        AiTool tool = mock(AiTool.class);
        when(tool.name()).thenReturn(name);
        when(tool.permission()).thenReturn(permission);
        return tool;
    }
}
