package org.team4u.actiondock.application;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 脚本模式（Schema）校验与摘要工具。
 * <p>
 * 基于 JSON Schema 规范解析脚本的输入模式，提供字段摘要提取和输入参数校验能力。
 * 支持的类型包括 string、number、integer、boolean 和 enum。
 *
 * @author jay.wu
 */
public class ScriptSchemaSupport {
    /**
     * 根据输入模式提取字段摘要信息。
     * <p>
     * 解析 JSON Schema 的 properties、required、title 等字段，
     * 生成结构化的字段摘要列表，用于前端表单渲染或文档展示。
     *
     * @param schema JSON Schema 格式的输入模式定义
     * @return 包含所有字段信息的模式摘要
     */
    public static SchemaSummary summarize(Map<String, Object> schema) {
        ParsedSchema parsedSchema = parse(schema);
        List<SchemaField> fields = parsedSchema.fields().stream()
                .map(field -> new SchemaField(
                        field.name(),
                        field.label(),
                        field.kind(),
                        field.required(),
                        field.description(),
                        field.enumValues(),
                        field.defaultValue(),
                        field.examples()
                ))
                .toList();
        return new SchemaSummary(fields);
    }

    /**
     * 校验输入参数是否符合脚本的输入模式定义。
     * <p>
     * 逐字段检查必填性、类型匹配和枚举值约束，如果模式为空则跳过校验。
     * 校验失败时抛出 {@link InvalidExecutionInputException}，包含所有字段的错误详情。
     *
     * @param scriptId 脚本 ID，用于构造异常信息
     * @param input    待校验的输入参数
     * @param schema   JSON Schema 格式的输入模式定义
     * @throws InvalidExecutionInputException 如果输入参数不符合模式定义
     */
    public static void validateInput(String scriptId, Map<String, Object> input, Map<String, Object> schema) {
        ParsedSchema parsedSchema = parse(schema);
        if (parsedSchema.fields().isEmpty()) {
            return;
        }

        Map<String, Object> payload = input == null ? Map.of() : input;
        List<SchemaFieldError> fieldErrors = new ArrayList<>();
        for (ParsedField field : parsedSchema.fields()) {
            if (!payload.containsKey(field.name())) {
                collectRequiredFieldError(field, fieldErrors);
                continue;
            }
            collectFieldTypeErrors(field, payload.get(field.name()), fieldErrors);
        }

        if (!fieldErrors.isEmpty()) {
            throw new InvalidExecutionInputException(scriptId, fieldErrors);
        }
    }

    private static void collectRequiredFieldError(ParsedField field, List<SchemaFieldError> errors) {
        if (field.required()) {
            errors.add(new SchemaFieldError(
                    field.name(),
                    "required",
                    field.label() + " 必填",
                    "present",
                    "missing"
            ));
        }
    }

    private static void collectFieldTypeErrors(ParsedField field, Object value, List<SchemaFieldError> errors) {
        if (value == null) {
            errors.add(new SchemaFieldError(
                    field.name(),
                    "type_mismatch",
                    field.label() + " 不能为空",
                    field.kind(),
                    "null"
            ));
            return;
        }

        if (!field.supported()) {
            return;
        }

        if (!matchesType(value, field.kind())) {
            errors.add(new SchemaFieldError(
                    field.name(),
                    "type_mismatch",
                    field.label() + " 类型应为 " + field.kind() + "，实际为 " + describeActualType(value),
                    field.kind(),
                    detectType(value)
            ));
            return;
        }

        if (!field.enumValues().isEmpty()) {
            String enumValue = String.valueOf(value);
            if (!field.enumValues().contains(enumValue)) {
                errors.add(new SchemaFieldError(
                        field.name(),
                        "enum_mismatch",
                        field.label() + " 必须是枚举值之一: " + String.join(", ", field.enumValues()),
                        "enum(" + String.join(", ", field.enumValues()) + ")",
                        enumValue
                ));
            }
        }
    }

    private static ParsedSchema parse(Map<String, Object> schema) {
        if (schema == null || schema.isEmpty()) {
            return new ParsedSchema(List.of());
        }

        Map<String, Object> properties = toObjectMap(schema.get("properties"));
        if (properties.isEmpty()) {
            return new ParsedSchema(List.of());
        }

        Set<String> requiredFields = toStringSet(schema.get("required"));
        List<ParsedField> fields = new ArrayList<>();
        properties.forEach((name, rawMeta) -> fields.add(parseField(name, rawMeta, requiredFields.contains(name))));
        return new ParsedSchema(fields);
    }

