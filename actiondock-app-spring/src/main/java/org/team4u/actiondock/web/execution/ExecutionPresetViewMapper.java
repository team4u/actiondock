package org.team4u.actiondock.web.execution;

import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.ExecutionPreset;

/**
 * 执行参数预设视图映射器，将预设实体转换为 API 视图。
 *
 * @author jay.wu
 */
@Component
public class ExecutionPresetViewMapper {

    public ExecutionPresetView toView(ExecutionPreset preset) {
        return new ExecutionPresetView(
                preset.getId(),
                preset.getScriptId(),
                preset.getName(),
                preset.getInput(),
                preset.isManaged(),
                preset.isEditable(),
                preset.getRepositoryId(),
                preset.getRepositoryPackageId(),
                preset.getRepositoryVersion(),
                preset.getCreatedAt(),
                preset.getUpdatedAt()
        );
    }
}
