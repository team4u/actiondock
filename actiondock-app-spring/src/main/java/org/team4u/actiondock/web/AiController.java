package org.team4u.actiondock.web;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentRunContext;
import org.team4u.actiondock.ai.api.AiAgentRunRecord;
import org.team4u.actiondock.ai.api.AiAgentRunRequest;
import org.team4u.actiondock.ai.api.AiAgentRunResult;
import org.team4u.actiondock.ai.api.AiAgentRunSnapshot;
import org.team4u.actiondock.ai.api.AiAgentRunSubmission;
import org.team4u.actiondock.ai.api.AiAgentResumeCommand;
import org.team4u.actiondock.ai.api.AiCallContext;
import org.team4u.actiondock.ai.api.AiCallerType;
import org.team4u.actiondock.ai.api.AiCallLog;
import org.team4u.actiondock.ai.api.AiCallLogRepository;
import org.team4u.actiondock.ai.api.AiChatRequest;
import org.team4u.actiondock.ai.api.AiChatResponse;
import org.team4u.actiondock.ai.api.AiEmbeddingRequest;
import org.team4u.actiondock.ai.api.AiEmbeddingResponse;
import org.team4u.actiondock.ai.api.AiGateway;
import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.api.AiStructuredRequest;
import org.team4u.actiondock.ai.api.AiStructuredResponse;
import org.team4u.actiondock.ai.api.AiToolDescriptor;
import org.team4u.actiondock.ai.api.AiToolExecutionContext;
import org.team4u.actiondock.ai.api.AiToolExecutionResult;
import org.team4u.actiondock.ai.api.AiToolset;
import org.team4u.actiondock.ai.core.AiAgentProfileService;
import org.team4u.actiondock.ai.core.AiAgentRuntimeImpl;
import org.team4u.actiondock.ai.core.AiModelProfileService;
import org.team4u.actiondock.ai.core.AiToolRegistryImpl;
import org.team4u.actiondock.ai.core.AiToolsetService;

import java.util.List;

@RestController
@RequestMapping("/api/ai")
public class AiController {
    private final AiModelProfileService modelProfileService;
    private final AiAgentProfileService agentProfileService;
    private final AiToolsetService toolsetService;
    private final AiToolRegistryImpl toolRegistry;
    private final AiGateway aiGateway;
    private final AiAgentRuntimeImpl aiAgentRuntime;
    private final AiCallLogRepository callLogRepository;

    public AiController(AiModelProfileService modelProfileService,
                        AiAgentProfileService agentProfileService,
                        AiToolsetService toolsetService,
                        AiToolRegistryImpl toolRegistry,
                        AiGateway aiGateway,
                        AiAgentRuntimeImpl aiAgentRuntime,
                        AiCallLogRepository callLogRepository) {
        this.modelProfileService = modelProfileService;
        this.agentProfileService = agentProfileService;
        this.toolsetService = toolsetService;
        this.toolRegistry = toolRegistry;
        this.aiGateway = aiGateway;
        this.aiAgentRuntime = aiAgentRuntime;
        this.callLogRepository = callLogRepository;
    }

    @GetMapping("/models")
    public ApiResponse<List<AiModelProfile>> listModels() {
        return ApiResponse.success(modelProfileService.list());
    }

    @PostMapping("/models")
    public ApiResponse<AiModelProfile> createModel(@RequestBody AiModelProfile profile) {
        return ApiResponse.success(modelProfileService.save(profile));
    }

    @GetMapping("/models/{id}")
    public ApiResponse<AiModelProfile> getModel(@PathVariable String id) {
        return ApiResponse.success(modelProfileService.get(id));
    }

    @PutMapping("/models/{id}")
    public ApiResponse<AiModelProfile> updateModel(@PathVariable String id, @RequestBody AiModelProfile profile) {
        profile.setId(id);
        return ApiResponse.success(modelProfileService.save(profile));
    }

    @DeleteMapping("/models/{id}")
    public ApiResponse<Void> deleteModel(@PathVariable String id) {
        modelProfileService.delete(id);
        return ApiResponse.success(null);
    }

    @PostMapping("/models/{id}/test")
    public ApiResponse<AiChatResponse> testModel(@PathVariable String id, @RequestBody AiChatRequest request) {
        AiChatRequest testRequest = new AiChatRequest(id, request == null ? List.of() : request.messages(), request == null ? null : request.options());
        return ApiResponse.success(aiGateway.chat(testRequest, AiCallContext.adminTest()));
    }

    @GetMapping("/agents")
    public ApiResponse<List<AiAgentProfile>> listAgents() {
        return ApiResponse.success(agentProfileService.list());
    }

    @PostMapping("/agents")
    public ApiResponse<AiAgentProfile> createAgent(@RequestBody AiAgentProfile profile) {
        return ApiResponse.success(agentProfileService.save(profile));
    }

    @GetMapping("/agents/{id}")
    public ApiResponse<AiAgentProfile> getAgent(@PathVariable String id) {
        return ApiResponse.success(agentProfileService.get(id));
    }

    @PutMapping("/agents/{id}")
    public ApiResponse<AiAgentProfile> updateAgent(@PathVariable String id, @RequestBody AiAgentProfile profile) {
        profile.setId(id);
        return ApiResponse.success(agentProfileService.save(profile));
    }

