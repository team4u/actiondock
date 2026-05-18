package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.SharedStateEntry;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * 共享状态仓储端口。
 *
 * @author jay.wu
 */
public interface SharedStateRepository {
    SharedStateEntry save(SharedStateEntry entry);

    Optional<SharedStateEntry> findByNamespaceAndKey(String namespace, String key);

    List<SharedStateEntry> findByNamespace(String namespace);

    List<SharedStateEntry> findAll();

    boolean compareAndSet(SharedStateEntry entry, Long expectedVersion);

    void deleteByNamespaceAndKey(String namespace, String key);

    long deleteExpired(LocalDateTime now);

    long deleteExpired(String namespace, LocalDateTime now);
}
