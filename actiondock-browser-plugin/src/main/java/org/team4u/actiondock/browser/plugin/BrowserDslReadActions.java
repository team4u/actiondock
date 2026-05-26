package org.team4u.actiondock.browser.plugin;

import java.util.Map;

final class BrowserDslReadActions {
    private final BrowserGatewayService service;
    private final BrowserDslTargets targets;
    private final BrowserDslTabs tabs;

    BrowserDslReadActions(BrowserGatewayService service, BrowserDslTargets targets, BrowserDslTabs tabs) {
        this.service = service;
        this.targets = targets;
        this.tabs = tabs;
    }

    Map<String, Object> getText(BrowserDslContext dsl) throws Exception {
        return get(dsl, "text");
    }

    Map<String, Object> getHtml(BrowserDslContext dsl) throws Exception {
        return get(dsl, "html");
    }

    Map<String, Object> getValue(BrowserDslContext dsl) throws Exception {
        return get(dsl, "value");
    }

    Map<String, Object> getAttr(BrowserDslContext dsl) throws Exception {
        return get(dsl, "attr");
    }

    Map<String, Object> getTitle(BrowserDslContext dsl) throws Exception {
        return get(dsl, "title");
    }

    Map<String, Object> getUrl(BrowserDslContext dsl) throws Exception {
        return get(dsl, "url");
    }

    Map<String, Object> getCount(BrowserDslContext dsl) throws Exception {
        return get(dsl, "count");
    }

    Map<String, Object> getBox(BrowserDslContext dsl) throws Exception {
        return get(dsl, "box");
    }

    private Map<String, Object> get(BrowserDslContext dsl, String what) throws Exception {
        Map<String, Object> call = dsl.callArgs();
        String expression = switch (what) {
            case "title" -> "() => document.title";
            case "url" -> "() => location.href";
            case "text" -> "el => el.innerText || el.textContent || ''";
            case "html" -> "el => el.innerHTML";
            case "value" -> "el => el.value";
            case "attr" -> "(el, name) => el.getAttribute(name)";
            case "count" -> "els => els.length";
            case "box" -> "el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }";
            default -> throw new IllegalArgumentException("Unsupported get what: " + what);
        };
        if ("title".equals(what) || "url".equals(what)) {
            call.put("scope", "page");
        } else if ("count".equals(what)) {
            call.put("scope", "all");
            call.put("target", targets.requireTarget(dsl.args()));
        } else {
            call.put("scope", "locator");
            call.put("target", targets.requireTarget(dsl.args()));
        }
        call.put("expression", expression);
        if ("attr".equals(what)) {
            call.put("arg", Args.requiredString(dsl.args(), "name"));
        }
        Map<String, Object> result = service.evaluate(dsl.context(), call);
        result.put("session", dsl.session());
        result.put("what", what);
        return tabs.transformResult(dsl.context(), dsl.session(), result);
    }

    Map<String, Object> isVisible(BrowserDslContext dsl) throws Exception {
        return is(dsl, "visible");
    }

    Map<String, Object> isEnabled(BrowserDslContext dsl) throws Exception {
        return is(dsl, "enabled");
    }

    Map<String, Object> isChecked(BrowserDslContext dsl) throws Exception {
        return is(dsl, "checked");
    }

    private Map<String, Object> is(BrowserDslContext dsl, String what) throws Exception {
        String expression = switch (what) {
            case "visible" -> "el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)";
            case "enabled" -> "el => !el.disabled";
            case "checked" -> "el => !!el.checked";
            default -> throw new IllegalArgumentException("Unsupported is what: " + what);
        };
        Map<String, Object> call = dsl.callArgs();
        call.put("scope", "locator");
        call.put("target", targets.requireTarget(dsl.args()));
        call.put("expression", expression);
        Map<String, Object> result = service.evaluate(dsl.context(), call);
        result.put("session", dsl.session());
        result.put("what", what);
        result.put("matches", result.get("value"));
        return tabs.transformResult(dsl.context(), dsl.session(), result);
    }
}
