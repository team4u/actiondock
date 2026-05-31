package org.team4u.actiondock.web.configvalue;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.configvalue.ConfigValueUsageAnalysisService;
import org.team4u.actiondock.web.common.ApiResponse;
import org.team4u.actiondock.web.common.IntentFilter;

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
    private final ConfigValueUsageAnalysisService configValueUsageAnalysisService;

    public ConfigValueController(ConfigValueApplicationService configValueApplicationService,
                                 ConfigValueUsageAnalysisService configValueUsageAnalysisService) {
        this.configValueApplicationService = configValueApplicationService;
        this.configValueUsageAnalysisService = configValueUsageAnalysisService;
    }

    /**
     * 查询所有全局配置值列表。
     *
     * @return API 响应，包含配置值列表
     */
    @GetMapping
    public ApiResponse<List<ConfigValueView>> list(@RequestParam(required = false) String intent) {
        return ApiResponse.success(IntentFilter.filter(
                configValueApplicationService.list().stream().map(ConfigValueViewMapper::toView).toList(),
                intent,
                ConfigValueView::getKey,
                ConfigValueView::getDescription,
                ConfigValueView::getRepositoryId,
                ConfigValueView::getRepositoryScriptId,
                ConfigValueView::getRepositoryVersion,
                ConfigValueView::getPublishMode
        ));
    }

    /**
     * 根据键查询配置值详情。
     *
     * @param key 配置键
     * @return API 响应，包含配置值
     */
    @GetMapping("/{key}")
    public ApiResponse<ConfigValueDetailView> detail(@PathVariable String key) {
        return ApiResponse.success(ConfigValueViewMapper.toDetailView(configValueUsageAnalysisService.analyze(key)));
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
                ConfigValueViewMapper.toView(configValueApplicationService.create(ConfigValueViewMapper.toDomain(request))),
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
                ConfigValueViewMapper.toView(configValueApplicationService.update(key, ConfigValueViewMapper.toDomain(request), request != null && request.isPreserveValue())),
                "配置值已更新"
        );
    }

    @PostMapping("/{key}/copy-local-override")
    public ApiResponse<ConfigValueDetailView> copyLocalOverride(@PathVariable String key) {
        configValueApplicationService.copyAsLocalOverride(key);
        return ApiResponse.success(
                ConfigValueViewMapper.toDetailView(configValueUsageAnalysisService.analyze(key)),
                "已复制为本地覆盖值"
        );
    }

    @PostMapping("/{key}/restore-repository-default")
    public ApiResponse<ConfigValueDetailView> restoreRepositoryDefault(@PathVariable String key) {
        ConfigValueUsageAnalysisService.ManagedTemplate template = configValueUsageAnalysisService.resolveManagedTemplate(key);
        configValueApplicationService.restoreManagedValue(key, template.toConfigValue());
        return ApiResponse.success(
                ConfigValueViewMapper.toDetailView(configValueUsageAnalysisService.analyze(key)),
                "已恢复仓库默认值"
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
}
