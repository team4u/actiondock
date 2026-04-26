package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.ExecutionPreset;
import org.team4u.actiondock.domain.port.ExecutionPresetRepository;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
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
                .orElseThrow(() -> new IllegalArgumentException("Preset not found: " + presetId));
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
        executionPresetRepository.deleteById(presetId);
    }

    /**
     * 清除指定脚本下的所有参数预设。
     *
     * @param scriptId 脚本 ID
     */
    public void clearByScriptId(String scriptId) {
        executionPresetRepository.deleteByScriptId(scriptId);
    }

    private void ensurePresetBelongsToScript(ExecutionPreset preset, String scriptId) {
        if (!preset.getScriptId().equals(scriptId)) {
            throw new IllegalArgumentException("Preset does not belong to script: " + preset.getId());
        }
    }

    private String normalize(String value, String message) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(message);
        }
        return value.trim();
    }
}
