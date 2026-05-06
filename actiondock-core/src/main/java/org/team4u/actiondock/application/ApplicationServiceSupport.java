package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.NormalizedEvent;
import org.team4u.actiondock.domain.model.ProcessorContext;
import org.team4u.actiondock.domain.model.ProcessorDefinition;
import org.team4u.actiondock.domain.model.ProcessorResult;
import org.team4u.actiondock.domain.port.ProcessorEngine;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Consumer;
import java.util.regex.Pattern;

/**
 * 应用服务层公共工具方法。
 *
 * @author jay.wu
 */
final class ApplicationServiceSupport {

    private ApplicationServiceSupport() {
    }

    /**
     * 校验并规范化字符串值，空白则抛出异常。
     *
     * @param value   待校验的字符串
     * @param message 异常消息
     * @return 去除首尾空格后的字符串
     * @throws IllegalArgumentException 如果值为 null 或空白
     */
    static String normalize(String value, String message) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(message);
        }
        return value.trim();
    }

    static String normalizePattern(String value, String fieldName, Pattern pattern) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " 不能为空");
        }
        String normalized = value.trim();
        if (!pattern.matcher(normalized).matches()) {
            throw new IllegalArgumentException(fieldName + " 格式不合法: " + value);
        }
        return normalized;
    }

    static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    /**
     * 将标准化事件转换为上下文可用的 Map 结构。
     *
     * @param event 标准化事件
     * @return 包含事件全部字段的 Map
     */
    static Map<String, Object> toEventMap(NormalizedEvent event) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("id", event.getId());
        value.put("sourceId", event.getSourceId());
        value.put("sourceKey", event.getSourceKey());
        value.put("eventType", event.getEventType());
        value.put("eventId", event.getEventId());
        value.put("actor", event.getActor());
        value.put("subject", event.getSubject());
        value.put("timestamp", event.getTimestamp());
        value.put("headers", event.getHeaders());
        value.put("query", event.getQuery());
        value.put("body", event.getBody());
        value.put("receivedAt", event.getReceivedAt() == null ? null : event.getReceivedAt().toString());
        return value;
    }

    /**
     * 将事件源定义转换为上下文可用的 Map 结构。
     *
     * @param source 事件源定义
     * @return 包含事件源标识信息的 Map
     */
    static Map<String, Object> toSourceMap(EventSourceDefinition source) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("id", source.getId());
        value.put("key", source.getKey());
        value.put("name", source.getName());
        return value;
    }

    static void validateProcessor(ProcessorEngine processorEngine,
                                  ProcessorDefinition processor,
                                  ProcessorContext context,
                                  String fieldName) {
        if (processor == null) {
            return;
        }
        ProcessorResult result = processorEngine.process(processor, context);
        if (!result.isSuccess()) {
            throw new IllegalArgumentException(fieldName + " 不可执行: " + result.getErrorMessage());
        }
    }

    static ProcessorContext contextFromSample(Map<String, Object> sampleContext) {
        if (sampleContext == null || sampleContext.isEmpty()) {
            return new ProcessorContext();
        }
        ProcessorContext context = new ProcessorContext();
        setMapField(sampleContext, "event", context::setEvent);
        setMapField(sampleContext, "headers", context::setHeaders);
        setMapField(sampleContext, "query", context::setQuery);
        setMapField(sampleContext, "body", context::setBody);
        setMapField(sampleContext, "source", context::setSource);
        setMapField(sampleContext, "trigger", context::setTrigger);
        setMapField(sampleContext, "variables", context::setVariables);
        return context;
    }

    static void setMapField(Map<String, Object> source, String key, Consumer<Map<String, Object>> setter) {
        if (source.get(key) instanceof Map<?, ?> map) {
            setter.accept(MapValueConverter.toResultMap(map));
        }
    }
}
