package org.team4u.actiondock.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.Iterator;
import java.util.Map;

/**
 * Generates minimal JSON examples from the subset of JSON Schema used by scripts.
 */
final class SchemaExampleSupport {
    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;

    private SchemaExampleSupport() {
    }

    static ObjectNode schemaContract(ObjectMapper objectMapper, JsonNode scriptDefinition) {
        ObjectNode result = objectMapper.createObjectNode();
        JsonNode inputSchema = schemaNode(scriptDefinition, "inputSchema");
        JsonNode outputSchema = schemaNode(scriptDefinition, "outputSchema");
        result.set("inputSchema", inputSchema);
        result.set("inputExample", exampleForSchema(inputSchema));
        result.set("outputSchema", outputSchema);
        result.set("outputExample", exampleForSchema(outputSchema));
        ArrayNode notes = result.putArray("notes");
        notes.add("Only send fields declared in inputSchema unless the script explicitly supports extra fields.");
        notes.add("Examples are generated from schema examples, default values, enum values, and type placeholders.");
        return result;
    }

    private static JsonNode schemaNode(JsonNode scriptDefinition, String field) {
        JsonNode node = scriptDefinition == null ? null : scriptDefinition.path(field);
        return node == null || node.isMissingNode() || node.isNull() ? JSON.objectNode() : node;
    }

    private static JsonNode exampleForSchema(JsonNode schema) {
        if (schema == null || schema.isMissingNode() || schema.isNull()) {
            return JSON.objectNode();
        }
        JsonNode explicitExample = firstExample(schema);
        if (explicitExample != null) {
            return explicitExample;
        }
        JsonNode defaultValue = schema.get("default");
        if (defaultValue != null && !defaultValue.isNull()) {
            return defaultValue;
        }
        JsonNode enumValues = schema.get("enum");
        if (enumValues != null && enumValues.isArray() && !enumValues.isEmpty()) {
            return enumValues.get(0);
        }
        String type = typeOf(schema);
        if ("object".equals(type) || schema.has("properties")) {
            ObjectNode object = JSON.objectNode();
            JsonNode properties = schema.get("properties");
            if (properties != null && properties.isObject()) {
                Iterator<Map.Entry<String, JsonNode>> fields = properties.fields();
                while (fields.hasNext()) {
                    Map.Entry<String, JsonNode> field = fields.next();
                    object.set(field.getKey(), exampleForSchema(field.getValue()));
                }
            }
            return object;
        }
        if ("array".equals(type)) {
            ArrayNode array = JSON.arrayNode();
            JsonNode items = schema.get("items");
            array.add(items == null || items.isMissingNode() ? JSON.objectNode() : exampleForSchema(items));
            return array;
        }
        return switch (type) {
            case "integer" -> JSON.numberNode(1);
            case "number" -> JSON.numberNode(1.0);
            case "boolean" -> JSON.booleanNode(true);
            case "string" -> JSON.textNode("string");
            default -> JSON.objectNode();
        };
    }

    private static JsonNode firstExample(JsonNode schema) {
        JsonNode examples = schema.get("examples");
        if (examples != null && examples.isArray() && !examples.isEmpty()) {
            return examples.get(0);
        }
        JsonNode example = schema.get("example");
        if (example != null && !example.isNull()) {
            return example;
        }
        return null;
    }

    private static String typeOf(JsonNode schema) {
        JsonNode type = schema == null ? null : schema.get("type");
        if (type != null && type.isTextual()) {
            return type.asText();
        }
        if (schema != null && schema.has("enum")) {
            return "string";
        }
        return "object";
    }
}
