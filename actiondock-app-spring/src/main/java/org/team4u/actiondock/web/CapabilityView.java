package org.team4u.actiondock.web;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 统一能力视图，当前由脚本定义映射而来。
 */
public record CapabilityView(
        String id,
        String kind,
        String name,
        String runtime,
        String source,
        String status,
        Integer version,
        String scope,
        String description,
        String owner,
        List<String> tags,
        Boolean hasUnpublishedChanges,
        CapabilityBindingView draftBinding,
        CapabilityBindingView publishedBinding,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
    public record CapabilityBindingView(
            String version,
            String name,
            String source,
            String runtime,
            Map<String, Object> inputSchema,
            Map<String, Object> outputSchema,
            String packaging,
            String pythonRequirements,
            String description,
            String owner,
            List<String> tags,
            List<?> scriptDependencies,
            List<?> pluginDependencies,
            List<?> aiDependencies
    ) {
    }
}
