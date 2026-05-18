package org.team4u.actiondock.storage.jpa.repo;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.team4u.actiondock.storage.jpa.entity.SharedStateEntity;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest(properties = "spring.jpa.hibernate.ddl-auto=create-drop")
class SpringDataSharedStateRepositoryTest {
    @Autowired
    private SpringDataSharedStateRepository repository;

    @Test
    void compareAndSetUpdatesOnlyWhenVersionMatches() {
        repository.save(entity("oauth", "token", 1L, LocalDateTime.now().plusMinutes(1)));

        int updated = repository.compareAndSet(
                "oauth",
                "token",
                1L,
                2L,
                "{\"accessToken\":\"new\"}",
                true,
                LocalDateTime.now().plusMinutes(2),
                LocalDateTime.of(2026, 4, 28, 12, 0),
                "script-1",
                "exec-1"
        );
        int stale = repository.compareAndSet(
                "oauth",
                "token",
                1L,
                3L,
                "{\"accessToken\":\"stale\"}",
                false,
                null,
                LocalDateTime.of(2026, 4, 28, 13, 0),
                null,
                null
        );

        SharedStateEntity entity = repository.findByNamespaceAndEntryKey("oauth", "token").orElseThrow();
        assertThat(updated).isEqualTo(1);
        assertThat(stale).isEqualTo(0);
        assertThat(entity.getVersionValue()).isEqualTo(2L);
        assertThat(entity.getValueJson()).isEqualTo("{\"accessToken\":\"new\"}");
        assertThat(entity.isSecret()).isTrue();
        assertThat(entity.getLastWriterScriptId()).isEqualTo("script-1");
    }

    @Test
    void deleteExpiredByNamespaceRemovesOnlyMatchingEntries() {
        repository.save(entity("oauth", "expired", 1L, LocalDateTime.now().minusSeconds(1)));
        repository.save(entity("oauth", "active", 1L, LocalDateTime.now().plusMinutes(5)));
        repository.save(entity("cache", "expired", 1L, LocalDateTime.now().minusSeconds(1)));

        int deleted = repository.deleteExpiredByNamespace("oauth", LocalDateTime.now());

        assertThat(deleted).isEqualTo(1);
        assertThat(repository.findByNamespaceOrderByEntryKeyAsc("oauth"))
                .extracting(SharedStateEntity::getEntryKey)
                .containsExactly("active");
        assertThat(repository.findByNamespaceOrderByEntryKeyAsc("cache"))
                .extracting(SharedStateEntity::getEntryKey)
                .containsExactly("expired");
    }

    private static SharedStateEntity entity(String namespace, String key, Long version, LocalDateTime expiresAt) {
        SharedStateEntity entity = new SharedStateEntity();
        entity.setId(namespace + "\u0000" + key);
        entity.setNamespace(namespace);
        entity.setEntryKey(key);
        entity.setValueJson("{\"value\":1}");
        entity.setSecret(false);
        entity.setVersionValue(version);
        entity.setExpiresAt(expiresAt);
        entity.setCreatedAt(LocalDateTime.now());
        entity.setUpdatedAt(LocalDateTime.now());
        return entity;
    }

    @SpringBootConfiguration
    @EnableAutoConfiguration
    @EntityScan("org.team4u.actiondock.storage.jpa.entity")
    @EnableJpaRepositories("org.team4u.actiondock.storage.jpa.repo")
    static class TestApplication {
    }
}
