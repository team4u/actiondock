package org.team4u.actiondock.application;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.model.SharedStateEntry;
import org.team4u.actiondock.domain.port.SharedStateRepository;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class SharedStateApplicationServiceTest {
    private final InMemorySharedStateRepository repository = new InMemorySharedStateRepository();
    private final SharedStateApplicationService service = new SharedStateApplicationService(repository);

    @Test
    void putAndGetShareStructuredValue() {
        SharedStateEntry saved = service.put(
                "oauth.github",
                "token",
                Map.of("accessToken", "abc"),
                true,
                null,
                "script-1",
                "exec-1"
        );

        SharedStateEntry loaded = service.get("oauth.github", "token");

        assertThat(saved.getVersion()).isEqualTo(1L);
        assertThat(loaded.getValue()).isEqualTo(Map.of("accessToken", "abc"));
        assertThat(loaded.isSecret()).isTrue();
        assertThat(loaded.getLastWriterScriptId()).isEqualTo("script-1");
        assertThat(loaded.getLastWriterExecutionId()).isEqualTo("exec-1");
    }

    @Test
    void putOverExpiredEntryResetsVersion() {
        repository.save(new SharedStateEntry()
                .setNamespace("cache")
                .setKey("item")
                .setValue(Map.of("value", 1))
                .setVersion(9L)
                .setExpiresAt(LocalDateTime.now().minusSeconds(1))
                .setCreatedAt(LocalDateTime.now().minusHours(1))
                .setUpdatedAt(LocalDateTime.now().minusHours(1)));

        SharedStateEntry saved = service.put("cache", "item", Map.of("value", 2), false, null, null, null);

        assertThat(saved.getVersion()).isEqualTo(1L);
        assertThat(saved.getValue()).isEqualTo(Map.of("value", 2));
    }

    @Test
    void compareAndSetUpdatesOnlyWhenVersionMatches() {
        SharedStateEntry created = service.put("oauth", "token", Map.of("value", "old"), false, null, null, null);

        SharedStateApplicationService.CompareAndSetResult success = service.compareAndSet(
                "oauth",
                "token",
                created.getVersion(),
                Map.of("value", "new"),
                false,
                null,
                "script-2",
                "exec-2"
        );
        SharedStateApplicationService.CompareAndSetResult failure = service.compareAndSet(
                "oauth",
                "token",
                created.getVersion(),
                Map.of("value", "stale"),
                false,
                null,
                null,
                null
        );

        assertThat(success.updated()).isTrue();
        assertThat(success.entry().getVersion()).isEqualTo(2L);
        assertThat(success.entry().getValue()).isEqualTo(Map.of("value", "new"));
        assertThat(failure.updated()).isFalse();
        assertThat(failure.current().getVersion()).isEqualTo(2L);
        assertThat(failure.current().getValue()).isEqualTo(Map.of("value", "new"));
    }

    @Test
    void listAndNamespacesIgnoreExpiredEntries() {
        service.put("shared", "active", Map.of("ok", true), false, LocalDateTime.now().plusMinutes(1), null, null);
        repository.save(new SharedStateEntry()
                .setNamespace("shared")
                .setKey("expired")
                .setValue(Map.of("ok", false))
                .setVersion(1L)
                .setExpiresAt(LocalDateTime.now().minusSeconds(1))
                .setCreatedAt(LocalDateTime.now())
                .setUpdatedAt(LocalDateTime.now()));
        repository.save(new SharedStateEntry()
                .setNamespace("gone")
                .setKey("only-expired")
                .setValue(Map.of("ok", false))
                .setVersion(1L)
                .setExpiresAt(LocalDateTime.now().minusSeconds(1))
                .setCreatedAt(LocalDateTime.now())
                .setUpdatedAt(LocalDateTime.now()));

        List<SharedStateEntry> items = service.list("shared");
        List<String> namespaces = service.listNamespaces();

        assertThat(items).extracting(SharedStateEntry::getKey).containsExactly("active");
        assertThat(namespaces).containsExactly("shared");
    }

    @Test
    void purgeExpiredDelegatesToRepository() {
        repository.save(new SharedStateEntry()
                .setNamespace("shared")
                .setKey("expired")
                .setValue("x")
                .setVersion(1L)
                .setExpiresAt(LocalDateTime.now().minusSeconds(1))
                .setCreatedAt(LocalDateTime.now())
                .setUpdatedAt(LocalDateTime.now()));
        repository.save(new SharedStateEntry()
                .setNamespace("shared")
                .setKey("active")
                .setValue("y")
                .setVersion(1L)
                .setExpiresAt(LocalDateTime.now().plusMinutes(1))
                .setCreatedAt(LocalDateTime.now())
                .setUpdatedAt(LocalDateTime.now()));

        long deleted = service.purgeExpired("shared");

        assertThat(deleted).isEqualTo(1);
        assertThat(service.list("shared")).extracting(SharedStateEntry::getKey).containsExactly("active");
    }

    private static final class InMemorySharedStateRepository implements SharedStateRepository {
        private final Map<String, SharedStateEntry> values = new LinkedHashMap<>();

        @Override
        public SharedStateEntry save(SharedStateEntry entry) {
            SharedStateEntry copy = copy(entry);
            values.put(id(entry.getNamespace(), entry.getKey()), copy);
            return copy(copy);
        }

        @Override
        public Optional<SharedStateEntry> findByNamespaceAndKey(String namespace, String key) {
            return Optional.ofNullable(values.get(id(namespace, key))).map(InMemorySharedStateRepository::copy);
        }

        @Override
        public List<SharedStateEntry> findByNamespace(String namespace) {
            return values.values().stream()
                    .filter(item -> namespace.equals(item.getNamespace()))
                    .map(InMemorySharedStateRepository::copy)
                    .toList();
        }

        @Override
        public List<SharedStateEntry> findAll() {
            return values.values().stream().map(InMemorySharedStateRepository::copy).toList();
        }

        @Override
        public boolean compareAndSet(SharedStateEntry entry, Long expectedVersion) {
            String id = id(entry.getNamespace(), entry.getKey());
            SharedStateEntry current = values.get(id);
            if (current == null || !java.util.Objects.equals(current.getVersion(), expectedVersion)) {
                return false;
            }
            values.put(id, copy(entry));
            return true;
        }

        @Override
        public void deleteByNamespaceAndKey(String namespace, String key) {
            values.remove(id(namespace, key));
        }

        @Override
        public long deleteExpired(LocalDateTime now) {
            return deleteMatching(null, now);
        }

        @Override
        public long deleteExpired(String namespace, LocalDateTime now) {
            return deleteMatching(namespace, now);
        }

        private long deleteMatching(String namespace, LocalDateTime now) {
            List<String> ids = new ArrayList<>();
            values.forEach((id, value) -> {
                if ((namespace == null || namespace.equals(value.getNamespace())) && value.isExpiredAt(now)) {
                    ids.add(id);
                }
            });
            ids.forEach(values::remove);
            return ids.size();
        }

        private static String id(String namespace, String key) {
            return namespace + "\u0000" + key;
        }

        private static SharedStateEntry copy(SharedStateEntry source) {
            return new SharedStateEntry()
                    .setNamespace(source.getNamespace())
                    .setKey(source.getKey())
                    .setValue(source.getValue())
                    .setSecret(source.isSecret())
                    .setVersion(source.getVersion())
                    .setExpiresAt(source.getExpiresAt())
                    .setCreatedAt(source.getCreatedAt())
                    .setUpdatedAt(source.getUpdatedAt())
                    .setLastWriterScriptId(source.getLastWriterScriptId())
                    .setLastWriterExecutionId(source.getLastWriterExecutionId());
        }
    }
}
