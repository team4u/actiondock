package org.team4u.actiondock.web;

import java.util.Map;

/**
 * 对统一能力草稿绑定应用的 merge patch 请求。
 */
public class CapabilityPatchRequest {
    private Map<String, Object> draftBinding;

    public Map<String, Object> getDraftBinding() {
        return draftBinding;
    }

    public void setDraftBinding(Map<String, Object> draftBinding) {
        this.draftBinding = draftBinding;
    }
}
