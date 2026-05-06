package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.EventTrigger;
import org.team4u.actiondock.domain.model.ProcessorResult;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;

final class EventProcessorUtils {

    private EventProcessorUtils() {
    }

    static boolean asMatched(ProcessorResult result) {
        if (result == null || !result.isSuccess()) {
            return false;
        }
        Object value = result.getOutput().get("matched");
        if (value instanceof Boolean bool) {
            return bool;
        }
        if (value instanceof Number number) {
            return number.intValue() != 0;
        }
        if (value instanceof CharSequence text) {
            return !text.isEmpty() && !"false".equalsIgnoreCase(text.toString());
        }
        if (value instanceof Collection<?> collection) {
            return !collection.isEmpty();
        }
        return value != null;
    }

    static String extractIdempotencyKey(ProcessorResult result) {
        if (result == null || !result.isSuccess()) {
            return null;
        }
        Object value = result.getOutput().get("key");
        if (value == null) {
            return null;
        }
        String normalized = String.valueOf(value).trim();
        return normalized.isEmpty() ? null : normalized;
    }

    static Map<String, Object> triggerMap(EventTrigger trigger) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("id", trigger.getId());
        value.put("name", trigger.getName());
        value.put("targetScriptId", trigger.getTargetScriptId());
        return value;
    }
}
