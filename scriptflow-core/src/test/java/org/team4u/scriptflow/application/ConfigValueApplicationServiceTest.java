package org.team4u.scriptflow.application;

import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.domain.model.ConfigValue;
import org.team4u.scriptflow.domain.port.ConfigValueRepository;

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
                    .setCreatedAt(source.getCreatedAt())
                    .setUpdatedAt(source.getUpdatedAt());
        }
    }
}
