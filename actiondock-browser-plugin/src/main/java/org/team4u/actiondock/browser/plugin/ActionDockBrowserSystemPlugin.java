package org.team4u.actiondock.browser.plugin;

import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.plugin.api.PluginConfigBinder;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.util.Map;

public class ActionDockBrowserSystemPlugin implements ActionDockPlugin {
    private final BrowserActionRegistry actions;

    public ActionDockBrowserSystemPlugin() {
        BrowserSessionManager sessionManager = new BrowserSessionManager();
        BrowserPathResolver pathResolver = new BrowserPathResolver();
        BrowserGatewayService browserService = new BrowserGatewayService(sessionManager, pathResolver);

        this.actions = new BrowserActionRegistry();
        new BrowserGatewayActions(browserService).registerTo(actions);
    }

    @Override
    public String id() {
        return BrowserPluginConstants.PLUGIN_ID;
    }

    @Override
    public void validateConfig(Map<String, Object> config) {
        BrowserConfigValidator.validate(PluginConfigBinder.bind(config, BrowserPluginConfig.class));
    }

    @Override
    public Object invoke(String action, ScriptPluginContext context, Map<String, Object> args) {
        try {
            return actions.invoke(action, context, args);
        } catch (PluginRuntimeException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new PluginRuntimeException("Browser action failed: " + exception.getMessage(), exception);
        }
    }
}
