package org.team4u.actiondock.browser.plugin;

import java.util.Map;

final class BrowserDslSessionActions {
    private final BrowserGatewayService service;
    private final BrowserDslSessions sessions;
    private final BrowserDslTabs tabs;

    BrowserDslSessionActions(BrowserGatewayService service, BrowserDslSessions sessions, BrowserDslTabs tabs) {
        this.service = service;
        this.sessions = sessions;
        this.tabs = tabs;
    }

    Map<String, Object> sessionInfo(BrowserDslContext dsl) throws Exception {
        return finish(dsl, "sessionInfo", service.sessionInfo(dsl.context(), dsl.callArgs()));
    }

    Map<String, Object> sessionList(BrowserDslContext dsl) {
        return finish(dsl, "sessionList", service.sessionList(dsl.context()));
    }

    Map<String, Object> sessionClose(BrowserDslContext dsl) {
        sessions.forget(dsl.context(), dsl.session());
        return finish(dsl, "sessionClose", service.closeSession(dsl.context(), dsl.callArgs()));
    }

    Map<String, Object> tabList(BrowserDslContext dsl) throws Exception {
        return finish(dsl, "tabList", service.tabs(dsl.context(), BrowserDslSupport.merge(dsl.callArgs(), "op", "list")));
    }

    Map<String, Object> tabNew(BrowserDslContext dsl) throws Exception {
        Map<String, Object> call = dsl.callArgs();
        BrowserDslSupport.copyIfPresent(dsl.args(), call, "url");
        call.put("op", "new");
        Map<String, Object> result = service.tabs(dsl.context(), call);
        Object data = result.get("data");
        if (data instanceof Map<?, ?> map && map.get("pageId") != null) {
            tabs.label(dsl.context(), dsl.session(), Args.optionalString(dsl.args(), "label", null), String.valueOf(map.get("pageId")));
        }
        return finish(dsl, "tabNew", result);
    }

    Map<String, Object> tabSwitch(BrowserDslContext dsl) throws Exception {
        return finish(dsl, "tabSwitch", service.tabs(dsl.context(), BrowserDslSupport.merge(dsl.callArgs(), "op", "switch")));
    }

    Map<String, Object> tabClose(BrowserDslContext dsl) throws Exception {
        return finish(dsl, "tabClose", service.tabs(dsl.context(), BrowserDslSupport.merge(dsl.callArgs(), "op", "close")));
    }

    Map<String, Object> tabBringToFront(BrowserDslContext dsl) throws Exception {
        return finish(dsl, "tabBringToFront", service.tabs(dsl.context(), BrowserDslSupport.merge(dsl.callArgs(), "op", "bringToFront")));
    }

    private Map<String, Object> finish(BrowserDslContext dsl, String action, Map<String, Object> result) {
        result.put("session", dsl.session());
        result.put("action", action);
        return tabs.transformResult(dsl.context(), dsl.session(), result);
    }
}
