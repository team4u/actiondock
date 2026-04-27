package org.team4u.actiondock.ai.workbench;

import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiCapability;
import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiModelProvider;
import org.team4u.actiondock.ai.api.AiProvider;
import org.team4u.actiondock.ai.api.AiToolPermission;
import org.team4u.actiondock.ai.api.AiToolset;
import org.team4u.actiondock.ai.api.AiToolsetRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class AiWorkbenchDefaults {
    public static final String MODEL_PROFILE_ID = "workbench-model-default";
    public static final String READONLY_TOOLSET_ID = "workbench-readonly-tools";
    public static final String PROPOSAL_TOOLSET_ID = "workbench-proposal-tools";
    public static final String SCRIPT_DEV_AGENT_ID = "workbench-script-dev-agent";
    public static final String EXECUTION_DEBUG_AGENT_ID = "workbench-execution-debug-agent";

    private static final List<String> READONLY_TOOLS = List.of(
            "get_current_script",
            "get_script",
            "list_scripts",
            "get_script_schema",
            "get_execution",
            "get_execution_logs",
            "list_plugin_actions",
            "get_published_snapshot"
    );

    private static final List<String> PROPOSAL_TOOLS = List.of(
            "get_current_script",
            "get_script",
            "list_scripts",
            "get_script_schema",
            "get_execution",
            "get_execution_logs",
            "list_plugin_actions",
            "get_published_snapshot",
            "propose_script_draft",
            "propose_script_patch",
            "propose_schema_patch",
            "propose_execution_diagnosis",
            "propose_execution_fix",
            "propose_publish_review",
            "propose_release_notes",
            "propose_input_example"
    );

    private final AiModelProfileRepository modelRepository;
    private final AiToolsetRepository toolsetRepository;
    private final AiAgentProfileRepository agentRepository;

    public AiWorkbenchDefaults(AiModelProfileRepository modelRepository,
                               AiToolsetRepository toolsetRepository,
                               AiAgentProfileRepository agentRepository) {
        this.modelRepository = modelRepository;
        this.toolsetRepository = toolsetRepository;
        this.agentRepository = agentRepository;
    }

    public void initializeMissingDefaults() {
        LocalDateTime now = LocalDateTime.now();
        if (modelRepository.findById(MODEL_PROFILE_ID).isEmpty()) {
            modelRepository.save(new AiModelProfile()
                    .setId(MODEL_PROFILE_ID)
                    .setName("Workbench Default Model")
                    .setProvider(AiProvider.AGENTSCOPE)
                    .setModelProvider(AiModelProvider.DASHSCOPE)
                    .setModelName("qwen3-max")
                    .setApiKeyConfigKey("ai.dashscope.api_key")
                    .setCapabilities(Set.of(AiCapability.CHAT, AiCapability.STRUCTURED_OUTPUT))
                    .setDefaultOptions(Map.of("temperature", 0.2, "maxTokens", 4000, "timeoutSeconds", 90))
                    .setLimits(Map.of("maxInputCharacters", 30000, "maxOutputTokens", 4000))
                    .setEnabled(true)
                    .setCreatedAt(now)
                    .setUpdatedAt(now));
        }
        if (toolsetRepository.findById(READONLY_TOOLSET_ID).isEmpty()) {
            toolsetRepository.save(new AiToolset()
                    .setId(READONLY_TOOLSET_ID)
                    .setName("Workbench Readonly Tools")
                    .setDescription("只读读取脚本、执行记录和插件动作上下文")
                    .setToolNames(READONLY_TOOLS)
                    .setMaxPermission(AiToolPermission.READ_ONLY)
                    .setEnabled(true)
                    .setCreatedAt(now)
                    .setUpdatedAt(now));
        }
        if (toolsetRepository.findById(PROPOSAL_TOOLSET_ID).isEmpty()) {
            toolsetRepository.save(new AiToolset()
                    .setId(PROPOSAL_TOOLSET_ID)
                    .setName("Workbench Proposal Tools")
                    .setDescription("只读上下文加草稿、patch、诊断、review 和 release notes 提案")
                    .setToolNames(PROPOSAL_TOOLS)
                    .setMaxPermission(AiToolPermission.PROPOSE_CHANGE)
                    .setEnabled(true)
                    .setCreatedAt(now)
                    .setUpdatedAt(now));
        }
        if (agentRepository.findById(SCRIPT_DEV_AGENT_ID).isEmpty()) {
            agentRepository.save(new AiAgentProfile()
                    .setId(SCRIPT_DEV_AGENT_ID)
                    .setName("Workbench Script Dev Agent")
                    .setProvider(AiProvider.AGENTSCOPE)
                    .setModelProfileId(MODEL_PROFILE_ID)
                    .setSystemPrompt(scriptDevPrompt())
                    .setToolsetIds(List.of(PROPOSAL_TOOLSET_ID))
                    .setPolicy(Map.of("maxToolPermission", "PROPOSE_CHANGE", "allowDangerousActions", false))
                    .setOptions(Map.of("temperature", 0.2))
                    .setEnabled(true)
                    .setCreatedAt(now)
                    .setUpdatedAt(now));
        }
        if (agentRepository.findById(EXECUTION_DEBUG_AGENT_ID).isEmpty()) {
            agentRepository.save(new AiAgentProfile()
                    .setId(EXECUTION_DEBUG_AGENT_ID)
                    .setName("Workbench Execution Debug Agent")
                    .setProvider(AiProvider.AGENTSCOPE)
                    .setModelProfileId(MODEL_PROFILE_ID)
                    .setSystemPrompt(executionDebugPrompt())
                    .setToolsetIds(List.of(PROPOSAL_TOOLSET_ID))
                    .setPolicy(Map.of("maxToolPermission", "PROPOSE_CHANGE", "allowDangerousActions", false))
                    .setOptions(Map.of("temperature", 0.1))
                    .setEnabled(true)
                    .setCreatedAt(now)
                    .setUpdatedAt(now));
        }
    }

    private String scriptDevPrompt() {
        return """
                你是 ActionDock Workbench 的脚本开发 Agent。只能读取上下文和生成提案，不能保存、发布或执行生产动作。
                按任务选择 proposal 工具返回结构化结果：生成脚本用 propose_script_draft，修复源码用 propose_script_patch，补全 Schema 用 propose_schema_patch，发布前检查用 propose_publish_review，发布说明用 propose_release_notes。
                结果必须具体、可复制，并说明 rationale。脚本默认生成 Groovy，除非用户明确要求 Python。
                """;
    }

    private String executionDebugPrompt() {
        return """
                你是 ActionDock Workbench 的执行失败诊断 Agent。只能读取执行记录、日志、脚本和 Schema，并通过 propose_execution_diagnosis 或 propose_execution_fix 返回提案。
                输出应包含 rootCause、evidence、suggestedFix、risk 和 nextSteps；不能修改、保存、发布或重新执行脚本。
                """;
    }
}