    private static ParsedField parseField(String name, Object rawMeta, boolean required) {
        Map<String, Object> meta = toObjectMap(rawMeta);
        String label = stringValue(meta.get("title"));
        if (label == null || label.isBlank()) {
            label = name;
        }

        String description = stringValue(meta.get("description"));
        List<String> enumValues = toStringList(meta.get("enum"));
        Object defaultValue = meta.get("default");
        List<Object> examples = toObjectList(meta.get("examples"));

        if (!enumValues.isEmpty()) {
            String type = stringValue(meta.get("type"));
            boolean supported = type == null || "string".equals(type);
            return new ParsedField(name, label, "enum", required, description, enumValues, defaultValue, examples, supported);
        }

        String type = stringValue(meta.get("type"));
        boolean supported = isSupportedType(type);
        String kind = supported ? type : type == null ? "unknown" : type;
        return new ParsedField(name, label, kind, required, description, List.of(), defaultValue, examples, supported);
    }

    private static boolean matchesType(Object value, String kind) {
        return switch (kind) {
            case "string", "enum" -> value instanceof String;
            case "boolean" -> value instanceof Boolean;
            case "number" -> value instanceof Number;
            case "integer" -> isInteger(value);
            default -> true;
        };
    }

    private static boolean isInteger(Object value) {
        if (!(value instanceof Number number)) {
            return false;
        }
        if (number instanceof Byte || number instanceof Short || number instanceof Integer || number instanceof Long || number instanceof BigInteger) {
            return true;
        }
        if (number instanceof BigDecimal decimal) {
            return decimal.stripTrailingZeros().scale() <= 0;
        }
        if (number instanceof Float || number instanceof Double) {
            double doubleValue = number.doubleValue();
            return Double.isFinite(doubleValue) && doubleValue == Math.rint(doubleValue);
        }
        return false;
    }

    private static String detectType(Object value) {
        return switch (value) {
            case null -> "null";
            case String s -> "string";
            case Boolean b -> "boolean";
            case Number n -> isInteger(n) ? "integer" : "number";
            case List<?> l -> "array";
            case Map<?, ?> m -> "object";
            default -> value.getClass().getSimpleName();
        };
    }

    private static String describeActualType(Object value) {
        String logicalType = detectType(value);
        if (value == null || value instanceof String || value instanceof Boolean
                || value instanceof Number || value instanceof List<?> || value instanceof Map<?, ?>) {
            return logicalType;
        }
        return logicalType + " (" + value.getClass().getName() + ")";
    }

    private static final Set<String> SUPPORTED_SCHEMA_TYPES = Set.of("string", "number", "integer", "boolean");

    private static boolean isSupportedType(String type) {
        return SUPPORTED_SCHEMA_TYPES.contains(type);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> toObjectMap(Object value) {
        if (!(value instanceof Map<?, ?> source)) {
            return Map.of();
        }
        Map<String, Object> result = new LinkedHashMap<>();
        source.forEach((key, item) -> result.put(String.valueOf(key), item));
        return result;
    }

    private static Set<String> toStringSet(Object value) {
        if (!(value instanceof List<?> items)) {
            return Set.of();
        }
        Set<String> values = new LinkedHashSet<>();
        items.stream()
                .filter(String.class::isInstance)
                .map(String.class::cast)
                .forEach(values::add);
        return values;
    }

    private static List<String> toStringList(Object value) {
        if (!(value instanceof List<?> items)) {
            return List.of();
        }
        List<String> values = new ArrayList<>();
        for (Object item : items) {
            if (!(item instanceof String text)) {
                return List.of();
            }
            values.add(text);
        }
        return List.copyOf(values);
    }

    private static List<Object> toObjectList(Object value) {
        if (!(value instanceof List<?> items)) {
            return List.of();
        }
        return List.copyOf(items);
    }

    private static String stringValue(Object value) {
        return value instanceof String text ? text : null;
    }

    private record ParsedSchema(List<ParsedField> fields) {
    }

    private record ParsedField(
            String name,
            String label,
            String kind,
            boolean required,
            String description,
            List<String> enumValues,
            Object defaultValue,
            List<Object> examples,
            boolean supported
    ) {
    }

    public record SchemaSummary(
            List<SchemaField> fields
    ) {
    }

    public record SchemaField(
            String name,
            String label,
            String kind,
            boolean required,
            String description,
            List<String> enumValues,
            Object defaultValue,
            List<Object> examples
    ) {
    }
}
