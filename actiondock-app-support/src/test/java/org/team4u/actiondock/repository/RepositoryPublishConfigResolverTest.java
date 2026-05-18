package org.team4u.actiondock.repository;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.model.ConfigValue;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RepositoryPublishConfigResolverTest {

    @Test
    void extractsLiteralConfigReferencesFromSource() {
        String source = """
                def url = "${config.api_base}"
                def token = config["api.token"]
                def region = config.get('region')
                print(config[userInput])
                value = config.get(dynamic_key)
                """;

        assertThat(RepositoryPublishConfigResolver.extractSourceConfigKeys(source))
                .containsExactly("api_base", "api.token", "region");
    }

    @Test
    void resolvesScheduleAndRecursiveConfigDependencies() {
        RepositoryPublishConfigResolver.PublishConfigResolution resolution = RepositoryPublishConfigResolver.resolve(
                """
                        return [
                          endpoint: config["base_url"]
                        ]
                        """,
                List.of(Map.of("token", "${config.api_token}")),
                List.of(
                        configValue("base_url", "https://${config.region}.example.com", false, "Base URL"),
                        configValue("region", "cn", false, "Region"),
                        configValue("api_token", "secret-value", true, "API Token")
                )
        );

        assertThat(resolution.inferredKeys()).containsExactly("api_token", "base_url", "region");
        assertThat(resolution.missingKeys()).isEmpty();
        assertThat(resolution.items())
                .extracting(RepositoryPublishConfigResolver.ResolvedConfigValue::key)
                .containsExactly("api_token", "base_url", "region");
    }

    @Test
    void buildTemplatesRejectsMissingConfigs() {
        RepositoryPublishConfigResolver.PublishConfigResolution resolution = RepositoryPublishConfigResolver.resolve(
                "return config.get(\"missing.key\")",
                List.of(),
                List.of()
        );

        assertThatThrownBy(() -> RepositoryPublishConfigResolver.buildTemplates(
                resolution,
                List.of(new RepositoryPublishConfigItem("missing.key", "PLACEHOLDER"))
        ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("发布依赖的配置值不存在: missing.key");
    }

    @Test
    void buildTemplatesRejectsMissingExtraAndDuplicateRequestedKeys() {
        RepositoryPublishConfigResolver.PublishConfigResolution resolution = RepositoryPublishConfigResolver.resolve(
                "return config.get(\"api.base\")",
                List.of(),
                List.of(configValue("api.base", "https://example.com", false, "API Base"))
        );

        assertThatThrownBy(() -> RepositoryPublishConfigResolver.buildTemplates(resolution, List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("发布配置项缺失: api.base");
        assertThatThrownBy(() -> RepositoryPublishConfigResolver.buildTemplates(
                resolution,
                List.of(new RepositoryPublishConfigItem("other.key", "PLACEHOLDER"))
        ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("发布配置项缺失: api.base");
        assertThatThrownBy(() -> RepositoryPublishConfigResolver.buildTemplates(
                resolution,
                List.of(
                        new RepositoryPublishConfigItem("api.base", "PLACEHOLDER"),
                        new RepositoryPublishConfigItem("other.key", "PLACEHOLDER")
                )
        ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("发布配置项包含未检测的 key: other.key");
        assertThatThrownBy(() -> RepositoryPublishConfigResolver.buildTemplates(
                resolution,
                List.of(
                        new RepositoryPublishConfigItem("api.base", "PLACEHOLDER"),
                        new RepositoryPublishConfigItem("api.base", "INLINE")
                )
        ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("发布配置项重复: api.base");
    }

    @Test
    void buildTemplatesForcesSecretValuesToPlaceholder() {
        RepositoryPublishConfigResolver.PublishConfigResolution resolution = RepositoryPublishConfigResolver.resolve(
                """
                        def token = config["api.token"]
                        def base = config.get("api.base")
                        """,
                List.of(),
                List.of(
                        configValue("api.token", "secret-token", true, "API Token"),
                        configValue("api.base", "https://example.com", false, "API Base")
                )
        );

        List<ConfigTemplateItem> templates = RepositoryPublishConfigResolver.buildTemplates(
                resolution,
                List.of(
                        new RepositoryPublishConfigItem("api.base", "INLINE"),
                        new RepositoryPublishConfigItem("api.token", "INLINE")
                )
        );

        assertThat(templates).hasSize(2);
        assertThat(templates.get(0).key()).isEqualTo("api.base");
        assertThat(templates.get(0).secret()).isFalse();
        assertThat(templates.get(0).defaultValue()).isEqualTo("https://example.com");
        assertThat(templates.get(1).key()).isEqualTo("api.token");
        assertThat(templates.get(1).secret()).isTrue();
        assertThat(templates.get(1).defaultValue()).isNull();
    }

    private ConfigValue configValue(String key, String value, boolean secret, String description) {
        return new ConfigValue()
                .setKey(key)
                .setValue(value)
                .setSecret(secret)
                .setDescription(description);
    }
}
