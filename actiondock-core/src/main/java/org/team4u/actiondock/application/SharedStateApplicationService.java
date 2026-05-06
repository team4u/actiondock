package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.SharedStateEntry;
import org.team4u.actiondock.domain.port.SharedStateRepository;

import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
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
                .map(SharedStateEntry::copy)
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
                : existing.copy()
                .setVersion(existing.getVersion() == null ? 1L : existing.getVersion() + 1L);

        target.setValue(value)
                .setSecret(secret)
                .setExpiresAt(expiresAt)
                .setUpdatedAt(now)
                .setLastWriterScriptId(ApplicationServiceSupport.blankToNull(writerScriptId))
                .setLastWriterExecutionId(ApplicationServiceSupport.blankToNull(writerExecutionId));

        if (existing == null) {
            target.setCreatedAt(now);
        }
        return repository.save(target).copy();
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
            return new CompareAndSetResult(true, created.copy(), created.copy());
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
            return new CompareAndSetResult(false, null, current.copy());
        }

        SharedStateEntry updated = buildEntry(
                current, value, secret, expiresAt, writerScriptId, writerExecutionId,
                current.getVersion() == null ? 1L : current.getVersion() + 1L, now);
        boolean success = repository.compareAndSet(updated, expectedVersion);
        if (!success) {
            SharedStateEntry latest = findActiveEntry(namespace, key, LocalDateTime.now());
            return new CompareAndSetResult(false, null, latest == null ? null : latest.copy());
        }
        SharedStateEntry persisted = repository.findByNamespaceAndKey(namespace, key)
                .map(SharedStateEntry::copy)
                .orElse(updated.copy());
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
                .map(SharedStateEntry::copy)
                .toList();
    }

    public List<String> listNamespaces() {
        if (!isEnabled()) {
            return List.of();
        }
        LocalDateTime now = LocalDateTime.now();
        return repository.findAll().stream()
                .filter(item -> !item.isExpiredAt(now))
                .map(SharedStateEntry::getNamespace)
                .filter(item -> item != null && !item.isBlank())
                .distinct()
                .sorted()
                .toList();
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
        return ApplicationServiceSupport.normalizePattern(namespace, "namespace", TOKEN_PATTERN);
    }

    private static String normalizeKey(String key) {
        return ApplicationServiceSupport.normalizePattern(key, "key", TOKEN_PATTERN);
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
        return applyUpdateFields(new SharedStateEntry()
                .setNamespace(namespace)
                .setKey(key)
                .setCreatedAt(createdAt), value, secret, expiresAt, writerScriptId, writerExecutionId, version, updatedAt);
    }

    private static SharedStateEntry buildEntry(SharedStateEntry base,
                                               Object value,
                                               boolean secret,
                                               LocalDateTime expiresAt,
                                               String writerScriptId,
                                               String writerExecutionId,
                                               long version,
                                               LocalDateTime updatedAt) {
        return applyUpdateFields(base.copy(), value, secret, expiresAt, writerScriptId, writerExecutionId, version, updatedAt);
    }

    private static SharedStateEntry applyUpdateFields(SharedStateEntry entry,
                                                      Object value,
                                                      boolean secret,
                                                      LocalDateTime expiresAt,
                                                      String writerScriptId,
                                                      String writerExecutionId,
                                                      long version,
                                                      LocalDateTime updatedAt) {
        return entry
                .setValue(value)
                .setSecret(secret)
                .setExpiresAt(expiresAt)
                .setVersion(version)
                .setUpdatedAt(updatedAt)
                .setLastWriterScriptId(ApplicationServiceSupport.blankToNull(writerScriptId))
                .setLastWriterExecutionId(ApplicationServiceSupport.blankToNull(writerExecutionId));
    }


    public record CompareAndSetResult(boolean updated, SharedStateEntry entry, SharedStateEntry current) {
    }
}
