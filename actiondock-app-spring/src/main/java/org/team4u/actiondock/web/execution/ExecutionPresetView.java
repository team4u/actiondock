package org.team4u.actiondock.web.execution;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * 执行参数预设视图。
 *
 * @author jay.wu
 */
public record ExecutionPresetView(
        String id,
        String scriptId,
        String name,
        Map<String, Object> input,
        boolean managed,
        boolean editable,
        String repositoryId,
        String repositoryPackageId,
        String repositoryVersion,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
}
