package org.team4u.actiondock.web;

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
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
}
