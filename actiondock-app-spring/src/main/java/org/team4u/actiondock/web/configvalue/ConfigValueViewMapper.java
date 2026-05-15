package org.team4u.actiondock.web.configvalue;

import org.team4u.actiondock.configvalue.ConfigValueUsageAnalysisService;
import org.team4u.actiondock.domain.model.ConfigValue;

import java.util.List;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.PUBLISH_MODE_PLACEHOLDER;

/**
 * 配置值视图映射器，将领域模型转换为 API 响应视图。
 */
class ConfigValueViewMapper {

    static ConfigValue toDomain(ConfigValueRequest request) {
        ConfigValueRequest value = request == null ? new ConfigValueRequest() : request;
        return new ConfigValue()
                .setKey(value.getKey())
                .setValue(value.getValue())
                .setDescription(value.getDescription())
                .setSecret(value.isSecret());
    }

    static ConfigValueView toView(ConfigValue value) {
        boolean hasValue = value.getValue() != null && !value.getValue().isEmpty();
        boolean masked = value.isSecret() || PUBLISH_MODE_PLACEHOLDER.equalsIgnoreCase(value.getPublishMode());
        return new ConfigValueView()
                .setKey(value.getKey())
                .setValue(masked ? null : value.getValue())
                .setValueMasked(masked && hasValue ? "********" : null)
                .setHasValue(hasValue)
                .setDescription(value.getDescription())
                .setSecret(value.isSecret())
                .setRepositoryId(value.getRepositoryId())
                .setRepositoryScriptId(value.getRepositoryScriptId())
                .setRepositoryVersion(value.getRepositoryVersion())
                .setPublishMode(value.getPublishMode())
                .setManaged(value.isManaged())
                .setOverridden(value.isOverridden())
                .setCreatedAt(value.getCreatedAt())
                .setUpdatedAt(value.getUpdatedAt());
    }

    static ConfigValueDetailView toDetailView(ConfigValueUsageAnalysisService.ConfigValueInsight insight) {
        ConfigValue value = insight.configValue();
        boolean hasValue = value.getValue() != null && !value.getValue().isEmpty();
        return new ConfigValueDetailView(
                value.getKey(),
                value.isSecret() ? null : value.getValue(),
                (value.isSecret() || PUBLISH_MODE_PLACEHOLDER.equalsIgnoreCase(value.getPublishMode())) && hasValue ? "********" : null,
                hasValue,
                value.getDescription(),
                value.isSecret(),
                value.getRepositoryId(),
                value.getRepositoryScriptId(),
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
                insight.configReferences().stream()
                        .map(item -> new ConfigValueDetailView.ConfigReference(item.key(), item.description()))
                        .toList(),
                insight.scriptReferences().stream()
                        .map(item -> new ConfigValueDetailView.ScriptReference(
                                item.scriptId(), item.scriptName(), item.scope(),
                                item.repositoryId(), item.repositoryScriptId(), item.repositoryVersion()))
                        .toList(),
                insight.scheduleReferences().stream()
                        .map(item -> new ConfigValueDetailView.ScheduleReference(
                                item.scheduleId(), item.scheduleName(), item.scriptId(), item.scriptName()))
                        .toList(),
                insight.pluginConfigReferences().stream()
                        .map(item -> new ConfigValueDetailView.PluginConfigReference(
                                item.pluginId(), item.pluginName(), item.dependentScriptCount()))
                        .toList(),
                insight.templateDeclarations().stream()
                        .map(item -> new ConfigValueDetailView.TemplateDeclaration(
                                item.repositoryId(), item.repositoryName(), item.repositoryScriptId(), item.scriptName(),
                                item.version(), item.label(), item.secret(), item.publishMode(), item.defaultValue()))
                        .toList(),
                insight.modelReferences().stream()
                        .map(item -> new ConfigValueDetailView.ModelReference(
                                item.modelId(), item.modelName(), item.modelProvider(), item.referenceType()))
                        .toList()
        );
    }

    private static List<ConfigValueDetailView.ImpactScript> toImpactScripts(List<ConfigValueUsageAnalysisService.ImpactScript> impacts) {
        return impacts.stream()
                .map(item -> new ConfigValueDetailView.ImpactScript(
                        item.scriptId(), item.scriptName(), item.scope(),
                        item.repositoryId(), item.repositoryScriptId(), item.repositoryVersion(), item.reasons()))
                .toList();
    }

    private static ConfigValueDetailView.Origin toOrigin(ConfigValueUsageAnalysisService.ConfigValueOrigin origin) {
        return new ConfigValueDetailView.Origin(
                origin.repositoryId(), origin.repositoryName(),
                origin.repositoryScriptId(), origin.scriptName(), origin.version());
    }
}
