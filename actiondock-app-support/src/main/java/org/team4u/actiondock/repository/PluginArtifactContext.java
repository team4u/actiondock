package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.RepositoryDefinition;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

import java.nio.file.Path;

public record PluginArtifactContext(
        RepositoryDefinition repository,
        RepositoryPluginDetail detail,
        Path repositoryRoot
) {
}
