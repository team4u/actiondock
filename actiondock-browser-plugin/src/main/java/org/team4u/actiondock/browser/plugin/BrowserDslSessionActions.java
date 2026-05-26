package org.team4u.actiondock.browser.plugin;

import java.util.LinkedHashMap;
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
        return finish(dsl, "sessionList", namedSessionList(dsl, service.sessionList(dsl.context())));
    }

    Map<String, Object> sessionClose(BrowserDslContext dsl) {
        sessions.forget(dsl.context(), dsl.session());
        tabs.forgetSession(dsl.context(), dsl.session());
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
        if (!Args.isBlank(dsl.session())) {
            result.put("session", dsl.session());
        }
        result.remove("op");
        result.put("action", action);
        return tabs.transformResult(dsl.context(), dsl.session(), result);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> namedSessionList(BrowserDslContext dsl, Map<String, Object> result) {
        Map<String, String> names = sessions.namesForOwner(dsl.context());
        Object sessionsValue = result.get("sessions");
        if (!(sessionsValue instanceof java.util.List<?> list)) {
            return result;
        }
        java.util.List<Map<String, Object>> transformed = new java.util.ArrayList<>();
        for (Object item : list) {
            if (item instanceof Map<?, ?> map) {
                Map<String, Object> session = new LinkedHashMap<>();
                map.forEach((key, value) -> {
                    if (!"sessionId".equals(String.valueOf(key))) {
                        session.put(String.valueOf(key), value);
                    }
                });
                Object sessionId = map.get("sessionId");
                if (sessionId != null && names.containsKey(String.valueOf(sessionId))) {
                    session.put("session", names.get(String.valueOf(sessionId)));
                }
                transformed.add(session);
            }
        }
        result.put("sessions", transformed);
        return result;
    }
}
