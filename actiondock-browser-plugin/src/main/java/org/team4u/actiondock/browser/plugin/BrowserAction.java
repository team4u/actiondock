package org.team4u.actiondock.browser.plugin;

import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.util.Map;

@FunctionalInterface
interface BrowserAction {
    Object handle(ScriptPluginContext context, Map<String, Object> args) throws Exception;
}
