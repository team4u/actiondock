package org.team4u.scriptflow.plugin.api;

import org.pf4j.ExtensionPoint;

import java.util.Map;

public interface ScriptFlowPlugin extends ExtensionPoint {
    String id();

    /**
     * Validates the effective plugin config after platform defaults have been merged.
     */
    default void validateConfig(Map<String, Object> config) {
    }

    Object invoke(String action, ScriptPluginContext context, Map<String, Object> args);
}
