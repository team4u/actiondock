package org.team4u.actiondock.application;

import java.util.List;

/**
 * 无效执行输入异常，当脚本输入参数不符合模式定义时抛出。
 *
 * @author jay.wu
 */
public class InvalidExecutionInputException extends IllegalArgumentException {
    private final String code;
    private final String scriptId;
    private final List<SchemaFieldError> fieldErrors;

    /**
     * 创建无效执行输入异常。
     *
     * @param scriptId    脚本 ID
     * @param fieldErrors 字段校验错误列表
     */
    public InvalidExecutionInputException(String scriptId, List<SchemaFieldError> fieldErrors) {
        this(scriptId, fieldErrors, null, null);
    }

    public InvalidExecutionInputException(String scriptId,
                                          List<SchemaFieldError> fieldErrors,
                                          String message,
                                          Throwable cause) {
        super(message == null || message.isBlank() ? buildMessage(scriptId, fieldErrors) : message, cause);
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

    private static String buildMessage(String scriptId, List<SchemaFieldError> fieldErrors) {
        List<SchemaFieldError> errors = fieldErrors == null ? List.of() : List.copyOf(fieldErrors);
        String prefix = (scriptId == null || scriptId.isBlank())
                ? "输入参数校验失败"
                : "脚本 " + scriptId + " 输入参数校验失败";
        if (errors.isEmpty()) {
            return prefix;
        }
        String summary = errors.stream()
                .limit(3)
                .map(SchemaFieldError::message)
                .reduce((left, right) -> left + "；" + right)
                .orElse("");
        if (errors.size() > 3) {
            summary = summary + "；其余 " + (errors.size() - 3) + " 个字段校验失败";
        }
        return prefix + ": " + summary;
    }
}
