package org.team4u.actiondock.web;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.domain.model.ConfigValue;

import java.util.List;

/**
 * 全局配置值 REST 控制器。
 *
 * @author jay.wu
 */
@RestController
@RequestMapping("/api/config-values")
public class ConfigValueController {
    private final ConfigValueApplicationService configValueApplicationService;

    public ConfigValueController(ConfigValueApplicationService configValueApplicationService) {
        this.configValueApplicationService = configValueApplicationService;
    }

    /**
     * 查询所有全局配置值列表。
     *
     * @return API 响应，包含配置值列表
     */
    @GetMapping
    public ApiResponse<List<ConfigValueView>> list() {
        return ApiResponse.success(configValueApplicationService.list().stream().map(this::toView).toList());
    }

    /**
     * 根据键查询配置值详情。
     *
     * @param key 配置键
     * @return API 响应，包含配置值
     */
    @GetMapping("/{key}")
    public ApiResponse<ConfigValueView> detail(@PathVariable String key) {
        return ApiResponse.success(toView(configValueApplicationService.get(key)));
    }

    /**
     * 创建全局配置值。
     *
     * @param request 配置值创建请求
     * @return API 响应，包含创建后的配置值
     */
    @PostMapping
    public ApiResponse<ConfigValueView> create(@RequestBody ConfigValueRequest request) {
        return ApiResponse.success(
                toView(configValueApplicationService.create(toDomain(request))),
                "配置值已创建"
        );
    }

    /**
     * 更新指定键的配置值。
     *
     * @param key 配置键
     * @param request 配置值更新请求
     * @return API 响应，包含更新后的配置值
     */
    @PutMapping("/{key}")
    public ApiResponse<ConfigValueView> update(@PathVariable String key, @RequestBody ConfigValueRequest request) {
        return ApiResponse.success(
                toView(configValueApplicationService.update(key, toDomain(request), request != null && request.isPreserveValue())),
                "配置值已更新"
        );
    }

    /**
     * 删除指定键的配置值。
     *
     * @param key 配置键
     * @return API 响应，无数据
     */
    @DeleteMapping("/{key}")
    public ApiResponse<Void> delete(@PathVariable String key) {
        configValueApplicationService.delete(key);
        return ApiResponse.success(null, "配置值已删除");
    }

    private ConfigValue toDomain(ConfigValueRequest request) {
        ConfigValueRequest value = request == null ? new ConfigValueRequest() : request;
        return new ConfigValue()
                .setKey(value.getKey())
                .setValue(value.getValue())
                .setDescription(value.getDescription())
                .setSecret(value.isSecret());
    }

    private ConfigValueView toView(ConfigValue value) {
        boolean hasValue = value.getValue() != null && !value.getValue().isEmpty();
        return new ConfigValueView()
                .setKey(value.getKey())
                .setValue(value.isSecret() ? null : value.getValue())
                .setValueMasked(value.isSecret() && hasValue ? "********" : null)
                .setHasValue(hasValue)
                .setDescription(value.getDescription())
                .setSecret(value.isSecret())
                .setRepositoryId(value.getRepositoryId())
                .setRepositoryToolId(value.getRepositoryToolId())
                .setRepositoryVersion(value.getRepositoryVersion())
                .setPublishMode(value.getPublishMode())
                .setManaged(value.isManaged())
                .setOverridden(value.isOverridden())
                .setCreatedAt(value.getCreatedAt())
                .setUpdatedAt(value.getUpdatedAt());
    }
}
