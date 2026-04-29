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
    private final RepositoryCatalogService service;

    ToolRepositoryPublisher(RepositoryCatalogService service) {
        this.service = service;
    }

    RepositoryCatalogService.RepositoryToolDescriptor publish(String repositoryId,
                                                              RepositoryCatalogService.RepositoryPublishRequest request) {
        WritableRepositorySession session = service.openWritableRepositorySession(repositoryId);
        RepositoryDefinition repository = session.repository();

        ScriptDefinition sourceScript = service.scriptApplicationService().get(service.normalize(request.scriptId(), "scriptId 不能为空"));
        if (sourceScript.getScope() == ScriptScope.DEVELOPMENT
                && Objects.equals(sourceScript.getRepositoryId(), repositoryId)
                && !request.force()) {
            service.assertDevelopmentPublishSafe(sourceScript, repository);
        }

        ScriptDefinition script = service.scriptApplicationService().getPublished(sourceScript.getId());
        service.assertPackagingConstraints(script);

        String toolId = service.normalize(request.toolId(), "toolId 不能为空");
        String version = service.normalize(request.version(), "version 不能为空");
        List<ScriptSchedule> selectedSchedules = service.resolvePublishSchedules(script.getId(), request.scheduleIds());
        List<ScriptDependency> scriptDependencies = service.resolveToolScriptDependencies(repositoryId, script, request);
        PublishedScriptSnapshot snapshot = script.getPublishedSnapshot();
        RepositoryPublishConfigResolver.PublishConfigResolution configResolution = RepositoryPublishConfigResolver.resolve(
                snapshot == null ? script.getSource() : snapshot.getSource(),
                selectedSchedules.stream().map(ScriptSchedule::getInput).toList(),
                service.configValueRepository().findAll()
        );
        List<RepositoryCatalogService.ConfigTemplateItem> configTemplates = service.buildConfigTemplate(configResolution, request.configItems());
        List<RepositoryCatalogService.ScheduleTemplateItem> scheduleTemplates = service.buildScheduleTemplate(selectedSchedules);

        RepositoryCatalogService.assertToolVersionAvailable(repositoryId, session.index(), toolId, version);
        Path toolDir = session.root().resolve("tools").resolve(toolId);
        service.writeToolFiles(toolDir, toolId, script, request, configTemplates, scheduleTemplates, scriptDependencies);
        service.updateRepositoryIndex(session.root(), repository, toolId, script, request);
        session.commitPublishedAsset(toolId, version, request.releaseNotes());

        RepositoryCatalogService.RepositoryToolDetail publishedDetail = service.getRepositoryTool(repositoryId, toolId);
        if (sourceScript.getScope() == ScriptScope.DEVELOPMENT
                && Objects.equals(sourceScript.getRepositoryId(), repositoryId)
                && Objects.equals(sourceScript.getRepositoryToolId(), toolId)) {
            service.updateDevelopmentSourceMetadata(sourceScript, repository, publishedDetail);
        }
        return publishedDetail.descriptor();
    }
}
