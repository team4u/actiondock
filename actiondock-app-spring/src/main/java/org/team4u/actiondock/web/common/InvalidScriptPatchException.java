package org.team4u.actiondock.web.common;

import java.util.List;

public class InvalidScriptPatchException extends IllegalArgumentException {
    private final String scriptId;
    private final List<String> rejectedFields;
    private final List<String> allowedFields;

    public InvalidScriptPatchException(String scriptId,
                                       List<String> rejectedFields,
                                       List<String> allowedFields) {
        super("脚本 Patch 仅允许更新以下字段: " + String.join(", ", allowedFields));
        this.scriptId = scriptId;
        this.rejectedFields = rejectedFields == null ? List.of() : List.copyOf(rejectedFields);
        this.allowedFields = allowedFields == null ? List.of() : List.copyOf(allowedFields);
    }

    public String getScriptId() {
        return scriptId;
    }

    public List<String> getRejectedFields() {
        return rejectedFields;
    }

    public List<String> getAllowedFields() {
        return allowedFields;
    }
}
