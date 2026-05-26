package org.team4u.actiondock.browser.plugin;

import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

final class BrowserDslSessions {
    private static final ConcurrentHashMap<String, String> SHARED_SESSION_IDS = new ConcurrentHashMap<>();

    private final BrowserGatewayService service;
    private final ConcurrentHashMap<String, String> sessionIds = SHARED_SESSION_IDS;

    BrowserDslSessions(BrowserGatewayService service) {
        this.service = service;
    }

    String sessionName(Map<String, Object> args) {
        String session = Args.optionalString(args, "session", null);
        if (Args.isBlank(session)) {
            throw new IllegalArgumentException("session is required; pass --session <name>");
        }
        return session.trim();
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

    void remember(ScriptPluginContext context, String session, String sessionId) {
        if (!Args.isBlank(session) && !Args.isBlank(sessionId)) {
            sessionIds.put(key(context, session), sessionId);
        }
    }

    Map<String, String> namesForOwner(ScriptPluginContext context) {
        String prefix = BrowserSessionManager.ownerKey(context) + "\u0000";
        Map<String, String> result = new LinkedHashMap<>();
        sessionIds.forEach((key, sessionId) -> {
            if (key.startsWith(prefix)) {
                result.put(sessionId, key.substring(prefix.length()));
            }
        });
        return result;
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
