package org.team4u.actiondock.browser.plugin;

import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.util.LinkedHashMap;
import java.util.Map;

final class BrowserDslContext {
    private final ScriptPluginContext context;
    private final Map<String, Object> args;
    private final String session;
    private final String sessionId;
    private final String pageId;

    BrowserDslContext(ScriptPluginContext context,
                      Map<String, Object> args,
                      String session,
                      String sessionId,
                      String pageId) {
        this.context = context;
        this.args = args;
        this.session = session;
        this.sessionId = sessionId;
        this.pageId = pageId;
    }

    ScriptPluginContext context() {
        return context;
    }

    Map<String, Object> args() {
        return args;
    }

    String session() {
        return session;
    }

    String sessionId() {
        return sessionId;
    }

    String pageId() {
        return pageId;
    }

    Map<String, Object> callArgs() {
        Map<String, Object> call = new LinkedHashMap<>();
        call.put("sessionId", sessionId);
        if (!Args.isBlank(pageId)) {
            call.put("pageId", pageId);
        }
        return call;
    }
}
