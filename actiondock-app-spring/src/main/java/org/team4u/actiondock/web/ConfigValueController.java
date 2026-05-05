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
import org.team4u.actiondock.configvalue.ConfigValueUsageAnalysisService;
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
    public ApiResponse<List<ConfigValueView>> list() {
        return ApiResponse.success(configValueApplicationService.list().stream().map(ConfigValueController::toView).toList());
    }

    /**
     * 根据键查询配置值详情。
     *
     * @param key 配置键
     * @return API 响应，包含配置值
     */
    @GetMapping("/{key}")
    public ApiResponse<ConfigValueDetailView> detail(@PathVariable String key) {
        return ApiResponse.success(toDetailView(configValueUsageAnalysisService.analyze(key)));
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

    @PostMapping("/{key}/copy-local-override")
    public ApiResponse<ConfigValueDetailView> copyLocalOverride(@PathVariable String key) {
        configValueApplicationService.copyAsLocalOverride(key);
        return ApiResponse.success(
                toDetailView(configValueUsageAnalysisService.analyze(key)),
                "已复制为本地覆盖值"
        );
    }

    @PostMapping("/{key}/restore-repository-default")
    public ApiResponse<ConfigValueDetailView> restoreRepositoryDefault(@PathVariable String key) {
        ConfigValueUsageAnalysisService.ManagedTemplate template = configValueUsageAnalysisService.resolveManagedTemplate(key);
        configValueApplicationService.restoreManagedValue(
                key,
                new ConfigValue()
                        .setKey(template.key())
                        .setValue(template.value())
                        .setDescription(template.label())
                        .setSecret(template.secret())
                        .setRepositoryId(template.repositoryId())
                        .setRepositoryToolId(template.toolId())
                        .setRepositoryVersion(template.version())
                        .setPublishMode(template.publishMode())
                        .setManaged(true)
                        .setOverridden(false)
        );
        return ApiResponse.success(
                toDetailView(configValueUsageAnalysisService.analyze(key)),
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

    private static ConfigValue toDomain(ConfigValueRequest request) {
        ConfigValueRequest value = request == null ? new ConfigValueRequest() : request;
        return new ConfigValue()
                .setKey(value.getKey())
                .setValue(value.getValue())
                .setDescription(value.getDescription())
                .setSecret(value.isSecret());
    }

    private static ConfigValueView toView(ConfigValue value) {
        boolean hasValue = value.getValue() != null && !value.getValue().isEmpty();
        boolean masked = value.isSecret() || "PLACEHOLDER".equalsIgnoreCase(value.getPublishMode());
        return new ConfigValueView()
                .setKey(value.getKey())
                .setValue(masked ? null : value.getValue())
                .setValueMasked(masked && hasValue ? "********" : null)
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

    private static ConfigValueDetailView toDetailView(ConfigValueUsageAnalysisService.ConfigValueInsight insight) {
        ConfigValue value = insight.configValue();
        boolean hasValue = value.getValue() != null && !value.getValue().isEmpty();
        return new ConfigValueDetailView(
                value.getKey(),
                value.isSecret() ? null : value.getValue(),
                (value.isSecret() || "PLACEHOLDER".equalsIgnoreCase(value.getPublishMode())) && hasValue ? "********" : null,
                hasValue,
                value.getDescription(),
                value.isSecret(),
                value.getRepositoryId(),
                value.getRepositoryToolId(),
                value.getRepositoryVersion(),
                value.getPublishMode(),
                value.isManaged(),
                value.isOverridden(),
                value.getCreatedAt(),
                value.getUpdatedAt(),
                toUsage(insight),
                toImpactScripts(insight.impactedScripts()),
                insight.origin() == null ? null : toOrigin(insight.origin()),
                new ConfigValueDetailView.AvailableActions(
                        insight.availableActions().canCopyAsLocalOverride(),
                        insight.availableActions().canRestoreRepositoryDefault()
                )
        );
    }

    private static ConfigValueDetailView.Usage toUsage(ConfigValueUsageAnalysisService.ConfigValueInsight insight) {
        return new ConfigValueDetailView.Usage(
                toConfigReferences(insight),
                toScriptReferences(insight),
                toScheduleReferences(insight),
                toPluginConfigReferences(insight),
                toTemplateDeclarations(insight),
                toModelReferences(insight)
        );
    }

    private static List<ConfigValueDetailView.ConfigReference> toConfigReferences(ConfigValueUsageAnalysisService.ConfigValueInsight insight) {
        return insight.configReferences().stream()
                .map(item -> new ConfigValueDetailView.ConfigReference(item.key(), item.description()))
                .toList();
    }

    private static List<ConfigValueDetailView.ScriptReference> toScriptReferences(ConfigValueUsageAnalysisService.ConfigValueInsight insight) {
        return insight.scriptReferences().stream()
                .map(item -> new ConfigValueDetailView.ScriptReference(
                        item.scriptId(),
                        item.scriptName(),
                        item.scope(),
                        item.repositoryId(),
                        item.repositoryToolId(),
                        item.repositoryVersion()
                ))
                .toList();
    }

    private static List<ConfigValueDetailView.ScheduleReference> toScheduleReferences(ConfigValueUsageAnalysisService.ConfigValueInsight insight) {
        return insight.scheduleReferences().stream()
                .map(item -> new ConfigValueDetailView.ScheduleReference(
                        item.scheduleId(),
                        item.scheduleName(),
                        item.scriptId(),
                        item.scriptName()
                ))
                .toList();
    }

    private static List<ConfigValueDetailView.PluginConfigReference> toPluginConfigReferences(ConfigValueUsageAnalysisService.ConfigValueInsight insight) {
        return insight.pluginConfigReferences().stream()
                .map(item -> new ConfigValueDetailView.PluginConfigReference(
                        item.pluginId(),
                        item.pluginName(),
                        item.dependentScriptCount()
                ))
                .toList();
    }

    private static List<ConfigValueDetailView.TemplateDeclaration> toTemplateDeclarations(ConfigValueUsageAnalysisService.ConfigValueInsight insight) {
        return insight.templateDeclarations().stream()
                .map(item -> new ConfigValueDetailView.TemplateDeclaration(
                        item.repositoryId(),
                        item.repositoryName(),
                        item.toolId(),
                        item.toolName(),
                        item.version(),
                        item.label(),
                        item.secret(),
                        item.publishMode(),
                        item.defaultValue()
                ))
                .toList();
    }

    private static List<ConfigValueDetailView.ModelReference> toModelReferences(ConfigValueUsageAnalysisService.ConfigValueInsight insight) {
        return insight.modelReferences().stream()
                .map(item -> new ConfigValueDetailView.ModelReference(
                        item.modelId(),
                        item.modelName(),
                        item.modelProvider(),
                        item.referenceType()
                ))
                .toList();
    }

    private static List<ConfigValueDetailView.ImpactScript> toImpactScripts(List<ConfigValueUsageAnalysisService.ImpactScript> impacts) {
        return impacts.stream()
                .map(item -> new ConfigValueDetailView.ImpactScript(
                        item.scriptId(),
                        item.scriptName(),
                        item.scope(),
                        item.repositoryId(),
                        item.repositoryToolId(),
                        item.repositoryVersion(),
                        item.reasons()
                ))
                .toList();
    }

    private static ConfigValueDetailView.Origin toOrigin(ConfigValueUsageAnalysisService.ConfigValueOrigin origin) {
        return new ConfigValueDetailView.Origin(
                origin.repositoryId(),
                origin.repositoryName(),
                origin.toolId(),
                origin.toolName(),
                origin.version()
        );
    }
}
