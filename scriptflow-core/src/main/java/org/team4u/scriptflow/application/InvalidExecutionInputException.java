package org.team4u.scriptflow.application;

import java.util.List;

public class InvalidExecutionInputException extends IllegalArgumentException {
    private final String code;
    private final String scriptId;
    private final List<SchemaFieldError> fieldErrors;

    public InvalidExecutionInputException(String scriptId, List<SchemaFieldError> fieldErrors) {
        super("输入参数校验失败");
        this.code = "INVALID_ARGUMENTS";
        this.scriptId = scriptId;
        this.fieldErrors = fieldErrors == null ? List.of() : List.copyOf(fieldErrors);
    }

    public String getCode() {
        return code;
    }

    public String getScriptId() {
        return scriptId;
    }

    public List<SchemaFieldError> getFieldErrors() {
        return fieldErrors;
    }
}
