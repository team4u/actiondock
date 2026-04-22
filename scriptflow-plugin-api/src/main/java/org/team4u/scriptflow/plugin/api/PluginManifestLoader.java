package org.team4u.scriptflow.plugin.api;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;

public final class PluginManifestLoader {
    private static final String MANIFEST_ROOT = "META-INF/scriptflow/plugins/";
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private PluginManifestLoader() {
    }

    public static PluginManifest loadResource(Class<?> anchorType, String resourcePath) {
        if (anchorType == null) {
            throw new IllegalArgumentException("anchorType must not be null");
        }
        if (resourcePath == null || resourcePath.isBlank()) {
            throw new IllegalArgumentException("resourcePath must not be blank");
        }

        try (InputStream inputStream = anchorType.getResourceAsStream(resourcePath)) {
            if (inputStream == null) {
                throw new IllegalArgumentException("Plugin manifest resource not found: " + resourcePath);
            }
            return OBJECT_MAPPER.readValue(inputStream, PluginManifest.class);
        } catch (IOException e) {
            throw new IllegalArgumentException("Cannot read plugin manifest resource: " + resourcePath, e);
        }
    }

    public static PluginManifest load(Class<?> anchorType, String pluginId) {
        if (anchorType == null) {
            throw new IllegalArgumentException("anchorType must not be null");
        }
        if (pluginId == null || pluginId.isBlank()) {
            throw new IllegalArgumentException("pluginId must not be blank");
        }

        String resourcePath = MANIFEST_ROOT + pluginId + ".json";
        try (InputStream inputStream = anchorType.getClassLoader().getResourceAsStream(resourcePath)) {
            if (inputStream == null) {
                throw new IllegalArgumentException("Plugin manifest resource not found for pluginId: " + pluginId);
            }
            return OBJECT_MAPPER.readValue(inputStream, PluginManifest.class);
        } catch (IOException e) {
            throw new IllegalArgumentException("Cannot read plugin manifest for pluginId: " + pluginId, e);
        }
    }
}
