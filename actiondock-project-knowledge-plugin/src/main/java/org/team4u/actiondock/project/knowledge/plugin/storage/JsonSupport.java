package org.team4u.actiondock.project.knowledge.plugin.storage;

import org.team4u.actiondock.plugin.api.PluginObjectMappers;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class JsonSupport {
    private JsonSupport() {
    }

    public static void writeJson(Path path, Object value) {
        try {
            Path parent = path.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Files.writeString(path, PluginObjectMappers.DEFAULT.writerWithDefaultPrettyPrinter().writeValueAsString(value), StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new PluginRuntimeException("Cannot write JSON file: " + path, exception);
        }
    }
}
