package org.team4u.scriptflow.application;

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
