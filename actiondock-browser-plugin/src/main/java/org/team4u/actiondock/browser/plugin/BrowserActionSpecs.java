package org.team4u.actiondock.browser.plugin;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class BrowserActionSpecs {
    private BrowserActionSpecs() {
    }

    static Map<String, Object> capabilities() {
        Map<String, Object> result = Results.ok();
        result.put("actions", actions());
        result.put("targetSchema", targetSchema());
        result.put("workflow", List.of(
                "sessionCreate -> goto -> observe",
                "Use observe.elements[].ref as target.ref for element actions.",
                "Use setChecked/check/uncheck for checkboxes; fill only works for editable text controls.",
                "Use evaluate or advancedAction when a precise action is not enough."
        ));
        return result;
    }

    static List<Map<String, Object>> actions() {
        List<Map<String, Object>> actions = new ArrayList<>();
        add(actions, "sessionCreate", "Create Browser Session", "Create a Playwright session and first page.", obj(props(
                p("browser", enumSchema("chromium", "firefox", "webkit")),
                p("headless", bool()),
                p("timeoutMs", integer()),
                p("viewport", obj(props(p("width", integer()), p("height", integer())), "width", "height")),
                p("userAgent", str()),
                p("locale", str()),
                p("timezoneId", str()),
                p("permissions", arr(str())),
                p("geolocation", obj(props(p("latitude", number()), p("longitude", number()), p("accuracy", number())), "latitude", "longitude")),
                p("extraHTTPHeaders", object()),
                p("httpCredentials", obj(props(p("username", str()), p("password", str())), "username", "password")),
                p("ignoreHTTPSErrors", bool()),
                p("javaScriptEnabled", bool()),
                p("isMobile", bool()),
                p("hasTouch", bool()),
                p("stateName", str()),
                p("storageStatePath", str())
        )), Map.of("browser", "chromium", "headless", true));
        add(actions, "sessionClose", "Close Browser Session", "Close a session and release resources.", sessionOnly(), Map.of("sessionId", "br_xxx"));
        add(actions, "sessionInfo", "Get Session Info", "Read active page and session metadata.", sessionOnly(), Map.of("sessionId", "br_xxx"));
        add(actions, "sessionList", "List Sessions", "List active browser sessions for the current script execution.", obj(props()), Map.of());
        add(actions, "capabilities", "Browser Capabilities", "Return exact action schemas, target schema, and AI workflow hints.", obj(props()), Map.of());
        add(actions, "observe", "Observe Page", "Read URL, title, ARIA snapshot, visible text, actionable refs, forms, frames, events, and suggested next actions.", pageArgs(props(p("limit", integer()), p("maxTextLength", integer()))), Map.of("sessionId", "br_xxx", "limit", 80));

        add(actions, "goto", "Navigate", "Navigate current page to URL.", pageArgs(props(p("url", str()), p("waitUntil", waitUntil()), p("timeoutMs", integer())), "url"), Map.of("sessionId", "br_xxx", "url", "https://example.com"));
        add(actions, "reload", "Reload Page", "Reload current page.", pageArgs(props(p("waitUntil", waitUntil()), p("timeoutMs", integer()))), Map.of("sessionId", "br_xxx"));
        add(actions, "goBack", "Go Back", "Go back in page history.", pageArgs(props(p("waitUntil", waitUntil()), p("timeoutMs", integer()))), Map.of("sessionId", "br_xxx"));
        add(actions, "goForward", "Go Forward", "Go forward in page history.", pageArgs(props(p("waitUntil", waitUntil()), p("timeoutMs", integer()))), Map.of("sessionId", "br_xxx"));

        for (String action : List.of("click", "doubleClick", "hover", "clear", "focus", "blur", "scrollIntoView", "selectText", "tap")) {
            add(actions, action, title(action), "Run locator action using target.ref or selector.", targetArgs(props()), Map.of("sessionId", "br_xxx", "target", Map.of("ref", "e1")));
        }
        add(actions, "fill", "Fill Text", "Set text value on an input, textarea, select-like editable, or contenteditable target.", targetArgs(props(p("value", str())), "value"), Map.of("sessionId", "br_xxx", "target", Map.of("ref", "e2"), "value", "hello"));
        add(actions, "typeText", "Type Text", "Type text into target like real keystrokes.", targetArgs(props(p("text", str())), "text"), Map.of("sessionId", "br_xxx", "target", Map.of("ref", "e2"), "text", "hello"));
        add(actions, "press", "Press Key", "Press a key globally or on a target.", pageArgs(props(p("target", targetSchema()), p("key", str())), "key"), Map.of("sessionId", "br_xxx", "key", "Enter"));
        add(actions, "check", "Check", "Check a checkbox or radio target.", targetArgs(props()), Map.of("sessionId", "br_xxx", "target", Map.of("ref", "e3")));
        add(actions, "uncheck", "Uncheck", "Uncheck a checkbox target.", targetArgs(props()), Map.of("sessionId", "br_xxx", "target", Map.of("ref", "e3")));
        add(actions, "setChecked", "Set Checked", "Set checkbox/radio checked state. Prefer this over fill for checkboxes.", targetArgs(props(p("checked", bool())), "checked"), Map.of("sessionId", "br_xxx", "target", Map.of("ref", "e3"), "checked", true));
        add(actions, "selectOption", "Select Option", "Select one or more select options by value.", targetArgs(props(p("value", str()), p("values", arr(str())))), Map.of("sessionId", "br_xxx", "target", Map.of("ref", "e4"), "value", "US"));
        add(actions, "setInputFiles", "Set Input Files", "Set file input paths relative to workspace.", targetArgs(props(p("path", str()), p("paths", arr(str())))), Map.of("sessionId", "br_xxx", "target", Map.of("ref", "e5"), "path", "upload.txt"));
        add(actions, "dispatchEvent", "Dispatch Event", "Dispatch DOM event on target.", targetArgs(props(p("type", str()), p("eventInit", object())), "type"), Map.of("sessionId", "br_xxx", "target", Map.of("ref", "e1"), "type", "change"));
        add(actions, "dragTo", "Drag To", "Drag source target to destination target.", targetArgs(props(p("destination", targetSchema())), "destination"), Map.of("sessionId", "br_xxx", "target", Map.of("ref", "e1"), "destination", Map.of("ref", "e2")));

        add(actions, "setContent", "Set Page Content", "Replace page HTML.", pageArgs(props(p("html", str())), "html"), Map.of("sessionId", "br_xxx", "html", "<html></html>"));
        add(actions, "addScriptTag", "Add Script Tag", "Inject script by content, URL, or workspace path.", pageArgs(tagProps()), Map.of("sessionId", "br_xxx", "content", "window.x=1"));
        add(actions, "addStyleTag", "Add Style Tag", "Inject style by content, URL, or workspace path.", pageArgs(tagProps()), Map.of("sessionId", "br_xxx", "content", "body{outline:0}"));
        add(actions, "screenshot", "Screenshot Page", "Save page screenshot under artifact directory.", pageArgs(artifactProps()), Map.of("sessionId", "br_xxx", "name", "page", "fullPage", true));
        add(actions, "locatorScreenshot", "Screenshot Locator", "Save target screenshot under artifact directory.", targetArgs(artifactProps()), Map.of("sessionId", "br_xxx", "target", Map.of("ref", "e1"), "name", "button"));
        add(actions, "pdf", "Save PDF", "Save page PDF under artifact directory.", pageArgs(pdfProps()), Map.of("sessionId", "br_xxx", "name", "page", "format", "A4"));
        add(actions, "dialogAccept", "Accept Dialog", "Accept a dialog from events/observe.", pageArgs(props(p("dialogId", str()), p("promptText", str())), "dialogId"), Map.of("sessionId", "br_xxx", "dialogId", "d1"));
        add(actions, "dialogDismiss", "Dismiss Dialog", "Dismiss a dialog from events/observe.", pageArgs(props(p("dialogId", str())), "dialogId"), Map.of("sessionId", "br_xxx", "dialogId", "d1"));
        add(actions, "downloadSaveAs", "Save Download", "Save a download from events/waitForDownload.", pageArgs(props(p("downloadId", str()), p("name", str()), p("path", str())), "downloadId"), Map.of("sessionId", "br_xxx", "downloadId", "dl1", "name", "file.bin"));

        add(actions, "evaluate", "Evaluate JavaScript", "Run unrestricted JS on page, one locator, or all matching locators.", pageArgs(props(p("scope", enumSchema("page", "locator", "all")), p("target", targetSchema()), p("expression", str()), p("arg", object())), "expression"), Map.of("sessionId", "br_xxx", "scope", "page", "expression", "() => document.title"));
        addWaits(actions);
        addPages(actions);
        addStateAndNetwork(actions);
        add(actions, "advancedAction", "Advanced Playwright Action", "Escape hatch for less common operations. Params are op, target, args, options.", pageArgs(props(p("op", str()), p("target", targetSchema()), p("args", object()), p("options", object())), "op"), Map.of("sessionId", "br_xxx", "op", "click", "target", Map.of("ref", "e1")));
        return actions;
    }

    private static void addWaits(List<Map<String, Object>> actions) {
        add(actions, "waitForLoadState", "Wait For Load State", "Wait for load/domcontentloaded/networkidle.", pageArgs(props(p("state", enumSchema("load", "domcontentloaded", "networkidle")), p("timeoutMs", integer()))), Map.of("sessionId", "br_xxx", "state", "load"));
        add(actions, "waitForSelector", "Wait For Selector", "Wait for target state.", targetArgs(props(p("state", enumSchema("attached", "detached", "visible", "hidden")), p("timeoutMs", integer()))), Map.of("sessionId", "br_xxx", "target", Map.of("text", "Done")));
        add(actions, "waitForUrl", "Wait For URL", "Wait until URL matches string/pattern accepted by Playwright.", pageArgs(props(p("url", str()), p("timeoutMs", integer())), "url"), Map.of("sessionId", "br_xxx", "url", "**/done"));
        add(actions, "waitForFunction", "Wait For Function", "Wait until JS expression returns truthy.", pageArgs(props(p("expression", str()), p("arg", object()), p("timeoutMs", integer())), "expression"), Map.of("sessionId", "br_xxx", "expression", "() => window.ready === true"));
        add(actions, "waitForRequest", "Wait For Request", "Wait for matching request URL.", pageArgs(props(p("url", str()), p("timeoutMs", integer())), "url"), Map.of("sessionId", "br_xxx", "url", "**/api/**"));
        add(actions, "waitForResponse", "Wait For Response", "Wait for matching response URL.", pageArgs(props(p("url", str()), p("timeoutMs", integer())), "url"), Map.of("sessionId", "br_xxx", "url", "**/api/**"));
        add(actions, "waitForConsole", "Wait For Console", "Wait for next console message.", pageArgs(props(p("timeoutMs", integer()))), Map.of("sessionId", "br_xxx"));
        add(actions, "waitForPopup", "Wait For Popup", "Wait for popup and register pageId.", pageArgs(props(p("timeoutMs", integer()))), Map.of("sessionId", "br_xxx"));
        add(actions, "waitForDownload", "Wait For Download", "Wait for download and return downloadId.", pageArgs(props(p("timeoutMs", integer()))), Map.of("sessionId", "br_xxx"));
        add(actions, "waitForTimeout", "Wait Timeout", "Sleep for timeoutMs.", pageArgs(props(p("timeoutMs", integer())), "timeoutMs"), Map.of("sessionId", "br_xxx", "timeoutMs", 1000));
    }

    private static void addPages(List<Map<String, Object>> actions) {
        add(actions, "pageList", "List Pages", "List tabs/pages.", sessionOnly(), Map.of("sessionId", "br_xxx"));
        add(actions, "pageNew", "New Page", "Create and switch to a new page.", pageArgs(props(p("url", str()))), Map.of("sessionId", "br_xxx", "url", "https://example.com"));
        add(actions, "pageSwitch", "Switch Page", "Switch active page.", pageArgs(props(), "pageId"), Map.of("sessionId", "br_xxx", "pageId", "p2"));
        add(actions, "pageClose", "Close Page", "Close a page.", pageArgs(props(), "pageId"), Map.of("sessionId", "br_xxx", "pageId", "p2"));
        add(actions, "pageBringToFront", "Bring Page To Front", "Bring page to front and switch active page.", pageArgs(props()), Map.of("sessionId", "br_xxx", "pageId", "p1"));
        add(actions, "events", "Read Events", "Read buffered console, request, response, popup, download, dialog and page errors.", pageArgs(props(p("types", arr(str())), p("sinceId", integer()), p("clear", bool()))), Map.of("sessionId", "br_xxx", "types", List.of("console", "pageError")));
    }

    private static void addStateAndNetwork(List<Map<String, Object>> actions) {
        add(actions, "cookiesGet", "Get Cookies", "Read browser context cookies.", pageArgs(props(p("urls", arr(str())))), Map.of("sessionId", "br_xxx"));
        add(actions, "cookiesSet", "Set Cookies", "Add browser context cookies.", pageArgs(props(p("cookies", arr(object()))), "cookies"), Map.of("sessionId", "br_xxx", "cookies", List.of(Map.of("name", "sid", "value", "1", "url", "https://example.com"))));
        add(actions, "cookiesClear", "Clear Cookies", "Clear context cookies.", sessionOnly(), Map.of("sessionId", "br_xxx"));
        add(actions, "storageState", "Storage State", "Return storage state and optionally save it.", pageArgs(props(p("stateName", str()), p("path", str()), p("storageStatePath", str()), p("indexedDB", bool()))), Map.of("sessionId", "br_xxx", "stateName", "login"));
        add(actions, "permissionsGrant", "Grant Permissions", "Grant context permissions.", pageArgs(props(p("permissions", arr(str())), p("origin", str())), "permissions"), Map.of("sessionId", "br_xxx", "permissions", List.of("geolocation")));
        add(actions, "permissionsClear", "Clear Permissions", "Clear granted permissions.", sessionOnly(), Map.of("sessionId", "br_xxx"));
        add(actions, "networkRoute", "Route Network", "Abort, continue, or fulfill matching requests.", pageArgs(props(p("url", str()), p("routeAction", enumSchema("abort", "continue", "fulfill")), p("status", integer()), p("body", str()), p("headers", object()), p("contentType", str())), "url"), Map.of("sessionId", "br_xxx", "url", "**/*.png", "routeAction", "abort"));
        add(actions, "networkUnroute", "Remove Route", "Remove one route by routeId/url or all routes.", pageArgs(props(p("routeId", str()), p("url", str()))), Map.of("sessionId", "br_xxx", "routeId", "r1"));
        add(actions, "networkSetOffline", "Set Offline", "Toggle browser context offline mode.", pageArgs(props(p("offline", bool()))), Map.of("sessionId", "br_xxx", "offline", true));
        add(actions, "networkSetExtraHTTPHeaders", "Set Headers", "Set extra HTTP headers.", pageArgs(props(p("headers", object())), "headers"), Map.of("sessionId", "br_xxx", "headers", Map.of("X-Test", "1")));
        add(actions, "httpRequest", "HTTP Request", "Send HTTP request using browser context cookies.", pageArgs(props(p("url", str()), p("method", str()), p("headers", object()), p("query", object()), p("data", object()), p("timeoutMs", integer()), p("maxBodyLength", integer())), "url"), Map.of("sessionId", "br_xxx", "url", "https://example.com/api", "method", "GET"));
        add(actions, "mouse", "Mouse", "Mouse click/doubleClick/move/down/up/wheel by coordinates.", pageArgs(props(p("op", enumSchema("click", "doubleClick", "move", "down", "up", "wheel")), p("x", number()), p("y", number()), p("deltaX", number()), p("deltaY", number())), "op", "x", "y"), Map.of("sessionId", "br_xxx", "op", "click", "x", 100, "y", 200));
        add(actions, "keyboard", "Keyboard", "Keyboard press/down/up/type/insertText.", pageArgs(props(p("op", enumSchema("press", "down", "up", "type", "insertText")), p("key", str()), p("text", str())), "op"), Map.of("sessionId", "br_xxx", "op", "press", "key", "Enter"));
        add(actions, "touchscreenTap", "Touchscreen Tap", "Tap by coordinates.", pageArgs(props(p("x", number()), p("y", number())), "x", "y"), Map.of("sessionId", "br_xxx", "x", 100, "y", 200));
        add(actions, "viewportSet", "Set Viewport", "Set page viewport size.", pageArgs(props(p("width", integer()), p("height", integer())), "width", "height"), Map.of("sessionId", "br_xxx", "width", 1280, "height", 720));
        add(actions, "geolocationSet", "Set Geolocation", "Set context geolocation.", pageArgs(props(p("latitude", number()), p("longitude", number()), p("accuracy", number())), "latitude", "longitude"), Map.of("sessionId", "br_xxx", "latitude", 30.0, "longitude", 120.0));
        add(actions, "emulateMedia", "Emulate Media", "Set media/color/reduced motion emulation.", pageArgs(props(p("media", enumSchema("screen", "print")), p("colorScheme", enumSchema("light", "dark", "no-preference")), p("reducedMotion", enumSchema("reduce", "no-preference")), p("forcedColors", enumSchema("active", "none")), p("contrast", enumSchema("more", "no-preference")))), Map.of("sessionId", "br_xxx", "colorScheme", "dark"));
    }

    private static Map<String, Object> sessionOnly() {
        return obj(props(p("sessionId", str())), "sessionId");
    }

    private static Map<String, Object> pageArgs(Map<String, Object> extra, String... required) {
        Map<String, Object> properties = props(p("sessionId", str()), p("pageId", str()));
        properties.putAll(extra);
        return obj(properties, prepend("sessionId", required));
    }

    private static Map<String, Object> targetArgs(Map<String, Object> extra, String... required) {
        Map<String, Object> properties = props(p("sessionId", str()), p("pageId", str()), p("target", targetSchema()));
        properties.putAll(extra);
        return obj(properties, prepend("sessionId", prepend("target", required)));
    }

    private static Map<String, Object> targetSchema() {
        return obj(props(
                p("ref", str()), p("selector", str()), p("role", str()), p("name", str()), p("text", str()),
                p("label", str()), p("placeholder", str()), p("alt", str()), p("title", str()), p("testId", str()),
                p("exact", bool())
        ));
    }

    private static Map<String, Object> tagProps() {
        return props(p("content", str()), p("url", str()), p("path", str()));
    }

    private static Map<String, Object> artifactProps() {
        return props(p("name", str()), p("path", str()), p("fullPage", bool()));
    }

    private static Map<String, Object> pdfProps() {
        Map<String, Object> props = artifactProps();
        props.putAll(props(p("format", str()), p("printBackground", bool()), p("landscape", bool()), p("scale", number()),
                p("pageRanges", str()), p("width", str()), p("height", str()), p("margin", object())));
        return props;
    }

    private static Map<String, Object> waitUntil() {
        return enumSchema("load", "domcontentloaded", "networkidle", "commit");
    }

    private static String[] prepend(String value, String... rest) {
        String[] result = new String[rest.length + 1];
        result[0] = value;
        System.arraycopy(rest, 0, result, 1, rest.length);
        return result;
    }

    private static void add(List<Map<String, Object>> actions, String action, String title, String description, Map<String, Object> inputSchema, Map<String, Object> exampleArgs) {
        actions.add(new LinkedHashMap<>(Map.of(
                "action", action,
                "title", title,
                "description", description,
                "inputSchema", inputSchema,
                "outputSchema", obj(props()),
                "exampleArgs", exampleArgs,
                "aiHints", aiHints(action)
        )));
    }

    private static Map<String, Object> aiHints(String action) {
        Map<String, Object> hints = new LinkedHashMap<>();
        hints.put("forAi", true);
        if (List.of("click", "doubleClick", "hover", "fill", "typeText", "clear", "check", "uncheck", "setChecked",
                "selectOption", "setInputFiles", "focus", "blur", "scrollIntoView", "selectText", "tap",
                "dispatchEvent", "dragTo", "locatorScreenshot", "waitForSelector").contains(action)) {
            hints.put("targetHint", "Prefer target.ref from observe.elements. Re-observe after navigation or major DOM updates.");
        }
        if ("fill".equals(action)) {
            hints.put("warning", "Do not use fill for checkbox/radio. Use setChecked/check/uncheck.");
        }
        if ("advancedAction".equals(action) || "evaluate".equals(action)) {
            hints.put("escapeHatch", true);
        }
        return hints;
    }

    private static Map.Entry<String, Object> p(String key, Object value) {
        return Map.entry(key, value);
    }

    @SafeVarargs
    private static Map<String, Object> props(Map.Entry<String, Object>... entries) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : entries) {
            result.put(entry.getKey(), entry.getValue());
        }
        return result;
    }

    private static Map<String, Object> obj(Map<String, Object> props, String... required) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("type", "object");
        result.put("properties", props);
        if (required.length > 0) {
            result.put("required", List.of(required));
        }
        return result;
    }

    private static Map<String, Object> object() {
        return obj(props());
    }

    private static Map<String, Object> arr(Map<String, Object> items) {
        return Map.of("type", "array", "items", items);
    }

    private static Map<String, Object> str() {
        return Map.of("type", "string");
    }

    private static Map<String, Object> bool() {
        return Map.of("type", "boolean");
    }

    private static Map<String, Object> integer() {
        return Map.of("type", "integer");
    }

    private static Map<String, Object> number() {
        return Map.of("type", "number");
    }

    private static Map<String, Object> enumSchema(String... values) {
        return Map.of("type", "string", "enum", List.of(values));
    }

    private static String title(String action) {
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < action.length(); i++) {
            char c = action.charAt(i);
            if (i == 0) {
                result.append(Character.toUpperCase(c));
            } else if (Character.isUpperCase(c)) {
                result.append(' ').append(c);
            } else {
                result.append(c);
            }
        }
        return result.toString();
    }
}
