package org.team4u.actiondock.browser.plugin;

import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

final class BrowserDslTabs {
    private static final ConcurrentHashMap<String, ConcurrentHashMap<String, String>> SHARED_PUBLIC_TO_PAGE = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, ConcurrentHashMap<String, String>> SHARED_PAGE_TO_PUBLIC = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, ConcurrentHashMap<String, String>> SHARED_LABEL_TO_PAGE = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, AtomicInteger> SHARED_COUNTERS = new ConcurrentHashMap<>();

    private final ConcurrentHashMap<String, ConcurrentHashMap<String, String>> publicToPage = SHARED_PUBLIC_TO_PAGE;
    private final ConcurrentHashMap<String, ConcurrentHashMap<String, String>> pageToPublic = SHARED_PAGE_TO_PUBLIC;
    private final ConcurrentHashMap<String, ConcurrentHashMap<String, String>> labelToPage = SHARED_LABEL_TO_PAGE;
    private final ConcurrentHashMap<String, AtomicInteger> counters = SHARED_COUNTERS;

    String pageId(ScriptPluginContext context, String session, Map<String, Object> args) {
        String tab = Args.optionalString(args, "tab", null);
        if (Args.isBlank(tab)) {
            return null;
        }
        String key = key(context, session);
        String byLabel = labelToPage.getOrDefault(key, new ConcurrentHashMap<>()).get(tab);
        if (!Args.isBlank(byLabel)) {
            return byLabel;
        }
        String pageId = publicToPage.getOrDefault(key, new ConcurrentHashMap<>()).get(tab);
        if (Args.isBlank(pageId)) {
            throw new IllegalArgumentException("Browser tab not found: " + tab);
        }
        return pageId;
    }

    String publicTab(ScriptPluginContext context, String session, String pageId) {
        if (Args.isBlank(pageId)) {
            return null;
        }
        String key = key(context, session);
        ConcurrentHashMap<String, String> reverse = pageToPublic.computeIfAbsent(key, ignored -> new ConcurrentHashMap<>());
        String existing = reverse.get(pageId);
        if (!Args.isBlank(existing)) {
            return existing;
        }
        String tab = "t" + counters.computeIfAbsent(key, ignored -> new AtomicInteger(1)).getAndIncrement();
        reverse.put(pageId, tab);
        publicToPage.computeIfAbsent(key, ignored -> new ConcurrentHashMap<>()).put(tab, pageId);
        return tab;
    }

    void label(ScriptPluginContext context, String session, String label, String pageId) {
        if (!Args.isBlank(label) && !Args.isBlank(pageId)) {
            labelToPage.computeIfAbsent(key(context, session), ignored -> new ConcurrentHashMap<>()).put(label, pageId);
        }
    }

    void forgetSession(ScriptPluginContext context, String session) {
        String key = key(context, session);
        publicToPage.remove(key);
        pageToPublic.remove(key);
        labelToPage.remove(key);
        counters.remove(key);
    }

    Map<String, Object> transformResult(ScriptPluginContext context, String session, Map<String, Object> result) {
        Map<String, Object> transformed = new LinkedHashMap<>(result);
        Object pages = transformed.get("pages");
        if (pages instanceof java.util.List<?> list) {
            transformed.put("tabs", list.stream()
                    .filter(Map.class::isInstance)
                    .map(item -> transformPageItem(context, session, (Map<?, ?>) item))
                    .toList());
            transformed.remove("pages");
        }
        Object pageId = transformed.remove("pageId");
        if (pageId != null) {
            transformed.put("tab", publicTab(context, session, String.valueOf(pageId)));
        }
        Object activePageId = transformed.remove("activePageId");
        if (activePageId != null) {
            transformed.put("activeTab", publicTab(context, session, String.valueOf(activePageId)));
        }
        return transformed;
    }

    private Map<String, Object> transformPageItem(ScriptPluginContext context, String session, Map<?, ?> item) {
        Map<String, Object> transformed = new LinkedHashMap<>();
        item.forEach((key, value) -> {
            if (!"pageId".equals(String.valueOf(key))) {
                transformed.put(String.valueOf(key), value);
            }
        });
        Object pageId = item.get("pageId");
        if (pageId != null) {
            transformed.put("tab", publicTab(context, session, String.valueOf(pageId)));
        }
        return transformed;
    }

    private static String key(ScriptPluginContext context, String session) {
        return BrowserSessionManager.ownerKey(context) + "\u0000" + session;
    }
}
