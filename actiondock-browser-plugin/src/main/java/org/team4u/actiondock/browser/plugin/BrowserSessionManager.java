package org.team4u.actiondock.browser.plugin;

import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

final class BrowserSessionManager {
    private static final ConcurrentHashMap<String, BrowserSession> sharedSessions = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, BrowserSession> sessions = sharedSessions;

    String newSessionId() {
        return "br_" + UUID.randomUUID().toString().replace("-", "");
    }

    void add(BrowserPluginConfig config, BrowserSession session) {
        cleanupExpired(config);
        if (sessions.size() >= config.getMaxSessions()) {
            throw new IllegalStateException("Too many browser sessions. maxSessions=" + config.getMaxSessions());
        }
        sessions.put(session.sessionId(), session);
    }

    BrowserSession require(ScriptPluginContext context, BrowserPluginConfig config, Map<String, Object> args) {
        cleanupExpired(config);
        String sessionId = Args.requiredString(args, "sessionId");
        BrowserSession session = sessions.get(sessionId);
        if (session == null || session.isClosed()) {
            throw new IllegalArgumentException("Browser session not found: " + sessionId);
        }
        assertSameOwner(context, session);
        return session;
    }

    Map<String, Object> close(ScriptPluginContext context, BrowserPluginConfig config, Map<String, Object> args) {
        cleanupExpired(config);
        String sessionId = Args.requiredString(args, "sessionId");
        BrowserSession session = sessions.remove(sessionId);
        if (session == null) {
            Map<String, Object> result = Results.ok("Browser session already closed or not found.");
            result.put("sessionId", sessionId);
            result.put("closed", false);
            return result;
        }
        assertSameOwner(context, session);
        session.close();
        Map<String, Object> result = Results.ok("Browser session closed.");
        result.put("sessionId", sessionId);
        result.put("closed", true);
        return result;
    }

    private void assertSameOwner(ScriptPluginContext context, BrowserSession session) {
        String currentOwner = ownerKey(context);
        String sessionOwner = session.ownerKey();
        if (!Args.isBlank(currentOwner) && !Args.isBlank(sessionOwner) && !currentOwner.equals(sessionOwner)) {
            throw new IllegalArgumentException("Browser session does not belong to current script execution");
        }
    }

    void cleanupExpired(BrowserPluginConfig config) {
        Instant now = Instant.now();
        Duration ttl = Duration.ofSeconds(config.getSessionTtlSeconds());
        sessions.forEach((sessionId, session) -> {
            if (session.isClosed() || Duration.between(session.lastAccessAt(), now).compareTo(ttl) > 0) {
                BrowserSession removed = sessions.remove(sessionId);
                if (removed != null) {
                    removed.close();
                }
            }
        });
    }

    Map<String, Object> info(BrowserSession session) throws Exception {
        return session.withLock(() -> {
            Map<String, Object> result = Results.ok();
            result.put("sessionId", session.sessionId());
            result.put("browser", session.browserName());
            result.put("url", session.page().url());
            result.put("title", session.page().title());
            result.put("activePageId", session.activePageId());
            result.put("pages", session.pagesInfo());
            result.put("createdAt", session.createdAt().toString());
            result.put("lastAccessAt", session.lastAccessAt().toString());
            return result;
        });
    }

    Map<String, Object> list(ScriptPluginContext context, BrowserPluginConfig config) {
        cleanupExpired(config);
        String ownerKey = ownerKey(context);
        var items = sessions.values().stream()
                .filter(session -> Args.isBlank(ownerKey) || ownerKey.equals(session.ownerKey()))
                .map(session -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("sessionId", session.sessionId());
                    item.put("browser", session.browserName());
                    item.put("activePageId", session.activePageId());
                    item.put("createdAt", session.createdAt().toString());
                    item.put("lastAccessAt", session.lastAccessAt().toString());
                    item.put("closed", session.isClosed());
                    return item;
                })
                .toList();
        Map<String, Object> result = Results.ok();
        result.put("sessions", items);
        result.put("count", items.size());
        return result;
    }

    static String ownerKey(ScriptPluginContext context) {
        if (context == null) {
            return "anonymous";
        }
        if (!Args.isBlank(context.getExecutionId())) {
            return "execution:" + context.getExecutionId();
        }
        if (!Args.isBlank(context.getScriptId())) {
            return "script:" + context.getScriptId();
        }
        return "anonymous";
    }
}
