package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.model.ScriptScope;

import java.nio.file.Path;
import java.util.List;
import java.util.Objects;

final class ToolRepositoryPublisher {
    private final RepositoryCatalogService catalog;
    private final RepositoryToolService toolService;

    ToolRepositoryPublisher(RepositoryCatalogService catalog, RepositoryToolService toolService) {
        this.catalog = catalog;
        this.toolService = toolService;
    }

    RepositoryCatalogService.RepositoryToolDescriptor publish(String repositoryId,
                                                              RepositoryCatalogService.RepositoryPublishRequest request) {
        WritableRepositorySession session = catalog.openWritableRepositorySession(repositoryId);
        RepositoryDefinition repository = session.repository();

        ScriptDefinition sourceScript = catalog.scriptApplicationService().get(catalog.normalize(request.scriptId(), "scriptId 不能为空"));
        if (sourceScript.getScope() == ScriptScope.DEVELOPMENT
                && Objects.equals(sourceScript.getRepositoryId(), repositoryId)
                && !request.force()) {
            toolService.assertDevelopmentPublishSafe(sourceScript, repository);
        }

        ScriptDefinition script = catalog.scriptApplicationService().getPublished(sourceScript.getId());
        catalog.assertPackagingConstraints(script);

        String toolId = catalog.normalize(request.toolId(), "toolId 不能为空");
        String version = catalog.normalize(request.version(), "version 不能为空");
        List<ScriptSchedule> selectedSchedules = toolService.resolvePublishSchedules(script.getId(), request.scheduleIds());
        List<ScriptDependency> scriptDependencies = toolService.resolveToolScriptDependencies(repositoryId, script, request);
        PublishedScriptSnapshot snapshot = script.getPublishedSnapshot();
        RepositoryPublishConfigResolver.PublishConfigResolution configResolution = RepositoryPublishConfigResolver.resolve(
                snapshot == null ? script.getSource() : snapshot.getSource(),
                selectedSchedules.stream().map(ScriptSchedule::getInput).toList(),
                catalog.configValueRepository().findAll()
        );
        List<RepositoryCatalogService.ConfigTemplateItem> configTemplates = toolService.buildConfigTemplate(configResolution, request.configItems());
        List<RepositoryCatalogService.ScheduleTemplateItem> scheduleTemplates = toolService.buildScheduleTemplate(selectedSchedules);

        RepositoryToolService.assertToolVersionAvailable(repositoryId, session.index(), toolId, version);
        Path toolDir = session.root().resolve("tools").resolve(toolId);
        toolService.writeToolFiles(toolDir, toolId, script, request, configTemplates, scheduleTemplates, scriptDependencies);
        toolService.updateRepositoryIndex(session.root(), repository, toolId, script, request);
        session.commitPublishedAsset(toolId, version, request.releaseNotes());

        RepositoryCatalogService.RepositoryToolDetail publishedDetail = catalog.getRepositoryTool(repositoryId, toolId);
        if (sourceScript.getScope() == ScriptScope.DEVELOPMENT
                && Objects.equals(sourceScript.getRepositoryId(), repositoryId)
                && Objects.equals(sourceScript.getRepositoryToolId(), toolId)) {
            toolService.updateDevelopmentSourceMetadata(sourceScript, repository, publishedDetail);
        }
        return publishedDetail.descriptor();
    }
}
