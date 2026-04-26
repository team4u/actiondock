package org.team4u.actiondock.web;

import org.team4u.actiondock.domain.model.ExecutionPreset;

/**
 * 执行参数预设视图映射器，将预设实体转换为 API 视图。
 *
 * @author jay.wu
 */
final class ExecutionPresetViewMapper {

    ExecutionPresetView toView(ExecutionPreset preset) {
        return new ExecutionPresetView(
                preset.getId(),
                preset.getScriptId(),
                preset.getName(),
                preset.getInput(),
                preset.getCreatedAt(),
                preset.getUpdatedAt()
        );
    }
}
