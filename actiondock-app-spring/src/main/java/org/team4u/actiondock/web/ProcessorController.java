package org.team4u.actiondock.web;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.application.InvalidExecutionInputException;
import org.team4u.actiondock.application.ProcessorApplicationService;
import org.team4u.actiondock.application.ScriptSchemaSupport;
import org.team4u.actiondock.domain.model.ProcessorResult;

@RestController
@RequestMapping("/api/processors")
public class ProcessorController {
    private final ProcessorApplicationService processorApplicationService;
    private final ScriptSchemaSupport scriptSchemaSupport = new ScriptSchemaSupport();

    public ProcessorController(ProcessorApplicationService processorApplicationService) {
        this.processorApplicationService = processorApplicationService;
    }

    @PostMapping("/test")
    public ApiResponse<ProcessorTestResultView> test(@RequestBody ProcessorTestRequest request) {
        ProcessorResult result = processorApplicationService.test(request.getProcessor(), request.getContext());
        boolean schemaValid = true;
        java.util.List<org.team4u.actiondock.application.SchemaFieldError> fieldErrors = java.util.List.of();
        if (result.isSuccess() && request.getExpectedOutputSchema() != null && !request.getExpectedOutputSchema().isEmpty()) {
            try {
                scriptSchemaSupport.validateInput("processor", result.getOutput(), request.getExpectedOutputSchema());
            } catch (InvalidExecutionInputException exception) {
                schemaValid = false;
                fieldErrors = exception.getFieldErrors();
            }
        }
        return ApiResponse.success(new ProcessorTestResultView(
                result.isSuccess(),
                result.getOutput(),
                result.getErrorMessage(),
                result.getLogs(),
                result.getDurationMs(),
                schemaValid,
                fieldErrors
        ));
    }
}
