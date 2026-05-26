package org.team4u.actiondock.browser.plugin;

import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class BrowserDslBatchActions {
    private final BrowserDslCommandParser parser = new BrowserDslCommandParser();
    private BrowserDslActions actions;

    void setActions(BrowserDslActions actions) {
        this.actions = actions;
    }

    Map<String, Object> batch(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        List<BrowserDslCommand> commands = parser.parse(Args.requiredString(args, "commands"));
        boolean bail = Args.optionalBoolean(args, "bail", true);
        List<Map<String, Object>> results = new ArrayList<>();
        for (BrowserDslCommand command : commands) {
            Map<String, Object> callArgs = new LinkedHashMap<>(args);
            callArgs.remove("commands");
            callArgs.remove("bail");
            callArgs.putAll(command.args());
            try {
                Object result = actions.invoke(command.action(), context, callArgs);
                results.add(Map.of("action", command.action(), "ok", true, "result", result));
            } catch (Exception exception) {
                results.add(Map.of("action", command.action(), "ok", false, "error", exception.getMessage()));
                if (bail) {
                    break;
                }
            }
        }
        Map<String, Object> result = Results.ok();
        result.put("results", results);
        result.put("count", results.size());
        return result;
    }
}
