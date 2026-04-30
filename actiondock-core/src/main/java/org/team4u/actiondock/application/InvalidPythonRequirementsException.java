package org.team4u.actiondock.application;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Python 依赖声明无效时抛出的异常。
 */
public class InvalidPythonRequirementsException extends IllegalArgumentException {
    private final String code;
    private final String scriptId;
    private final int lineNumber;
    private final String lineContent;
    private final String reason;

    public InvalidPythonRequirementsException(String code,
                                             String scriptId,
                                             int lineNumber,
                                             String lineContent,
                                             String reason) {
        super(buildMessage(scriptId, lineNumber, reason));
        this.code = code == null || code.isBlank() ? "INVALID_PYTHON_REQUIREMENTS" : code;
        this.scriptId = scriptId;
        this.lineNumber = lineNumber;
        this.lineContent = lineContent;
        this.reason = reason;
    }

    public String getCode() {
        return code;
    }

    public String getScriptId() {
        return scriptId;
    }

    public int getLineNumber() {
        return lineNumber;
    }

    public String getLineContent() {
        return lineContent;
    }

    public String getReason() {
        return reason;
    }

    public Map<String, Object> toResponseData() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("code", code);
        data.put("scriptId", scriptId);
        data.put("lineNumber", lineNumber);
        data.put("lineContent", lineContent);
        data.put("reason", reason);
        return data;
    }

    private static String buildMessage(String scriptId, int lineNumber, String reason) {
        String prefix = scriptId == null || scriptId.isBlank()
                ? "Python 依赖声明无效"
                : "脚本 " + scriptId + " 的 Python 依赖声明无效";
        if (lineNumber > 0) {
            return prefix + "（第 " + lineNumber + " 行）: " + reason;
        }
        return prefix + ": " + reason;
    }
}
