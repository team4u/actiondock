package org.team4u.actiondock.application;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.port.ConfigValueRepository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ConfigValueApplicationServiceTest {
    private final InMemoryConfigValueRepository repository = new InMemoryConfigValueRepository();
    private final ConfigValueApplicationService service = new ConfigValueApplicationService(repository);

    @Test
    void snapshotResolvesNestedReferences() {
        service.create(new ConfigValue().setKey("host").setValue("api.example.com"));
        service.create(new ConfigValue().setKey("base_url").setValue("https://${config.host}/v1"));
        service.create(new ConfigValue().setKey("health_url").setValue("${config.base_url}/health"));

        assertThat(service.snapshot())
                .containsEntry("base_url", "https://api.example.com/v1")
                .containsEntry("health_url", "https://api.example.com/v1/health");
    }

    @Test
    void resolveMapRecursivelyReplacesStringPlaceholders() {
        service.create(new ConfigValue().setKey("token").setValue("abc123"));
        service.create(new ConfigValue().setKey("endpoint").setValue("https://svc.example.com"));

        Map<String, Object> resolved = service.resolveMap(Map.of(
                "headers", Map.of("Authorization", "Bearer ${config.token}"),
                "targets", List.of("${config.endpoint}/v1", "${config.endpoint}/v2"),
                "enabled", true
        ));

        assertThat(resolved)
                .containsEntry("enabled", true)
                .containsEntry("targets", List.of("https://svc.example.com/v1", "https://svc.example.com/v2"));
        assertThat((Map<String, Object>) resolved.get("headers"))
                .containsEntry("Authorization", "Bearer abc123");
    }

    @Test
    void resolveMapViewRedactsSecretPlaceholders() {
        service.create(new ConfigValue().setKey("token").setValue("abc123").setSecret(true));
        service.create(new ConfigValue().setKey("endpoint").setValue("https://svc.example.com"));
        service.create(new ConfigValue().setKey("auth_header").setValue("Bearer ${config.token}"));

        ConfigValueApplicationService.ResolvedMapView view = service.resolveMapView(Map.of(
                "headers", Map.of(
                        "Authorization", "Bearer ${config.token}",
                        "Forwarded", "${config.auth_header}"
                ),
                "targets", List.of("${config.endpoint}/v1", "${config.token}"),
                "enabled", true
        ));

        assertThat((Map<String, Object>) view.resolved().get("headers"))
                .containsEntry("Authorization", "Bearer abc123")
                .containsEntry("Forwarded", "Bearer abc123");
        assertThat(view.resolved())
                .containsEntry("targets", List.of("https://svc.example.com/v1", "abc123"));

        assertThat((Map<String, Object>) view.redacted().get("headers"))
                .containsEntry("Authorization", "Bearer ********")
                .containsEntry("Forwarded", "Bearer ********");
        assertThat(view.redacted())
                .containsEntry("targets", List.of("https://svc.example.com/v1", "********"))
                .containsEntry("enabled", true);
    }

    @Test
    void snapshotRejectsMissingAndCircularReferences() {
        service.create(new ConfigValue().setKey("broken").setValue("${config.missing}"));

        assertThatThrownBy(service::snapshot)
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("配置值不存在: missing");

        repository.clear();
        service.create(new ConfigValue().setKey("a").setValue("${config.b}"));
        service.create(new ConfigValue().setKey("b").setValue("${config.a}"));

        assertThatThrownBy(service::snapshot)
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("配置值引用存在循环");
    }

    @Test
    void updateCanPreserveSecretValue() {
        service.create(new ConfigValue()
                .setKey("openai.api_key")
                .setValue("sk-old")
                .setDescription("OpenAI")
                .setSecret(true));

        ConfigValue updated = service.update("openai.api_key", new ConfigValue()
                .setKey("openai.api_key")
                .setValue("")
                .setDescription("Updated")
                .setSecret(true), true);

        assertThat(updated.getValue()).isEqualTo("sk-old");
        assertThat(updated.isSecret()).isTrue();
        assertThat(updated.getDescription()).isEqualTo("Updated");
    }

    @Test
    void managedValueMustBeOverriddenBeforeUpdate() {
        service.create(new ConfigValue()
                .setKey("managed.key")
                .setValue("default")
                .setManaged(true));

        assertThatThrownBy(() -> service.update("managed.key", new ConfigValue()
                .setKey("managed.key")
                .setValue("custom"), false))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("托管配置值需先复制为本地覆盖值后再修改");
    }

    @Test
    void canCopyManagedValueAsLocalOverrideAndRestoreTemplateDefault() {
        service.create(new ConfigValue()
                .setKey("managed.key")
                .setValue("default")
                .setDescription("Default")
                .setSecret(false)
                .setRepositoryId("repo-1")
                .setRepositoryToolId("tool-a")
                .setRepositoryVersion("1.0.0")
                .setPublishMode("INLINE")
                .setManaged(true)
                .setOverridden(false));

        ConfigValue overridden = service.copyAsLocalOverride("managed.key");
        assertThat(overridden.isManaged()).isTrue();
        assertThat(overridden.isOverridden()).isTrue();
        assertThat(overridden.getValue()).isEqualTo("default");

        ConfigValue restored = service.restoreManagedValue("managed.key", new ConfigValue()
                .setKey("managed.key")
                .setValue("template-default")
                .setDescription("Template")
                .setRepositoryId("repo-1")
                .setRepositoryToolId("tool-a")
                .setRepositoryVersion("1.1.0")
                .setPublishMode("INLINE")
                .setManaged(true)
                .setOverridden(false));
        assertThat(restored.isManaged()).isTrue();
        assertThat(restored.isOverridden()).isFalse();
        assertThat(restored.getValue()).isEqualTo("template-default");
        assertThat(restored.getRepositoryVersion()).isEqualTo("1.1.0");
    }

    private static final class InMemoryConfigValueRepository implements ConfigValueRepository {
        private final Map<String, ConfigValue> values = new LinkedHashMap<>();

        @Override
        public ConfigValue save(ConfigValue configValue) {
            ConfigValue copy = copy(configValue);
            values.put(copy.getKey(), copy);
            return copy(copy);
        }

        @Override
        public Optional<ConfigValue> findByKey(String key) {
            return Optional.ofNullable(values.get(key)).map(InMemoryConfigValueRepository::copy);
        }

        @Override
        public List<ConfigValue> findAll() {
            return values.values().stream().map(InMemoryConfigValueRepository::copy).toList();
        }

        @Override
        public void deleteByKey(String key) {
            values.remove(key);
        }

        void clear() {
            values.clear();
        }

        private static ConfigValue copy(ConfigValue source) {
            return new ConfigValue()
                    .setKey(source.getKey())
                    .setValue(source.getValue())
                    .setDescription(source.getDescription())
                    .setSecret(source.isSecret())
                    .setRepositoryId(source.getRepositoryId())
                    .setRepositoryToolId(source.getRepositoryScriptId())
                    .setRepositoryVersion(source.getRepositoryVersion())
                    .setPublishMode(source.getPublishMode())
                    .setManaged(source.isManaged())
                    .setOverridden(source.isOverridden())
                    .setCreatedAt(source.getCreatedAt())
                    .setUpdatedAt(source.getUpdatedAt());
        }
    }
}
