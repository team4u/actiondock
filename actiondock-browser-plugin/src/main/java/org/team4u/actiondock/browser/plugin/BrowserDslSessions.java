package org.team4u.actiondock.browser.plugin;

import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

final class BrowserDslSessions {
    static final String DEFAULT_SESSION = "default";

    private final BrowserGatewayService service;
    private final ConcurrentHashMap<String, String> sessionIds = new ConcurrentHashMap<>();

    BrowserDslSessions(BrowserGatewayService service) {
        this.service = service;
    }

    String sessionName(Map<String, Object> args) {
        return Args.optionalString(args, "session", DEFAULT_SESSION);
    }

    String resolveRequired(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        String session = sessionName(args);
        String key = key(context, session);
        String sessionId = sessionIds.get(key);
        if (Args.isBlank(sessionId)) {
            throw new IllegalArgumentException("Browser session is not open: " + session);
        }
        try {
            service.sessionInfo(context, Map.of("sessionId", sessionId));
            return sessionId;
        } catch (Exception exception) {
            sessionIds.remove(key);
            throw exception;
        }
    }

    String open(ScriptPluginContext context, Map<String, Object> args, boolean fresh) throws Exception {
        String session = sessionName(args);
        String key = key(context, session);
        String sessionId = sessionIds.get(key);
        if (!fresh && !Args.isBlank(sessionId)) {
            try {
                service.sessionInfo(context, Map.of("sessionId", sessionId));
                return sessionId;
            } catch (Exception ignored) {
                sessionIds.remove(key);
            }
        }
        if (!Args.isBlank(sessionId)) {
            try {
                service.closeSession(context, Map.of("sessionId", sessionId));
            } catch (Exception ignored) {
            }
        }
        Map<String, Object> createArgs = createArgs(args);
        Map<String, Object> created = service.createSession(context, createArgs);
        String createdSessionId = String.valueOf(created.get("sessionId"));
        sessionIds.put(key, createdSessionId);
        return createdSessionId;
    }

    void forget(ScriptPluginContext context, String session) {
        sessionIds.remove(key(context, session));
    }

    private static Map<String, Object> createArgs(Map<String, Object> args) {
        java.util.LinkedHashMap<String, Object> result = new java.util.LinkedHashMap<>();
        for (String key : java.util.List.of("browser", "headless", "timeoutMs", "userAgent", "locale", "timezoneId",
                "ignoreHTTPSErrors", "javaScriptEnabled", "isMobile", "hasTouch", "stateName", "storageStatePath")) {
            if (Args.has(args, key)) {
                result.put(key, args.get(key));
            }
        }
        if (Args.has(args, "viewportWidth") || Args.has(args, "viewportHeight")) {
            result.put("viewport", Map.of(
                    "width", Args.optionalInt(args, "viewportWidth", 1280),
                    "height", Args.optionalInt(args, "viewportHeight", 720)
            ));
        }
        Map<String, Object> headers = BrowserDslJson.object(args, "headersJson");
        if (!headers.isEmpty()) {
            result.put("extraHTTPHeaders", headers);
        }
        Map<String, Object> credentials = BrowserDslJson.object(args, "credentialsJson");
        if (!credentials.isEmpty()) {
            result.put("httpCredentials", credentials);
        }
        return result;
    }

    private static String key(ScriptPluginContext context, String session) {
        return BrowserSessionManager.ownerKey(context) + "\u0000" + session;
    }
}
