package org.team4u.actiondock.web.ai;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.ai.api.AiAgentRunContext;
import org.team4u.actiondock.ai.api.AiAgentRunRecord;
import org.team4u.actiondock.ai.api.AiAgentRunRequest;
import org.team4u.actiondock.ai.api.AiAgentRunResult;
import org.team4u.actiondock.ai.api.AiAgentRunSnapshot;
import org.team4u.actiondock.ai.api.AiAgentRunSubmission;
import org.team4u.actiondock.ai.api.AiAgentResumeCommand;
import org.team4u.actiondock.ai.core.AiAgentRuntimeImpl;
import org.team4u.actiondock.web.common.ApiResponse;

import java.util.List;

@RestController
@RequestMapping("/api/ai/agents")
public class AiAgentRuntimeController {

    private final AiAgentRuntimeImpl aiAgentRuntime;

    public AiAgentRuntimeController(AiAgentRuntimeImpl aiAgentRuntime) {
        this.aiAgentRuntime = aiAgentRuntime;
    }

    @PostMapping("/run")
    public ApiResponse<AiAgentRunResult> runAgent(@RequestBody AiAgentRunRequest request) {
        return ApiResponse.success(aiAgentRuntime.run(request, AiAgentRunContext.adminTest()));
    }

    @PostMapping("/{id}/test")
    public ApiResponse<AiAgentRunResult> testAgent(@PathVariable String id, @RequestBody AiAgentRunRequest request) {
        AiAgentRunRequest testRequest = new AiAgentRunRequest(id, request == null ? List.of() : request.messages(), request == null ? null : request.input(), request == null ? null : request.options());
        return ApiResponse.success(aiAgentRuntime.run(testRequest, AiAgentRunContext.adminTest()));
    }

    @PostMapping("/runs")
    public ApiResponse<AiAgentRunSubmission> submitRun(@RequestBody AiAgentRunRequest request) {
        return ApiResponse.success(aiAgentRuntime.submit(request, AiAgentRunContext.adminTest()));
    }

    @GetMapping("/runs")
    public ApiResponse<List<AiAgentRunRecord>> listRuns() {
        return ApiResponse.success(aiAgentRuntime.listRuns());
    }

    @GetMapping("/runs/{runId}")
    public ApiResponse<AiAgentRunSnapshot> getRun(@PathVariable String runId) {
        return ApiResponse.success(aiAgentRuntime.getRun(runId));
    }

    @PostMapping("/runs/{runId}/resume")
    public ApiResponse<AiAgentRunResult> resumeRun(@PathVariable String runId, @RequestBody(required = false) AiAgentResumeCommand command) {
        return ApiResponse.success(aiAgentRuntime.resume(runId, command == null ? new AiAgentResumeCommand(java.util.Map.of()) : command));
    }

    @PostMapping("/runs/{runId}/cancel")
    public ApiResponse<Void> cancelRun(@PathVariable String runId) {
        aiAgentRuntime.cancel(runId);
        return ApiResponse.success(null);
    }

    @DeleteMapping("/runs/{runId}")
    public ApiResponse<Void> deleteRun(@PathVariable String runId) {
        aiAgentRuntime.deleteRun(runId);
        return ApiResponse.success(null);
    }
}
