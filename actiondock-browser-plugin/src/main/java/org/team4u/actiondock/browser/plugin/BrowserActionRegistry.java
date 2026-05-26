package org.team4u.actiondock.browser.plugin;

import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.util.LinkedHashMap;
import java.util.Map;

final class BrowserActionRegistry {
    private final Map<String, BrowserAction> actions = new LinkedHashMap<>();

    BrowserActionRegistry register(String name, BrowserAction action) {
        if (Args.isBlank(name)) {
            throw new IllegalArgumentException("action name must not be blank");
        }
        if (action == null) {
            throw new IllegalArgumentException("action handler must not be null");
        }
        actions.put(name, action);
        return this;
    }

    Object invoke(String name, ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserAction action = actions.get(name);
        if (action == null) {
            throw new IllegalArgumentException("Unsupported browser action: " + name);
        }
        return action.handle(context, args == null ? Map.of() : args);
    }

    Map<String, BrowserAction> actions() {
        return Map.copyOf(actions);
    }
}
