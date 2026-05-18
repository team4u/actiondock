package org.team4u.actiondock.storage.jpa.repo;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.team4u.actiondock.storage.jpa.entity.PluginRegistrationEntity;
import org.team4u.actiondock.storage.jpa.entity.RepositoryLocalAssetEntity;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest(properties = "spring.jpa.hibernate.ddl-auto=create-drop")
class SpringDataDescriptionStorageTest {
    @Autowired
    private SpringDataPluginRegistrationRepository pluginRepository;

    @Autowired
    private SpringDataRepositoryLocalAssetRepository localAssetRepository;

    @Test
    void storesLongMarkdownDescriptionsForPluginsAndRepositoryLocalAssets() {
        String markdown = """
                # README

                | Key | Value |
                | --- | --- |
                | mode | markdown |

                """.repeat(300);

        PluginRegistrationEntity plugin = new PluginRegistrationEntity();
        plugin.setPluginId("markdown-plugin");
        plugin.setName("Markdown Plugin");
        plugin.setDescription(markdown);
        plugin.setFileName("markdown-plugin.jar");
        plugin.setEnabled(true);
        pluginRepository.save(plugin);

        RepositoryLocalAssetEntity localAsset = new RepositoryLocalAssetEntity();
        localAsset.setId("SCRIPT:LOCKED:repo.markdown-tool");
        localAsset.setAssetType("SCRIPT");
        localAsset.setLocalAssetId("repo.markdown-tool");
        localAsset.setRepositoryId("repo");
        localAsset.setUpstreamAssetId("markdown-tool");
        localAsset.setMode("LOCKED");
        localAsset.setName("Markdown Tool");
        localAsset.setDescription(markdown);
        localAssetRepository.save(localAsset);

        assertThat(pluginRepository.findById("markdown-plugin").orElseThrow().getDescription()).isEqualTo(markdown);
        assertThat(localAssetRepository.findById("SCRIPT:LOCKED:repo.markdown-tool").orElseThrow().getDescription()).isEqualTo(markdown);
    }

    @SpringBootConfiguration
    @EnableAutoConfiguration
    @EntityScan("org.team4u.actiondock.storage.jpa.entity")
    @EnableJpaRepositories("org.team4u.actiondock.storage.jpa.repo")
    static class TestApplication {
    }
}
