package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.RepositoryDefinition;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

import java.nio.file.Path;

final class WritableRepositorySession {
    private final RepositoryCatalogService service;
    private final RepositoryDefinition repository;
    private final Path root;
    private final RepositoryIndexFile index;

    WritableRepositorySession(RepositoryCatalogService service,
                              RepositoryDefinition repository,
                              Path root,
                              RepositoryIndexFile index) {
        this.service = service;
        this.repository = repository;
        this.root = root;
        this.index = index;
    }

    RepositoryDefinition repository() {
        return repository;
    }

    Path root() {
        return root;
    }

    RepositoryIndexFile index() {
        return index;
    }

    void commitPublishedAsset(String assetId, String version, String releaseNotes) {
        if (REPO_TYPE_GIT.equals(repository.getType())) {
            service.commitAndPush(repository, assetId, version, releaseNotes);
        }
    }
}
