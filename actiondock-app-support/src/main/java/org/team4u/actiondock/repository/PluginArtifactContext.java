package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.RepositoryDefinition;

import java.nio.file.Path;

public record PluginArtifactContext(
        RepositoryDefinition repository,
        RepositoryCatalogService.RepositoryPluginDetail detail,
        Path repositoryRoot
) {
}
