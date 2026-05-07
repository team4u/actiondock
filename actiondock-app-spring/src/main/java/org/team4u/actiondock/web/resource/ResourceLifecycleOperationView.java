package org.team4u.actiondock.web.resource;

/**
 * 资源生命周期操作结果。
 */
public record ResourceLifecycleOperationView(
        String resourceType,
        String operation,
        String repositoryId,
        String resourceId,
        String status,
        Object result
) {
}
