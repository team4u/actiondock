package org.team4u.actiondock.script;

import org.team4u.actiondock.application.SharedStateApplicationService;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.model.SharedStateEntry;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 脚本共享状态桥接对象。
 *
 * @author jay.wu
 */
class ScriptStateBridge {
    private final SharedStateApplicationService sharedStateApplicationService;
    private final ScriptDefinition definition;
    private final ScriptExecutionContext executionContext;

    ScriptStateBridge(SharedStateApplicationService sharedStateApplicationService,
                             ScriptDefinition definition,
                             ScriptExecutionContext executionContext) {
        this.sharedStateApplicationService = sharedStateApplicationService == null
                ? SharedStateApplicationService.disabled()
                : sharedStateApplicationService;
        this.definition = definition;
        this.executionContext = executionContext;
    }

    public Map<String, Object> get(String namespace, String key) {
        SharedStateEntry entry = sharedStateApplicationService.get(namespace, key);
        return entry == null ? null : detailMap(entry);
    }

    public Map<String, Object> put(String namespace, String key, Object value) {
        return put(namespace, key, value, Map.of());
    }

    public Map<String, Object> put(String namespace, String key, Object value, Map<String, Object> options) {
        SharedStateEntry entry = sharedStateApplicationService.put(
                namespace,
                key,
                value,
                secret(options),
                expiresAt(options),
                scriptId(),
                executionId()
        );
        return detailMap(entry);
    }

    public Map<String, Object> cas(String namespace, String key, Number expectedVersion, Object value) {
        return cas(namespace, key, expectedVersion, value, Map.of());
    }

    public Map<String, Object> cas(String namespace,
                                   String key,
                                   Number expectedVersion,
                                   Object value,
                                   Map<String, Object> options) {
        SharedStateApplicationService.CompareAndSetResult result = sharedStateApplicationService.compareAndSet(
                namespace,
                key,
                expectedVersion == null ? null : expectedVersion.longValue(),
                value,
                secret(options),
                expiresAt(options),
                scriptId(),
                executionId()
        );
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("updated", result.updated());
        values.put("entry", result.entry() == null ? null : detailMap(result.entry()));
        values.put("current", result.current() == null ? null : detailMap(result.current()));
        return values;
    }

    public void delete(String namespace, String key) {
        sharedStateApplicationService.delete(namespace, key);
    }

    public List<Map<String, Object>> list(String namespace) {
        return sharedStateApplicationService.list(namespace).stream().map(ScriptStateBridge::summaryMap).toList();
    }

    private static boolean secret(Map<String, Object> options) {
        Object value = options == null ? null : options.get("secret");
        return value instanceof Boolean item && item;
    }

    private static LocalDateTime expiresAt(Map<String, Object> options) {
        Object ttlValue = options == null ? null : options.get("ttlSeconds");
        if (ttlValue == null) {
            return null;
        }
        long ttlSeconds;
        if (ttlValue instanceof Number number) {
            ttlSeconds = number.longValue();
        } else {
            try {
                ttlSeconds = Long.parseLong(String.valueOf(ttlValue));
            } catch (NumberFormatException exception) {
                throw new IllegalArgumentException("ttlSeconds 必须为数字");
            }
        }
        if (ttlSeconds <= 0) {
            throw new IllegalArgumentException("ttlSeconds 必须大于 0");
        }
        return LocalDateTime.now().plusSeconds(ttlSeconds);
    }

    private String scriptId() {
        return definition == null ? null : definition.getId();
    }

    private String executionId() {
        return executionContext == null ? null : executionContext.getExecutionId();
    }

    private static Map<String, Object> summaryMap(SharedStateEntry entry) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("namespace", entry.getNamespace());
        values.put("key", entry.getKey());
        values.put("secret", entry.isSecret());
        values.put("version", entry.getVersion());
        values.put("expiresAt", time(entry.getExpiresAt()));
        values.put("createdAt", time(entry.getCreatedAt()));
        values.put("updatedAt", time(entry.getUpdatedAt()));
        values.put("lastWriterScriptId", entry.getLastWriterScriptId());
        values.put("lastWriterExecutionId", entry.getLastWriterExecutionId());
        return values;
    }

    private static Map<String, Object> detailMap(SharedStateEntry entry) {
        Map<String, Object> values = summaryMap(entry);
        values.put("value", entry.getValue());
        return values;
    }

    private static String time(LocalDateTime value) {
        return value == null ? null : value.toString();
    }
}
