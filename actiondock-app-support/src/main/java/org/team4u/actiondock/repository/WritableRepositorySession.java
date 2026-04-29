package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.RepositoryDefinition;

import java.nio.file.Path;

final class WritableRepositorySession {
    private final RepositoryCatalogService service;
    private final RepositoryDefinition repository;
    private final Path root;
    private final RepositoryCatalogService.RepositoryIndexFile index;

    WritableRepositorySession(RepositoryCatalogService service,
                              RepositoryDefinition repository,
                              Path root,
                              RepositoryCatalogService.RepositoryIndexFile index) {
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

    RepositoryCatalogService.RepositoryIndexFile index() {
        return index;
    }

    void commitPublishedAsset(String assetId, String version, String releaseNotes) {
        if ("GIT".equals(repository.getType())) {
            service.commitAndPush(repository, assetId, version, releaseNotes);
        }
    }
}
