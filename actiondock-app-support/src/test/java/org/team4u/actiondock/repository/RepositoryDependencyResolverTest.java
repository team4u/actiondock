package org.team4u.actiondock.repository;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.model.RepositoryDefinition;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class RepositoryDependencyResolverTest {

    @Test
    void keepsDeclaredRepositoryWhenAssetExists() {
        RepositoryCatalogService catalog = mock(RepositoryCatalogService.class);
        when(catalog.listRepositories()).thenReturn(List.of(
                repository("current", "GIT", true),
                repository("publisher", "GIT", true)
        ));
        when(catalog.listRepositoryScripts("publisher")).thenReturn(List.of(tool("publisher", "child")));

        RepositoryDependencyResolver resolver = new RepositoryDependencyResolver(catalog);

        assertThat(resolver.resolveToolRepositoryId("current", "publisher", "child")).isEqualTo("publisher");
    }

    @Test
    void fallsBackToCurrentRepositoryWhenDeclaredAssetMissing() {
        RepositoryCatalogService catalog = mock(RepositoryCatalogService.class);
        when(catalog.listRepositories()).thenReturn(List.of(
                repository("current", "GIT", true),
                repository("publisher", "GIT", true)
        ));
        when(catalog.listRepositoryScripts("publisher")).thenReturn(List.of());
        when(catalog.listRepositoryScripts("current")).thenReturn(List.of(tool("current", "child")));

        RepositoryDependencyResolver resolver = new RepositoryDependencyResolver(catalog);

        assertThat(resolver.resolveToolRepositoryId("current", "publisher", "child")).isEqualTo("current");
    }

    @Test
    void fallsBackToSingleEnabledDiscoveryRepository() {
        RepositoryCatalogService catalog = mock(RepositoryCatalogService.class);
        when(catalog.listRepositories()).thenReturn(List.of(
                repository("current", "GIT", true),
                repository("publisher", "GIT", true),
                repository("consumer", "LOCAL_DIR", true)
        ));
        when(catalog.listRepositoryScripts("publisher")).thenReturn(List.of());
        when(catalog.listRepositoryScripts("current")).thenReturn(List.of());
        when(catalog.listRepositoryScripts("consumer")).thenReturn(List.of(tool("consumer", "child")));

        RepositoryDependencyResolver resolver = new RepositoryDependencyResolver(catalog);

        assertThat(resolver.resolveToolRepositoryId("current", "publisher", "child")).isEqualTo("consumer");
    }

    @Test
    void rejectsAmbiguousFallbackMatches() {
        RepositoryCatalogService catalog = mock(RepositoryCatalogService.class);
        when(catalog.listRepositories()).thenReturn(List.of(
                repository("current", "GIT", true),
                repository("publisher", "GIT", true),
                repository("repo-a", "GIT", true),
                repository("repo-b", "LOCAL_DIR", true)
        ));
        when(catalog.listRepositoryScripts("publisher")).thenReturn(List.of());
        when(catalog.listRepositoryScripts("current")).thenReturn(List.of());
        when(catalog.listRepositoryScripts("repo-a")).thenReturn(List.of(tool("repo-a", "child")));
        when(catalog.listRepositoryScripts("repo-b")).thenReturn(List.of(tool("repo-b", "child")));

        RepositoryDependencyResolver resolver = new RepositoryDependencyResolver(catalog);

        assertThatThrownBy(() -> resolver.resolveToolRepositoryId("current", "publisher", "child"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("歧义")
                .hasMessageContaining("repo-a")
                .hasMessageContaining("repo-b");
    }

    @Test
    void ignoresDisabledAndHttpRepositoriesDuringFallback() {
        RepositoryCatalogService catalog = mock(RepositoryCatalogService.class);
        when(catalog.listRepositories()).thenReturn(List.of(
                repository("current", "GIT", true),
                repository("publisher", "GIT", true),
                repository("http-repo", "HTTP", true),
                repository("disabled-repo", "LOCAL_DIR", false)
        ));
        when(catalog.listRepositoryScripts("publisher")).thenReturn(List.of());
        when(catalog.listRepositoryScripts("current")).thenReturn(List.of());

        RepositoryDependencyResolver resolver = new RepositoryDependencyResolver(catalog);

        assertThatThrownBy(() -> resolver.resolveToolRepositoryId("current", "publisher", "child"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("依赖不存在");
    }

    private static RepositoryDefinition repository(String id, String type, boolean enabled) {
        return new RepositoryDefinition()
                .setId(id)
                .setType(type)
                .setEnabled(enabled)
                .setUrl("https://example.com/" + id);
    }

    private static RepositoryCatalogTypes.RepositoryScriptDescriptor tool(String repositoryId, String toolId) {
        return new RepositoryCatalogTypes.RepositoryScriptDescriptor(
                repositoryId,
                toolId,
                toolId,
                "1.0.0",
                null,
                null,
                null,
                List.of(),
                "GROOVY",
                "TOOL",
                "tools/" + toolId + "/source.groovy",
                null,
                "input.schema.json",
                "output.schema.json",
                null,
                null,
                null,
                null,
                List.of(),
                List.of(),
                true,
                null
        );
    }
}
