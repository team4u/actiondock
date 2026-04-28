package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.SharedStateEntry;
import org.team4u.actiondock.domain.port.SharedStateRepository;

import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 通用共享状态应用服务。
 *
 * @author jay.wu
 */
public class SharedStateApplicationService {
    private static final Pattern TOKEN_PATTERN = Pattern.compile("[A-Za-z0-9][A-Za-z0-9_.:/-]*");
    private static final SharedStateApplicationService DISABLED = new SharedStateApplicationService();

    private final SharedStateRepository repository;
    private final boolean enabled;

    private SharedStateApplicationService() {
        this.repository = null;
        this.enabled = false;
    }

    public SharedStateApplicationService(SharedStateRepository repository) {
        this.repository = Objects.requireNonNull(repository);
        this.enabled = true;
    }

    public static SharedStateApplicationService disabled() {
        return DISABLED;
    }

    public SharedStateEntry get(String namespace, String key) {
        if (!enabled) {
            return null;
        }
        String normalizedNamespace = normalizeNamespace(namespace);
        String normalizedKey = normalizeKey(key);
        return activeEntry(repository.findByNamespaceAndKey(normalizedNamespace, normalizedKey), LocalDateTime.now())
                .map(this::copy)
                .orElse(null);
    }

    public SharedStateEntry put(String namespace,
                                String key,
                                Object value,
                                boolean secret,
                                LocalDateTime expiresAt,
                                String writerScriptId,
                                String writerExecutionId) {
        ensureEnabled();
        String normalizedNamespace = normalizeNamespace(namespace);
        String normalizedKey = normalizeKey(key);
        LocalDateTime now = LocalDateTime.now();
        SharedStateEntry existing = activeEntry(repository.findByNamespaceAndKey(normalizedNamespace, normalizedKey), now)
                .orElse(null);

        SharedStateEntry target = existing == null
                ? new SharedStateEntry()
                .setNamespace(normalizedNamespace)
                .setKey(normalizedKey)
                .setVersion(1L)
                .setCreatedAt(now)
                : copy(existing)
                .setVersion(existing.getVersion() == null ? 1L : existing.getVersion() + 1L);

        target.setValue(value)
                .setSecret(secret)
                .setExpiresAt(expiresAt)
                .setUpdatedAt(now)
                .setLastWriterScriptId(blankToNull(writerScriptId))
                .setLastWriterExecutionId(blankToNull(writerExecutionId));

        if (existing == null) {
            target.setCreatedAt(now);
        }
        return copy(repository.save(target));
    }

    public CompareAndSetResult compareAndSet(String namespace,
                                             String key,
                                             Long expectedVersion,
                                             Object value,
                                             boolean secret,
                                             LocalDateTime expiresAt,
                                             String writerScriptId,
                                             String writerExecutionId) {
        ensureEnabled();
        String normalizedNamespace = normalizeNamespace(namespace);
        String normalizedKey = normalizeKey(key);
        LocalDateTime now = LocalDateTime.now();
        SharedStateEntry current = activeEntry(repository.findByNamespaceAndKey(normalizedNamespace, normalizedKey), now)
                .orElse(null);

        if (current == null) {
            if (expectedVersion != null) {
                return new CompareAndSetResult(false, null, null);
            }
            SharedStateEntry created = repository.save(new SharedStateEntry()
                    .setNamespace(normalizedNamespace)
                    .setKey(normalizedKey)
                    .setValue(value)
                    .setSecret(secret)
                    .setVersion(1L)
                    .setExpiresAt(expiresAt)
                    .setCreatedAt(now)
                    .setUpdatedAt(now)
                    .setLastWriterScriptId(blankToNull(writerScriptId))
                    .setLastWriterExecutionId(blankToNull(writerExecutionId)));
            return new CompareAndSetResult(true, copy(created), copy(created));
        }

        if (!Objects.equals(current.getVersion(), expectedVersion)) {
            return new CompareAndSetResult(false, null, copy(current));
        }

        SharedStateEntry updated = copy(current)
                .setValue(value)
                .setSecret(secret)
                .setExpiresAt(expiresAt)
                .setVersion(current.getVersion() == null ? 1L : current.getVersion() + 1L)
                .setUpdatedAt(now)
                .setLastWriterScriptId(blankToNull(writerScriptId))
                .setLastWriterExecutionId(blankToNull(writerExecutionId));
        boolean success = repository.compareAndSet(updated, expectedVersion);
        if (!success) {
            SharedStateEntry latest = activeEntry(repository.findByNamespaceAndKey(normalizedNamespace, normalizedKey), LocalDateTime.now())
                    .map(this::copy)
                    .orElse(null);
            return new CompareAndSetResult(false, null, latest);
        }
        SharedStateEntry persisted = repository.findByNamespaceAndKey(normalizedNamespace, normalizedKey)
                .map(this::copy)
                .orElse(copy(updated));
        return new CompareAndSetResult(true, persisted, persisted);
    }

    public void delete(String namespace, String key) {
        ensureEnabled();
        repository.deleteByNamespaceAndKey(normalizeNamespace(namespace), normalizeKey(key));
    }

    public List<SharedStateEntry> list(String namespace) {
        if (!enabled) {
            return List.of();
        }
        String normalizedNamespace = normalizeNamespace(namespace);
        LocalDateTime now = LocalDateTime.now();
        return repository.findByNamespace(normalizedNamespace).stream()
                .filter(item -> !item.isExpiredAt(now))
                .sorted(Comparator.comparing(SharedStateEntry::getKey))
                .map(this::copy)
                .toList();
    }

    public List<String> listNamespaces() {
        if (!enabled) {
            return List.of();
        }
        LocalDateTime now = LocalDateTime.now();
        Set<String> namespaces = new LinkedHashSet<>();
        repository.findAll().stream()
                .filter(item -> !item.isExpiredAt(now))
                .map(SharedStateEntry::getNamespace)
                .filter(item -> item != null && !item.isBlank())
                .sorted()
                .forEach(namespaces::add);
        return List.copyOf(namespaces);
    }

    public long purgeExpired(String namespace) {
        ensureEnabled();
        LocalDateTime now = LocalDateTime.now();
        if (namespace == null || namespace.isBlank()) {
            return repository.deleteExpired(now);
        }
        return repository.deleteExpired(normalizeNamespace(namespace), now);
    }

    private Optional<SharedStateEntry> activeEntry(Optional<SharedStateEntry> optionalEntry, LocalDateTime now) {
        return optionalEntry.filter(entry -> !entry.isExpiredAt(now));
    }

    private String normalizeNamespace(String namespace) {
        return normalizeToken(namespace, "namespace");
    }

    private String normalizeKey(String key) {
        return normalizeToken(key, "key");
    }

    private String normalizeToken(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " 不能为空");
        }
        String normalized = value.trim();
        if (!TOKEN_PATTERN.matcher(normalized).matches()) {
            throw new IllegalArgumentException(fieldName + " 格式不合法: " + value);
        }
        return normalized;
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private void ensureEnabled() {
        if (!enabled) {
            throw new IllegalStateException("共享状态服务未启用");
        }
    }

    private SharedStateEntry copy(SharedStateEntry source) {
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

    public record CompareAndSetResult(boolean updated, SharedStateEntry entry, SharedStateEntry current) {
    }
}
