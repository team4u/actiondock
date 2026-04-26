package org.team4u.actiondock.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Converts CLI requests into stable dry-run JSON.
 */
final class CliRequestPreview {
    private CliRequestPreview() {
    }

    static ObjectNode dryRun(ObjectMapper objectMapper, CliRequest request, Map<String, Object> metadata) {
        ObjectNode data = objectMapper.createObjectNode();
        ObjectNode requestNode = requestNode(objectMapper, request);
        data.set("request", requestNode);
        if (metadata != null && !metadata.isEmpty()) {
            data.set("metadata", objectMapper.valueToTree(metadata));
        }
        return data;
    }

    static ObjectNode validation(ObjectMapper objectMapper, String command) {
        ObjectNode data = objectMapper.createObjectNode();
        data.put("command", command);
        data.put("valid", true);
        return data;
    }

    static ObjectNode requestNode(ObjectMapper objectMapper, CliRequest request) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("method", request.method());
        node.put("path", request.path());
        node.set("query", objectMapper.valueToTree(request.query() == null ? Map.of() : request.query()));
        if (request.multipartBody() != null) {
            node.put("contentType", "multipart/form-data");
            Map<String, Object> multipart = new LinkedHashMap<>();
            multipart.put("fieldName", request.multipartBody().fieldName());
            multipart.put("fileName", request.multipartBody().file().getFileName().toString());
            multipart.put("size", request.multipartBody().content().length);
            node.set("multipart", objectMapper.valueToTree(multipart));
            return node;
        }
        if (request.jsonBody() != null) {
            node.put("contentType", "application/json");
            node.set("body", parseBody(objectMapper, request.jsonBody()));
        } else {
            node.putNull("contentType");
            node.putNull("body");
        }
        return node;
    }

    private static JsonNode parseBody(ObjectMapper objectMapper, String body) {
        try {
            return objectMapper.readTree(body);
        } catch (Exception exception) {
            return objectMapper.valueToTree(body);
        }
    }
}
