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
public class SharedStateApplicationService extends OptionalServiceSupport {
    private static final Pattern TOKEN_PATTERN = Pattern.compile("[A-Za-z0-9][A-Za-z0-9_.:/-]*");
    private static final SharedStateApplicationService DISABLED = new SharedStateApplicationService();

    private final SharedStateRepository repository;

    private SharedStateApplicationService() {
        this.repository = null;
    }

    public SharedStateApplicationService(SharedStateRepository repository) {
        super(true);
        this.repository = Objects.requireNonNull(repository);
    }

    public static SharedStateApplicationService disabled() {
        return DISABLED;
    }

    public SharedStateEntry get(String namespace, String key) {
        if (!isEnabled()) {
            return null;
        }
        String normalizedNamespace = normalizeNamespace(namespace);
        String normalizedKey = normalizeKey(key);
        return activeEntry(repository.findByNamespaceAndKey(normalizedNamespace, normalizedKey), LocalDateTime.now())
                .map(SharedStateApplicationService::copy)
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
        SharedStateEntry current = findActiveEntry(normalizedNamespace, normalizedKey, now);

        if (current == null) {
            if (expectedVersion != null) {
                return new CompareAndSetResult(false, null, null);
            }
            SharedStateEntry created = repository.save(
                    buildEntry(normalizedNamespace, normalizedKey, value, secret, expiresAt, writerScriptId, writerExecutionId, 1L, now, now));
            return new CompareAndSetResult(true, copy(created), copy(created));
        }

        return updateExistingEntry(normalizedNamespace, normalizedKey, current, expectedVersion,
                value, secret, expiresAt, writerScriptId, writerExecutionId, now);
    }

    private CompareAndSetResult updateExistingEntry(String namespace,
                                                    String key,
                                                    SharedStateEntry current,
                                                    Long expectedVersion,
                                                    Object value,
                                                    boolean secret,
                                                    LocalDateTime expiresAt,
                                                    String writerScriptId,
                                                    String writerExecutionId,
                                                    LocalDateTime now) {
        if (!Objects.equals(current.getVersion(), expectedVersion)) {
            return new CompareAndSetResult(false, null, copy(current));
        }

        SharedStateEntry updated = buildEntry(
                current, value, secret, expiresAt, writerScriptId, writerExecutionId,
                current.getVersion() == null ? 1L : current.getVersion() + 1L, now);
        boolean success = repository.compareAndSet(updated, expectedVersion);
        if (!success) {
            SharedStateEntry latest = findActiveEntry(namespace, key, LocalDateTime.now());
            return new CompareAndSetResult(false, null, latest == null ? null : copy(latest));
        }
        SharedStateEntry persisted = repository.findByNamespaceAndKey(namespace, key)
                .map(SharedStateApplicationService::copy)
                .orElse(copy(updated));
        return new CompareAndSetResult(true, persisted, persisted);
    }

    public void delete(String namespace, String key) {
        ensureEnabled();
        repository.deleteByNamespaceAndKey(normalizeNamespace(namespace), normalizeKey(key));
    }

    public List<SharedStateEntry> list(String namespace) {
        if (!isEnabled()) {
            return List.of();
        }
        String normalizedNamespace = normalizeNamespace(namespace);
        LocalDateTime now = LocalDateTime.now();
        return repository.findByNamespace(normalizedNamespace).stream()
                .filter(item -> !item.isExpiredAt(now))
                .sorted(Comparator.comparing(SharedStateEntry::getKey))
                .map(SharedStateApplicationService::copy)
                .toList();
    }

    public List<String> listNamespaces() {
        if (!isEnabled()) {
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

    private static Optional<SharedStateEntry> activeEntry(Optional<SharedStateEntry> optionalEntry, LocalDateTime now) {
        return optionalEntry.filter(entry -> !entry.isExpiredAt(now));
    }

    private static String normalizeNamespace(String namespace) {
        return normalizeToken(namespace, "namespace");
    }

    private static String normalizeKey(String key) {
        return normalizeToken(key, "key");
    }

    private static String normalizeToken(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " 不能为空");
        }
        String normalized = value.trim();
        if (!TOKEN_PATTERN.matcher(normalized).matches()) {
            throw new IllegalArgumentException(fieldName + " 格式不合法: " + value);
        }
        return normalized;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    @Override
    protected String serviceName() {
        return "共享状态服务";
    }

    private SharedStateEntry findActiveEntry(String namespace, String key, LocalDateTime now) {
        return activeEntry(repository.findByNamespaceAndKey(namespace, key), now).orElse(null);
    }

    private static SharedStateEntry buildEntry(String namespace,
                                               String key,
                                               Object value,
                                               boolean secret,
                                               LocalDateTime expiresAt,
                                               String writerScriptId,
                                               String writerExecutionId,
                                               long version,
                                               LocalDateTime createdAt,
                                               LocalDateTime updatedAt) {
        return new SharedStateEntry()
                .setNamespace(namespace)
                .setKey(key)
                .setValue(value)
                .setSecret(secret)
                .setVersion(version)
                .setExpiresAt(expiresAt)
                .setCreatedAt(createdAt)
                .setUpdatedAt(updatedAt)
                .setLastWriterScriptId(blankToNull(writerScriptId))
                .setLastWriterExecutionId(blankToNull(writerExecutionId));
    }

    private static SharedStateEntry buildEntry(SharedStateEntry base,
                                               Object value,
                                               boolean secret,
                                               LocalDateTime expiresAt,
                                               String writerScriptId,
                                               String writerExecutionId,
                                               long version,
                                               LocalDateTime updatedAt) {
        return copy(base)
                .setValue(value)
                .setSecret(secret)
                .setExpiresAt(expiresAt)
                .setVersion(version)
                .setUpdatedAt(updatedAt)
                .setLastWriterScriptId(blankToNull(writerScriptId))
                .setLastWriterExecutionId(blankToNull(writerExecutionId));
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

    public record CompareAndSetResult(boolean updated, SharedStateEntry entry, SharedStateEntry current) {
    }
}
