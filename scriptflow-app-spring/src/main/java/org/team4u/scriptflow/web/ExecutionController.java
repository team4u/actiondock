package org.team4u.scriptflow.web;

import org.springframework.web.bind.annotation.*;
import org.team4u.scriptflow.application.ExecutionApplicationService;
import org.team4u.scriptflow.application.ExecutionOutputProjector;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.domain.model.ExecutionRecord;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.SubmitMode;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/executions")
public class ExecutionController {
    private final ExecutionApplicationService executionApplicationService;
    private final ScriptApplicationService scriptApplicationService;
    private final ExecutionOutputProjector executionOutputProjector;

    public ExecutionController(ExecutionApplicationService executionApplicationService,
                               ScriptApplicationService scriptApplicationService) {
        this.executionApplicationService = executionApplicationService;
        this.scriptApplicationService = scriptApplicationService;
        this.executionOutputProjector = new ExecutionOutputProjector();
    }

    @PostMapping
    public ApiResponse<ExecutionResponse> execute(@RequestBody ExecuteRequest request) {
        ExecutionRecord record = executionApplicationService.execute(
                request.getScriptId(),
                request.getInput(),
                request.getMode()
        );
        ScriptDefinition scriptDefinition = scriptApplicationService.get(request.getScriptId());
        return ApiResponse.success(
                toResponse(record, scriptDefinition, request.getResponseView()),
                "已受理"
        );
    }

    @GetMapping("/{id}")
    public ApiResponse<ExecutionRecord> detail(@PathVariable String id) {
        return ApiResponse.success(executionApplicationService.get(id));
    }

    @GetMapping
    public ApiResponse<List<ExecutionRecord>> list(@RequestParam(required = false) String scriptId) {
        return ApiResponse.success(executionApplicationService.list(scriptId));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable String id) {
        executionApplicationService.delete(id);
        return ApiResponse.success(null, "删除成功");
    }

    @DeleteMapping
    public ApiResponse<Void> clear(@RequestParam(required = false) String scriptId) {
        executionApplicationService.clear(scriptId);
        return ApiResponse.success(null, "清空成功");
    }

    private ExecutionResponse toResponse(ExecutionRecord record,
                                         ScriptDefinition scriptDefinition,
                                         ExecutionResponseView responseView) {
        Map<String, Object> rawOutput = copy(record.getOutput());
        ExecutionResponse.DebugPayload debugPayload = responseView == ExecutionResponseView.DEBUG
                ? new ExecutionResponse.DebugPayload(copy(record.getInput()), rawOutput)
                : null;
        return new ExecutionResponse(
                record.getId(),
                record.getScriptId(),
                record.getStatus(),
                record.getSubmitMode(),
                executionOutputProjector.project(rawOutput, scriptDefinition.getOutputSchema()),
                record.getErrorMessage(),
                record.getCreatedAt(),
                record.getStartedAt(),
                record.getFinishedAt(),
                debugPayload
        );
    }

    private Map<String, Object> copy(Map<String, Object> value) {
        return value == null ? new LinkedHashMap<>() : new LinkedHashMap<>(value);
    }

    public static class ExecuteRequest {
        private String scriptId;
        private Map<String, Object> input;
        private SubmitMode mode = SubmitMode.SYNC;
        private ExecutionResponseView responseView = ExecutionResponseView.RESULT;

        public String getScriptId() {
            return scriptId;
        }

        public void setScriptId(String scriptId) {
            this.scriptId = scriptId;
        }

        public Map<String, Object> getInput() {
            return input;
        }

        public void setInput(Map<String, Object> input) {
            this.input = input;
        }

        public SubmitMode getMode() {
            return mode;
        }

        public void setMode(SubmitMode mode) {
            this.mode = mode;
        }

        public ExecutionResponseView getResponseView() {
            return responseView;
        }

        public void setResponseView(ExecutionResponseView responseView) {
            this.responseView = responseView == null ? ExecutionResponseView.RESULT : responseView;
        }
    }
}
