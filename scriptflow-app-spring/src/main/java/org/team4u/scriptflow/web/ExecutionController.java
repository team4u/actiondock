package org.team4u.scriptflow.web;

import org.springframework.web.bind.annotation.*;
import org.team4u.scriptflow.application.ExecutionApplicationService;
import org.team4u.scriptflow.domain.model.ExecutionRecord;
import org.team4u.scriptflow.domain.model.SubmitMode;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/executions")
public class ExecutionController {
    private final ExecutionApplicationService executionApplicationService;

    public ExecutionController(ExecutionApplicationService executionApplicationService) {
        this.executionApplicationService = executionApplicationService;
    }

    @PostMapping
    public ApiResponse<ExecutionRecord> execute(@RequestBody ExecuteRequest request) {
        return ApiResponse.success(
                executionApplicationService.execute(request.getScriptId(), request.getInput(), request.getMode()),
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

    public static class ExecuteRequest {
        private String scriptId;
        private Map<String, Object> input;
        private SubmitMode mode = SubmitMode.SYNC;

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
    }
}