    @DeleteMapping("/agents/{id}")
    public ApiResponse<Void> deleteAgent(@PathVariable String id) {
        agentProfileService.delete(id);
        return ApiResponse.success(null);
    }

    @PostMapping("/agents/{id}/test")
    public ApiResponse<AiAgentRunResult> testAgent(@PathVariable String id, @RequestBody AiAgentRunRequest request) {
        AiAgentRunRequest testRequest = new AiAgentRunRequest(id, request == null ? List.of() : request.messages(), request == null ? null : request.input(), request == null ? null : request.options());
        return ApiResponse.success(aiAgentRuntime.run(testRequest, AiAgentRunContext.adminTest()));
    }

    @GetMapping("/toolsets")
    public ApiResponse<List<AiToolset>> listToolsets() {
        return ApiResponse.success(toolsetService.list());
    }

    @PostMapping("/toolsets")
    public ApiResponse<AiToolset> createToolset(@RequestBody AiToolset toolset) {
        return ApiResponse.success(toolsetService.save(toolset));
    }

    @GetMapping("/toolsets/{id}")
    public ApiResponse<AiToolset> getToolset(@PathVariable String id) {
        return ApiResponse.success(toolsetService.get(id));
    }

    @PutMapping("/toolsets/{id}")
    public ApiResponse<AiToolset> updateToolset(@PathVariable String id, @RequestBody AiToolset toolset) {
        toolset.setId(id);
        return ApiResponse.success(toolsetService.save(toolset));
    }

    @DeleteMapping("/toolsets/{id}")
    public ApiResponse<Void> deleteToolset(@PathVariable String id) {
        toolsetService.delete(id);
        return ApiResponse.success(null);
    }

    @GetMapping("/tools")
    public ApiResponse<List<AiToolDescriptor>> listTools() {
        return ApiResponse.success(toolRegistry.listTools(null).stream().map(AiToolDescriptor::from).toList());
    }

    @GetMapping("/tools/{name}")
    public ApiResponse<AiToolDescriptor> getTool(@PathVariable String name) {
        return ApiResponse.success(AiToolDescriptor.from(toolRegistry.getTool(name)));
    }

    @PostMapping("/tools/{name}/test")
    public ApiResponse<AiToolExecutionResult> testTool(@PathVariable String name, @RequestBody(required = false) java.util.Map<String, Object> input) {
        return ApiResponse.success(toolRegistry.invoke(name, input, new AiToolExecutionContext(
                null,
                null,
                AiCallerType.ADMIN_TEST,
                null,
                null,
                null,
                java.util.Map.of("maxToolPermission", "CONTROLLED_ACTION")
        )));
    }

    @PostMapping("/chat")
    public ApiResponse<AiChatResponse> chat(@RequestBody AiChatRequest request) {
        return ApiResponse.success(aiGateway.chat(request, AiCallContext.adminTest()));
    }

    @PostMapping("/structured")
    public ApiResponse<AiStructuredResponse> structured(@RequestBody AiStructuredRequest request) {
        return ApiResponse.success(aiGateway.structured(request, AiCallContext.adminTest()));
    }

    @PostMapping("/embed")
    public ApiResponse<AiEmbeddingResponse> embed(@RequestBody AiEmbeddingRequest request) {
        return ApiResponse.success(aiGateway.embed(request, AiCallContext.adminTest()));
    }

    @PostMapping("/agents/run")
    public ApiResponse<AiAgentRunResult> runAgent(@RequestBody AiAgentRunRequest request) {
        return ApiResponse.success(aiAgentRuntime.run(request, AiAgentRunContext.adminTest()));
    }

    @PostMapping("/agents/runs")
    public ApiResponse<AiAgentRunSubmission> submitRun(@RequestBody AiAgentRunRequest request) {
        return ApiResponse.success(aiAgentRuntime.submit(request, AiAgentRunContext.adminTest()));
    }

    @GetMapping("/agents/runs")
    public ApiResponse<List<AiAgentRunRecord>> listRuns() {
        return ApiResponse.success(aiAgentRuntime.listRuns());
    }

    @GetMapping("/agents/runs/{runId}")
    public ApiResponse<AiAgentRunSnapshot> getRun(@PathVariable String runId) {
        return ApiResponse.success(aiAgentRuntime.getRun(runId));
    }

    @PostMapping("/agents/runs/{runId}/resume")
    public ApiResponse<AiAgentRunResult> resumeRun(@PathVariable String runId, @RequestBody(required = false) AiAgentResumeCommand command) {
        return ApiResponse.success(aiAgentRuntime.resume(runId, command == null ? new AiAgentResumeCommand(java.util.Map.of()) : command));
    }

    @PostMapping("/agents/runs/{runId}/cancel")
    public ApiResponse<Void> cancelRun(@PathVariable String runId) {
        aiAgentRuntime.cancel(runId);
        return ApiResponse.success(null);
    }

    @GetMapping("/calls")
    public ApiResponse<List<AiCallLog>> listCalls() {
        return ApiResponse.success(callLogRepository.findAll());
    }
}
