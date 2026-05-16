package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.ExecutionPreset;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.port.ExecutionPresetRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 执行参数预设应用服务，提供脚本参数预设的管理能力。
 * <p>
 * 管理预设的创建、更新、删除，支持团队成员复用常用参数配置。
 *
 * @author jay.wu
 */
public class ExecutionPresetApplicationService {

    private final ExecutionPresetRepository executionPresetRepository;

    public ExecutionPresetApplicationService(ExecutionPresetRepository executionPresetRepository) {
        this.executionPresetRepository = executionPresetRepository;
    }

    /**
     * 查询指定脚本的所有参数预设。
     *
     * @param scriptId 脚本 ID
     * @return 该脚本关联的预设列表
     */
    public List<ExecutionPreset> list(String scriptId) {
        return executionPresetRepository.findByScriptId(scriptId);
    }

    /**
     * 根据 ID 获取参数预设。
     *
     * @param presetId 预设 ID
     * @return 预设
     * @throws IllegalArgumentException 如果预设不存在
     */
    public ExecutionPreset getById(String presetId) {
        return executionPresetRepository.findById(presetId)
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.PRESET_NOT_FOUND,
                        "Preset not found: " + presetId,
                        Map.of("presetId", presetId)
                ));
    }

    /**
     * 保存参数预设（新增或更新）。
     *
     * @param scriptId 脚本 ID
     * @param preset   预设信息
     * @return 保存后的预设
     * @throws IllegalArgumentException 如果名称为空
     */
    public ExecutionPreset save(String scriptId, ExecutionPreset preset) {
        if (preset == null) {
            throw new IllegalArgumentException("预设不能为空");
        }

        String name = normalize(preset.getName(), "预设名称不能为空");
        LocalDateTime now = LocalDateTime.now();

        ExecutionPreset target;
        if (preset.getId() == null || preset.getId().isBlank()) {
            target = new ExecutionPreset()
                    .setId(UUID.randomUUID().toString())
                    .setCreatedAt(now);
        } else {
            target = getById(preset.getId());
            ensurePresetBelongsToScript(target, scriptId);
            ensureEditable(target);
        }

        target.setScriptId(scriptId)
                .setName(name)
                .setInput(preset.getInput())
                .setUpdatedAt(now);

        return executionPresetRepository.save(target);
    }

    /**
     * 删除指定脚本下的参数预设。
     *
     * @param scriptId 脚本 ID
     * @param presetId 预设 ID
     * @throws IllegalArgumentException 如果预设不存在或不属于该脚本
     */
    public void delete(String scriptId, String presetId) {
        ExecutionPreset preset = getById(presetId);
        ensurePresetBelongsToScript(preset, scriptId);
        ensureEditable(preset);
        executionPresetRepository.deleteById(presetId);
    }

    private static void ensurePresetBelongsToScript(ExecutionPreset preset, String scriptId) {
        if (!preset.getScriptId().equals(scriptId)) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.PRESET_SCRIPT_MISMATCH,
                    "Preset does not belong to script: " + preset.getId(),
                    Map.of("presetId", preset.getId(), "scriptId", scriptId)
            );
        }
    }

    private static void ensureEditable(ExecutionPreset preset) {
        if (!preset.isEditable()) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.PRESET_NOT_EDITABLE,
                    "托管预设不允许直接修改: " + preset.getId(),
                    Map.of("presetId", preset.getId())
            );
        }
    }

    private static String normalize(String value, String message) {
        return ApplicationServiceSupport.normalize(value, message);
    }
}
