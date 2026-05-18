package org.team4u.actiondock.web.configvalue;

import java.time.LocalDateTime;
import java.util.List;

public record ConfigValueDetailView(
        String key,
        String value,
        String valueMasked,
        boolean hasValue,
        String description,
        boolean secret,
        String repositoryId,
        String repositoryScriptId,
        String repositoryVersion,
        String publishMode,
        boolean managed,
        boolean overridden,
        LocalDateTime createdAt,
        LocalDateTime updatedAt,
        Usage usage,
        List<ImpactScript> impactedScripts,
        Origin origin,
        AvailableActions availableActions
) {
    public record Usage(
            List<ConfigReference> configReferences,
            List<ScriptReference> scriptReferences,
            List<ScheduleReference> scheduleReferences,
            List<PluginConfigReference> pluginConfigReferences,
            List<TemplateDeclaration> templateDeclarations,
            List<ModelReference> modelReferences
    ) {
    }

    public record ModelReference(String modelId, String modelName, String modelProvider, String referenceType) {
    }

    public record ConfigReference(String key, String description) {
    }

    public record ScriptReference(String scriptId,
                                  String scriptName,
                                  String scope,
                                  String repositoryId,
                                  String repositoryScriptId,
                                  String repositoryVersion) {
    }

    public record ScheduleReference(String scheduleId, String scheduleName, String scriptId, String scriptName) {
    }

    public record PluginConfigReference(String pluginId, String pluginName, int dependentScriptCount) {
    }

    public record TemplateDeclaration(String repositoryId,
                                      String repositoryName,
                                      String repositoryScriptId,
                                      String scriptName,
                                      String version,
                                      String label,
                                      boolean secret,
                                      String publishMode,
                                      String defaultValue) {
    }

    public record ImpactScript(String scriptId,
                               String scriptName,
                               String scope,
                               String repositoryId,
                               String repositoryScriptId,
                               String repositoryVersion,
                               List<String> reasons) {
    }

    public record Origin(String repositoryId,
                         String repositoryName,
                         String repositoryScriptId,
                         String scriptName,
                         String version) {
    }

    public record AvailableActions(boolean canCopyAsLocalOverride, boolean canRestoreRepositoryDefault) {
    }
}
