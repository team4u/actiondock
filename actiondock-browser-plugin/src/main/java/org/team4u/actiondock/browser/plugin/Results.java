package org.team4u.actiondock.browser.plugin;

import java.util.LinkedHashMap;
import java.util.Map;

final class Results {
    private Results() {
    }

    static Map<String, Object> ok() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        return result;
    }

    static Map<String, Object> ok(String message) {
        Map<String, Object> result = ok();
        result.put("message", message);
        return result;
    }
}
