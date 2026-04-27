package org.team4u.actiondock.web;

import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.ai.workbench.AiWorkbenchCommand;
import org.team4u.actiondock.ai.workbench.AiWorkbenchResult;
import org.team4u.actiondock.ai.workbench.AiWorkbenchService;

@RestController
@RequestMapping("/api/ai/workbench")
public class AiWorkbenchController {
    private final AiWorkbenchService workbenchService;

    public AiWorkbenchController(AiWorkbenchService workbenchService) {
        this.workbenchService = workbenchService;
    }

    @PostMapping("/scripts/generate")
    public ApiResponse<AiWorkbenchResult> generateScript(@RequestBody(required = false) AiWorkbenchCommand command) {
        return ApiResponse.success(workbenchService.generateScript(command));
    }

    @PostMapping("/scripts/improve")
    public ApiResponse<AiWorkbenchResult> improveScript(@RequestBody(required = false) AiWorkbenchCommand command) {
        return ApiResponse.success(workbenchService.improveScript(command));
    }

    @PostMapping("/schemas/improve")
    public ApiResponse<AiWorkbenchResult> improveSchema(@RequestBody(required = false) AiWorkbenchCommand command) {
        return ApiResponse.success(workbenchService.improveSchema(command));
    }

    @PostMapping("/executions/{executionId}/diagnose")
    public ApiResponse<AiWorkbenchResult> diagnoseExecution(@PathVariable String executionId,
                                                            @RequestBody(required = false) AiWorkbenchCommand command) {
        return ApiResponse.success(workbenchService.diagnoseExecution(executionId, command));
    }

    @PostMapping("/scripts/{scriptId}/review-publish")
    public ApiResponse<AiWorkbenchResult> reviewBeforePublish(@PathVariable String scriptId,
                                                              @RequestBody(required = false) AiWorkbenchCommand command) {
        return ApiResponse.success(workbenchService.reviewBeforePublish(scriptId, command));
    }

    @PostMapping("/scripts/{scriptId}/release-notes")
    public ApiResponse<AiWorkbenchResult> generateReleaseNotes(@PathVariable String scriptId,
                                                               @RequestBody(required = false) AiWorkbenchCommand command) {
        return ApiResponse.success(workbenchService.generateReleaseNotes(scriptId, command));
    }
}
