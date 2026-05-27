package org.team4u.actiondock.browser.plugin;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class BrowserActionSpecs {
    private BrowserActionSpecs() {
    }

    static List<String> actionNames() {
        return actions().stream().map(item -> String.valueOf(item.get("action"))).toList();
    }

    static Map<String, Object> capabilities() {
        Map<String, Object> result = Results.ok();
        result.put("actions", actions());
        result.put("selector", Map.of("ref", "@e1 from snapshot", "css", "css:#submit", "selector", "#submit or .item"));
        result.put("workflow", List.of("Call open first; if --session is omitted, use the returned session value in later actions.", "open -> snapshot --session <returned-session> -> click --session <returned-session> --target @e1", "Use snapshot elements[].ref as --target @e1.", "Use findClick/findFill for semantic locators."));
        return result;
    }

    static List<Map<String, Object>> actions() {
        List<Map<String, Object>> actions = new ArrayList<>();
        add(actions, "open", "Open", "Create or reuse a browser session and optionally navigate.", schema(
                p("session", str()), p("url", str()), p("fresh", bool()), p("browser", enumSchema("chromium", "firefox", "webkit")),
                p("headless", bool()), p("timeoutMs", integer()), p("waitUntil", enumSchema("load", "domcontentloaded", "networkidle", "commit")),
                p("viewportWidth", integer()), p("viewportHeight", integer()), p("userAgent", str()), p("locale", str()),
                p("timezoneId", str()), p("stateName", str()), p("storageStatePath", str()), p("headersJson", str()),
                p("credentialsJson", str()), p("label", str())
        ), pageResult(), Map.of());
        add(actions, "snapshot", "Snapshot", "Read page text, refs, forms, frames, events, and suggestions.", pageSchema(
                p("limit", integer()), p("maxTextLength", integer()), p("interactiveOnly", bool()), p("compact", bool()),
                p("depth", integer()), p("scopeTarget", str()), p("includeUrls", bool())
        ), snapshotResult(), Map.of("limit", 80));

        element(actions, "click", "Click", "Click target.", targetSchema(), Map.of("target", "@e2"));
        element(actions, "dblclick", "Double Click", "Double-click target.", targetSchema(), Map.of("target", "@e2"));
        element(actions, "fill", "Fill", "Clear and fill target text.", targetSchema(p("text", str())), Map.of("target", "@e3", "text", "hello@example.com"));
        element(actions, "type", "Type", "Type text into target.", targetSchema(p("text", str())), Map.of("target", "@e3", "text", "hello"));
        element(actions, "press", "Press", "Press key globally or on target.", pageSchema(p("target", str()), p("key", str())), Map.of("key", "Enter"));
        element(actions, "hover", "Hover", "Hover target.", targetSchema(), Map.of("target", "@e2"));
        element(actions, "focus", "Focus", "Focus target.", targetSchema(), Map.of("target", "@e2"));
        element(actions, "clear", "Clear", "Clear target value.", targetSchema(), Map.of("target", "@e2"));
        element(actions, "select", "Select", "Select option value.", targetSchema(p("value", str())), Map.of("target", "@e4", "value", "US"));
        element(actions, "check", "Check", "Check checkbox or radio.", targetSchema(), Map.of("target", "@e4"));
        element(actions, "uncheck", "Uncheck", "Uncheck checkbox.", targetSchema(), Map.of("target", "@e4"));
        element(actions, "upload", "Upload", "Set file input path.", targetSchema(p("path", str())), Map.of("target", "@e5", "path", "./upload.txt"));
        element(actions, "drag", "Drag", "Drag target to another target.", targetSchema(p("to", str())), Map.of("target", "@e1", "to", "@e2"));
        element(actions, "scrollIntoView", "Scroll Into View", "Scroll target into view.", targetSchema(), Map.of("target", "@e2"));
        element(actions, "reload", "Reload", "Reload active tab.", pageSchema(p("waitUntil", str()), p("timeoutMs", integer())), Map.of());
        element(actions, "back", "Back", "Go back in history.", pageSchema(p("waitUntil", str()), p("timeoutMs", integer())), Map.of());
        element(actions, "forward", "Forward", "Go forward in history.", pageSchema(p("waitUntil", str()), p("timeoutMs", integer())), Map.of());
        add(actions, "keyboardType", "Keyboard Type", "Type with page keyboard.", pageSchema(p("text", str())), pageResult(), Map.of("text", "hello"));
        add(actions, "keyboardInsertText", "Keyboard Insert Text", "Insert text without key events.", pageSchema(p("text", str())), pageResult(), Map.of("text", "hello"));
        add(actions, "keyDown", "Key Down", "Hold a key down.", pageSchema(p("key", str())), pageResult(), Map.of("key", "Shift"));
        add(actions, "keyUp", "Key Up", "Release a key.", pageSchema(p("key", str())), pageResult(), Map.of("key", "Shift"));
        add(actions, "scroll", "Scroll", "Scroll page or target.", targetOptionalSchema(p("direction", enumSchema("up", "down", "left", "right")), p("pixels", integer())), pageResult(), Map.of("direction", "down", "pixels", 600));
        add(actions, "mouseMove", "Mouse Move", "Move mouse cursor to viewport coordinates.", pageSchema(p("x", number()), p("y", number())), pageResult(), Map.of("x", 100, "y", 120));
        add(actions, "mouseDown", "Mouse Down", "Press mouse button.", pageSchema(p("button", enumSchema("left", "right", "middle"))), pageResult(), Map.of("button", "left"));
        add(actions, "mouseUp", "Mouse Up", "Release mouse button.", pageSchema(p("button", enumSchema("left", "right", "middle"))), pageResult(), Map.of("button", "left"));
        add(actions, "mouseWheel", "Mouse Wheel", "Scroll with mouse wheel deltas.", pageSchema(p("dx", number()), p("dy", number())), pageResult(), Map.of("dy", 600));

        for (String action : List.of("findClick", "findHover", "findFocus", "findCheck", "findUncheck", "findText")) {
            add(actions, action, title(action), "Find by semantic locator and run " + action.substring(4).toLowerCase() + ".", findSchema(), pageResult(), Map.of("by", "role", "query", "button", "name", "Submit"));
        }
        add(actions, "findFill", "Find Fill", "Find by semantic locator and fill text.", findSchema(p("text", str())), pageResult(), Map.of("by", "label", "query", "Email", "text", "hello@example.com"));
        add(actions, "findType", "Find Type", "Find by semantic locator and type text.", findSchema(p("text", str())), pageResult(), Map.of("by", "label", "query", "Email", "text", "hello"));

        addRead(actions);
        addWaits(actions);
        addTabsAndSessions(actions);
        addArtifactsAndDialog(actions);
        addStateAndNetwork(actions);
        add(actions, "eval", "Eval", "Run JavaScript on page or locator.", pageSchema(p("scope", enumSchema("page", "locator", "all")), p("target", str()), p("expression", str()), p("argJson", str())), valueResult(), Map.of("expression", "() => document.title"));
        add(actions, "batch", "Batch", "Run newline-separated browser DSL commands.", schema(p("session", str()), p("commands", str()), p("bail", bool())), obj(props(p("ok", bool()), p("results", arr(object())), p("count", integer()))), Map.of("session", "run1", "commands", "open https://example.com\nsnapshot\nclick @e2"));
        add(actions, "capabilities", "Capabilities", "Return action schemas and workflow hints.", schema(), obj(props(p("ok", bool()), p("actions", arr(actionDescriptorSchema())), p("selector", object()), p("workflow", arr(str())))), Map.of());
        return actions;
    }

    private static void addRead(List<Map<String, Object>> actions) {
        for (String action : List.of("getText", "getHtml", "getValue", "getCount", "getBox")) {
            add(actions, action, title(action), "Read " + action.substring(3).toLowerCase() + " from target.", targetSchema(), valueResult(), Map.of("target", "@e1"));
        }
        add(actions, "getAttr", "Get Attr", "Read an attribute from target.", targetSchema(p("name", str())), valueResult(), Map.of("target", "@e1", "name", "href"));
        add(actions, "getTitle", "Get Title", "Read page title.", pageSchema(), valueResult(), Map.of());
        add(actions, "getUrl", "Get URL", "Read page URL.", pageSchema(), valueResult(), Map.of());
        for (String action : List.of("isVisible", "isEnabled", "isChecked")) {
            add(actions, action, title(action), "Check target state.", targetSchema(), valueResult(), Map.of("target", "@e1"));
        }
    }

    private static void addWaits(List<Map<String, Object>> actions) {
        add(actions, "waitForElement", "Wait For Element", "Wait for target state.", targetSchema(p("state", str()), p("timeoutMs", integer())), pageResult(), Map.of("target", "@e1", "state", "visible"));
        add(actions, "waitForText", "Wait For Text", "Wait for body text.", pageSchema(p("text", str()), p("timeoutMs", integer())), pageResult(), Map.of("text", "Welcome"));
        add(actions, "waitForUrl", "Wait For URL", "Wait for URL pattern.", pageSchema(p("url", str()), p("timeoutMs", integer())), pageResult(), Map.of("url", "**/dashboard"));
        add(actions, "waitForLoad", "Wait For Load", "Wait for load state.", pageSchema(p("state", str()), p("timeoutMs", integer())), pageResult(), Map.of("state", "load"));
        add(actions, "waitForFunction", "Wait For Function", "Wait for JS expression.", pageSchema(p("value", str()), p("argJson", str()), p("timeoutMs", integer())), pageResult(), Map.of("value", "() => window.ready === true"));
        for (String action : List.of("waitForRequest", "waitForResponse")) {
            add(actions, action, title(action), "Wait for matching URL.", pageSchema(p("value", str()), p("timeoutMs", integer())), pageResult(), Map.of("value", "**/api/**"));
        }
        for (String action : List.of("waitForConsole", "waitForPopup", "waitForDownload")) {
            add(actions, action, title(action), "Wait for browser event.", pageSchema(p("timeoutMs", integer())), pageResult(), Map.of());
        }
        add(actions, "waitForTimeout", "Wait For Timeout", "Sleep for timeoutMs.", pageSchema(p("timeoutMs", integer())), pageResult(), Map.of("timeoutMs", 1000));
    }

    private static void addTabsAndSessions(List<Map<String, Object>> actions) {
        add(actions, "tabList", "Tab List", "List tabs.", schema(p("session", str())), tabListResult(), Map.of("session", "run1"));
        add(actions, "tabNew", "Tab New", "Create and switch to a new tab.", schema(p("session", str()), p("url", str()), p("label", str())), pageResult(), Map.of("session", "run1", "url", "https://example.com", "label", "docs"));
        for (String action : List.of("tabSwitch", "tabClose", "tabBringToFront")) {
            add(actions, action, title(action), "Operate a tab by id or label.", schema(p("session", str()), p("tab", str())), pageResult(), Map.of("session", "run1", "tab", "docs"));
        }
        add(actions, "sessionInfo", "Session Info", "Show named session info.", schema(p("session", str())), sessionResult(), Map.of("session", "run1"));
        add(actions, "sessionList", "Session List", "List sessions.", schema(), sessionResult(), Map.of());
        add(actions, "sessionClose", "Session Close", "Close named session.", schema(p("session", str())), sessionResult(), Map.of("session", "run1"));
    }

    private static void addArtifactsAndDialog(List<Map<String, Object>> actions) {
        add(actions, "screenshot", "Screenshot", "Take page or element screenshot.", targetOptionalSchema(p("name", str()), p("path", str()), p("fullPage", bool()), p("annotate", bool()), p("quality", integer())), pageResult(), Map.of("name", "page", "fullPage", true));
        add(actions, "pdf", "PDF", "Save page as PDF.", pageSchema(p("name", str()), p("path", str()), p("format", str()), p("printBackground", bool()), p("landscape", bool()), p("scale", number()), p("pageRanges", str()), p("width", str()), p("height", str())), pageResult(), Map.of("name", "page", "format", "A4"));
        add(actions, "dialogList", "Dialog List", "List pending dialogs.", pageSchema(), pageResult(), Map.of());
        add(actions, "dialogAccept", "Dialog Accept", "Accept dialog by id.", pageSchema(p("id", str()), p("text", str())), pageResult(), Map.of("id", "d1"));
        add(actions, "dialogDismiss", "Dialog Dismiss", "Dismiss dialog by id.", pageSchema(p("id", str())), pageResult(), Map.of("id", "d1"));
    }

    private static void addStateAndNetwork(List<Map<String, Object>> actions) {
        add(actions, "cookiesList", "Cookies List", "List cookies.", schema(p("session", str()), p("url", str())), sessionResult(), Map.of());
        add(actions, "cookiesSet", "Cookies Set", "Set cookie via flat fields or cookiesJson.", schema(p("session", str()), p("name", str()), p("value", str()), p("url", str()), p("domain", str()), p("path", str()), p("expires", number()), p("httpOnly", bool()), p("secure", bool()), p("sameSite", str()), p("cookiesJson", str())), sessionResult(), Map.of("name", "sid", "value", "1", "url", "https://example.com"));
        add(actions, "cookiesClear", "Cookies Clear", "Clear cookies.", schema(p("session", str())), sessionResult(), Map.of());
        add(actions, "storageState", "Storage State", "Return or save storage state.", pageSchema(p("stateName", str()), p("path", str()), p("storageStatePath", str()), p("indexedDB", bool())), valueResult(), Map.of("stateName", "login"));
        add(actions, "storageGet", "Storage Get", "Read local/session storage.", pageSchema(p("area", enumSchema("local", "session")), p("key", str())), valueResult(), Map.of("area", "local", "key", "token"));
        add(actions, "storageSet", "Storage Set", "Set local/session storage.", pageSchema(p("area", enumSchema("local", "session")), p("key", str()), p("value", str())), valueResult(), Map.of("area", "local", "key", "token", "value", "abc"));
        add(actions, "storageClear", "Storage Clear", "Clear local/session storage.", pageSchema(p("area", enumSchema("local", "session"))), valueResult(), Map.of("area", "local"));
        add(actions, "networkRequest", "Network Request", "Send request with browser context.", pageSchema(p("url", str()), p("method", str()), p("headersJson", str()), p("queryJson", str()), p("body", str()), p("bodyJson", str()), p("timeoutMs", integer()), p("maxBodyLength", integer()), p("failOnStatusCode", bool())), sessionResult(), Map.of("url", "https://example.com/api", "method", "GET"));
        add(actions, "networkRoute", "Network Route", "Route matching requests.", pageSchema(p("url", str()), p("routeAction", str()), p("status", integer()), p("body", str()), p("headersJson", str()), p("contentType", str())), sessionResult(), Map.of("url", "**/*.png", "routeAction", "abort"));
        add(actions, "networkUnroute", "Network Unroute", "Remove route.", pageSchema(p("routeId", str()), p("url", str())), sessionResult(), Map.of());
        add(actions, "networkOffline", "Network Offline", "Toggle offline mode.", pageSchema(p("value", bool())), sessionResult(), Map.of("value", true));
        add(actions, "networkHeaders", "Network Headers", "Set extra HTTP headers.", pageSchema(p("headersJson", str())), sessionResult(), Map.of("headersJson", "{\"X-Test\":\"1\"}"));
        add(actions, "networkEvents", "Network Events", "Read buffered browser events.", pageSchema(p("types", str()), p("sinceId", integer()), p("clear", bool())), sessionResult(), Map.of("types", "request,response"));
        add(actions, "consoleList", "Console List", "List buffered console messages.", pageSchema(p("sinceId", integer()), p("clear", bool())), sessionResult(), Map.of());
        add(actions, "errorList", "Error List", "List buffered page errors.", pageSchema(p("sinceId", integer()), p("clear", bool())), sessionResult(), Map.of());
        add(actions, "requestList", "Request List", "List tracked requests.", pageSchema(p("text", str()), p("method", str()), p("status", str()), p("resourceType", str()), p("sinceId", integer()), p("clear", bool())), sessionResult(), Map.of());
        add(actions, "requestGet", "Request Get", "Get tracked request detail.", pageSchema(p("requestId", str())), sessionResult(), Map.of("requestId", "rq1"));
        add(actions, "traceStart", "Trace Start", "Start browser tracing.", pageSchema(), sessionResult(), Map.of());
        add(actions, "traceStop", "Trace Stop", "Stop tracing and save artifact.", pageSchema(p("name", str()), p("path", str())), sessionResult(), Map.of("name", "trace"));
        add(actions, "harStart", "HAR Start", "Start request capture for HAR export.", pageSchema(p("name", str()), p("path", str())), sessionResult(), Map.of("name", "network"));
        add(actions, "harStop", "HAR Stop", "Stop HAR capture and save artifact.", pageSchema(), sessionResult(), Map.of());
        add(actions, "snapshotDiff", "Snapshot Diff", "Compare current snapshot against prior snapshot or saved JSON.", pageSchema(p("limit", integer()), p("maxTextLength", integer()), p("interactiveOnly", bool()), p("compact", bool()), p("depth", integer()), p("scopeTarget", str()), p("includeUrls", bool()), p("baselineSnapshotId", str()), p("baselinePath", str())), sessionResult(), Map.of());
        add(actions, "screenshotDiff", "Screenshot Diff", "Compare current screenshot against baseline image.", pageSchema(p("baselinePath", str()), p("path", str()), p("threshold", number())), sessionResult(), Map.of("baselinePath", "./baseline.png"));
    }

    private static void element(List<Map<String, Object>> actions, String action, String title, String description, Map<String, Object> input, Map<String, Object> example) {
        add(actions, action, title, description, input, pageResult(), example);
    }

    @SafeVarargs
    private static Map<String, Object> targetSchema(Map.Entry<String, Object>... entries) {
        return pageSchema(prepend(entries, p("target", str()), p("snapshotId", str()), p("exact", bool()), p("index", integer())));
    }

    @SafeVarargs
    private static Map<String, Object> targetOptionalSchema(Map.Entry<String, Object>... entries) {
        return pageSchema(prepend(entries, p("target", str()), p("snapshotId", str()), p("exact", bool()), p("index", integer())));
    }

    @SafeVarargs
    private static Map<String, Object> findSchema(Map.Entry<String, Object>... entries) {
        return pageSchema(prepend(entries, p("by", enumSchema("role", "text", "label", "placeholder", "alt", "title", "testid", "css")), p("query", str()), p("name", str()), p("exact", bool()), p("index", integer())));
    }

    @SafeVarargs
    private static Map<String, Object> pageSchema(Map.Entry<String, Object>... entries) {
        return schema(prepend(entries, p("session", str()), p("tab", str())));
    }

    @SafeVarargs
    private static Map.Entry<String, Object>[] prepend(Map.Entry<String, Object>[] entries, Map.Entry<String, Object>... first) {
        Map.Entry<String, Object>[] result = java.util.Arrays.copyOf(first, first.length + entries.length);
        System.arraycopy(entries, 0, result, first.length, entries.length);
        return result;
    }

    @SafeVarargs
    private static Map<String, Object> schema(Map.Entry<String, Object>... entries) {
        return obj(props(entries));
    }

    private static Map<String, Object> pageResult() {
        return obj(props(p("ok", bool()), p("session", str()), p("tab", str()), p("activeTab", str()), p("url", str()), p("title", str()), p("action", str()), p("outputMeta", object())));
    }

    private static Map<String, Object> tabListResult() {
        Map<String, Object> tabItem = obj(props(
                p("tab", str()),
                p("active", bool()),
                p("closed", bool()),
                p("url", str()),
                p("title", str())
        ));
        return obj(props(p("ok", bool()), p("session", str()), p("activeTab", str()), p("tabs", arr(tabItem)), p("action", str()), p("outputMeta", object())));
    }

    private static Map<String, Object> sessionResult() {
        return obj(props(p("ok", bool()), p("session", str()), p("action", str())));
    }

    private static Map<String, Object> valueResult() {
        return obj(props(p("ok", bool()), p("session", str()), p("tab", str()), p("what", str()), p("value", new LinkedHashMap<>()), p("outputMeta", object())));
    }

    private static Map<String, Object> snapshotResult() {
        return obj(props(p("ok", bool()), p("session", str()), p("tab", str()), p("url", str()), p("title", str()), p("ariaSnapshot", str()), p("visibleText", str()), p("elements", arr(elementSchema())), p("suggestions", arr(object())), p("forms", arr(object())), p("frames", arr(object())), p("events", arr(object())), p("snapshotId", str()), p("pageVersion", integer()), p("scope", object()), p("truncated", bool()), p("elementCount", integer()), p("outputMeta", object())));
    }

    private static Map<String, Object> elementSchema() {
        return obj(props(p("ref", str()), p("selector", str()), p("tag", str()), p("type", str()), p("role", str()), p("name", str()), p("domName", str()), p("text", str()), p("label", str()), p("placeholder", str()), p("title", str()), p("alt", str()), p("testId", str()), p("href", str()), p("visible", bool()), p("enabled", bool()), p("interactive", bool()), p("checked", bool()), p("value", str()), p("bounds", object())));
    }

    private static void add(List<Map<String, Object>> actions, String action, String title, String description, Map<String, Object> inputSchema, Map<String, Object> outputSchema, Map<String, Object> exampleArgs) {
        actions.add(new LinkedHashMap<>(Map.of("action", action, "title", title, "description", description, "inputSchema", inputSchema, "outputSchema", outputSchema, "exampleArgs", exampleArgs(action, inputSchema, exampleArgs), "aiHints", aiHints(action, inputSchema))));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> exampleArgs(String action, Map<String, Object> inputSchema, Map<String, Object> exampleArgs) {
        Map<String, Object> properties = (Map<String, Object>) inputSchema.getOrDefault("properties", Map.of());
        if (!properties.containsKey("session") || exampleArgs.containsKey("session") || "open".equals(action)) {
            return exampleArgs;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("session", "run1");
        result.putAll(exampleArgs);
        return result;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> aiHints(String action, Map<String, Object> inputSchema) {
        Map<String, Object> hints = new LinkedHashMap<>();
        hints.put("forAi", true);
        hints.put("flatArgs", true);
        Map<String, Object> properties = (Map<String, Object>) inputSchema.getOrDefault("properties", Map.of());
        if (properties.containsKey("session") && !List.of("open", "sessionList").contains(action)) {
            hints.put("sessionRequired", true);
        }
        if ("open".equals(action)) {
            hints.put("sessionGeneratedWhenOmitted", true);
        }
        if (List.of("eval", "batch").contains(action)) hints.put("escapeHatch", true);
        return hints;
    }

    private static Map<String, Object> actionDescriptorSchema() {
        return obj(props(p("action", str()), p("title", str()), p("description", str()), p("inputSchema", object()), p("outputSchema", object()), p("exampleArgs", object()), p("aiHints", object())));
    }

    private static Map.Entry<String, Object> p(String key, Object value) {
        return Map.entry(key, value);
    }

    @SafeVarargs
    private static Map<String, Object> props(Map.Entry<String, Object>... entries) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : entries) result.put(entry.getKey(), entry.getValue());
        return result;
    }

    private static Map<String, Object> obj(Map<String, Object> props) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("type", "object");
        result.put("properties", props);
        return result;
    }

    private static Map<String, Object> object() {
        return obj(props());
    }

    private static Map<String, Object> arr(Map<String, Object> items) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("type", "array");
        result.put("items", items);
        return result;
    }

    private static Map<String, Object> str() { return Map.of("type", "string"); }
    private static Map<String, Object> bool() { return Map.of("type", "boolean"); }
    private static Map<String, Object> integer() { return Map.of("type", "integer"); }
    private static Map<String, Object> number() { return Map.of("type", "number"); }
    private static Map<String, Object> enumSchema(String... values) { return Map.of("type", "string", "enum", List.of(values)); }

    private static String title(String action) {
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < action.length(); i++) {
            char c = action.charAt(i);
            if (i == 0) result.append(Character.toUpperCase(c));
            else if (Character.isUpperCase(c)) result.append(' ').append(c);
            else result.append(c);
        }
        return result.toString();
    }
}
