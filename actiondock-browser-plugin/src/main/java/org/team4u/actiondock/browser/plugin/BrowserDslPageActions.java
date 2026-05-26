package org.team4u.actiondock.browser.plugin;

import java.util.LinkedHashMap;
import java.util.Map;

final class BrowserDslPageActions {
    private final BrowserGatewayService service;
    private final BrowserDslTargets targets;
    private final BrowserDslTabs tabs;

    BrowserDslPageActions(BrowserGatewayService service, BrowserDslTargets targets, BrowserDslTabs tabs) {
        this.service = service;
        this.targets = targets;
        this.tabs = tabs;
    }

    Map<String, Object> open(BrowserDslContext dsl) throws Exception {
        Map<String, Object> args = dsl.args();
        String url = Args.optionalString(args, "url", null);
        Map<String, Object> result;
        if (!Args.isBlank(url)) {
            Map<String, Object> values = Map.of("url", url);
            Map<String, Object> options = new LinkedHashMap<>();
            BrowserDslSupport.copyIfPresent(args, options, "waitUntil", "timeoutMs");
            result = service.execute(dsl.context(), executeCall(dsl, "goto", Map.of(), values, options));
        } else {
            result = service.sessionInfo(dsl.context(), dsl.callArgs());
        }
        Object pageId = result.get("pageId");
        if (pageId != null) {
            tabs.label(dsl.context(), dsl.session(), Args.optionalString(args, "label", null), String.valueOf(pageId));
        }
        result.put("session", dsl.session());
        return tabs.transformResult(dsl.context(), dsl.session(), result);
    }

    Map<String, Object> snapshot(BrowserDslContext dsl) throws Exception {
        Map<String, Object> call = dsl.callArgs();
        BrowserDslSupport.copyIfPresent(dsl.args(), call, "limit", "maxTextLength");
        Map<String, Object> result = service.snapshot(dsl.context(), call);
        rewriteRefs(result);
        rewriteSuggestedActions(result);
        result.put("session", dsl.session());
        return tabs.transformResult(dsl.context(), dsl.session(), result);
    }

    Map<String, Object> click(BrowserDslContext dsl) throws Exception {
        return elementAction(dsl, "click");
    }

    Map<String, Object> dblclick(BrowserDslContext dsl) throws Exception {
        return elementAction(dsl, "dblclick");
    }

    Map<String, Object> fill(BrowserDslContext dsl) throws Exception {
        return elementAction(dsl, "fill");
    }

    Map<String, Object> type(BrowserDslContext dsl) throws Exception {
        return elementAction(dsl, "type");
    }

    Map<String, Object> press(BrowserDslContext dsl) throws Exception {
        return elementAction(dsl, "press");
    }

    Map<String, Object> hover(BrowserDslContext dsl) throws Exception {
        return elementAction(dsl, "hover");
    }

    Map<String, Object> focus(BrowserDslContext dsl) throws Exception {
        return elementAction(dsl, "focus");
    }

    Map<String, Object> clear(BrowserDslContext dsl) throws Exception {
        return elementAction(dsl, "clear");
    }

    Map<String, Object> select(BrowserDslContext dsl) throws Exception {
        return elementAction(dsl, "select");
    }

    Map<String, Object> check(BrowserDslContext dsl) throws Exception {
        return elementAction(dsl, "check");
    }

    Map<String, Object> uncheck(BrowserDslContext dsl) throws Exception {
        return elementAction(dsl, "uncheck");
    }

    Map<String, Object> upload(BrowserDslContext dsl) throws Exception {
        return elementAction(dsl, "upload");
    }

    Map<String, Object> drag(BrowserDslContext dsl) throws Exception {
        return elementAction(dsl, "drag");
    }

    Map<String, Object> scrollIntoView(BrowserDslContext dsl) throws Exception {
        return elementAction(dsl, "scrollIntoView");
    }

    Map<String, Object> reload(BrowserDslContext dsl) throws Exception {
        return elementAction(dsl, "reload");
    }

    Map<String, Object> back(BrowserDslContext dsl) throws Exception {
        return elementAction(dsl, "back");
    }

    Map<String, Object> forward(BrowserDslContext dsl) throws Exception {
        return elementAction(dsl, "forward");
    }

    private Map<String, Object> elementAction(BrowserDslContext dsl, String op) throws Exception {
        Map<String, Object> target = Map.of();
        Map<String, Object> values = new LinkedHashMap<>();
        Map<String, Object> options = new LinkedHashMap<>();
        switch (op) {
            case "click" -> target = targets.requireTarget(dsl.args());
            case "dblclick", "doubleClick" -> target = targets.requireTarget(dsl.args());
            case "fill" -> {
                target = targets.requireTarget(dsl.args());
                values.put("value", Args.requiredString(dsl.args(), "text"));
            }
            case "type" -> {
                target = targets.requireTarget(dsl.args());
                values.put("text", Args.requiredString(dsl.args(), "text"));
            }
            case "press" -> {
                target = targets.fromTarget(dsl.args());
                values.put("key", Args.requiredString(dsl.args(), "key"));
            }
            case "select" -> {
                target = targets.requireTarget(dsl.args());
                values.put("value", Args.requiredString(dsl.args(), "value"));
            }
            case "check", "uncheck", "hover", "focus", "clear", "tap" -> target = targets.requireTarget(dsl.args());
            case "scrollIntoView", "scrollinto" -> target = targets.requireTarget(dsl.args());
            case "upload" -> {
                target = targets.requireTarget(dsl.args());
                values.put("path", Args.requiredString(dsl.args(), "path"));
            }
            case "drag" -> {
                target = targets.requireTarget(dsl.args());
                values.put("target", targetFromValue(dsl.args(), "to"));
            }
            case "reload", "back", "forward" -> BrowserDslSupport.copyIfPresent(dsl.args(), options, "waitUntil", "timeoutMs");
            default -> throw new IllegalArgumentException("Unsupported act op: " + op);
        }

        Map<String, Object> result = service.execute(dsl.context(), executeCall(dsl, internalOp(op), target, values, options));
        result.put("session", dsl.session());
        result.remove("op");
        result.put("action", actionName(op));
        return tabs.transformResult(dsl.context(), dsl.session(), result);
    }

    Map<String, Object> find(BrowserDslContext dsl) throws Exception {
        Map<String, Object> target = targets.fromFind(dsl.args());
        Map<String, Object> result = service.evaluate(dsl.context(), BrowserDslSupport.merge(dsl.callArgs(),
                "scope", "locator",
                "target", target,
                "expression", "el => ({ text: el.innerText || el.textContent || '', value: el.value || null })"
        ));
        result.put("target", target);
        result.put("session", dsl.session());
        return tabs.transformResult(dsl.context(), dsl.session(), result);
    }

    Map<String, Object> findClick(BrowserDslContext dsl) throws Exception {
        return semanticAction(dsl, "click");
    }

    Map<String, Object> findFill(BrowserDslContext dsl) throws Exception {
        return semanticAction(dsl, "fill");
    }

    Map<String, Object> findType(BrowserDslContext dsl) throws Exception {
        return semanticAction(dsl, "type");
    }

    Map<String, Object> findHover(BrowserDslContext dsl) throws Exception {
        return semanticAction(dsl, "hover");
    }

    Map<String, Object> findFocus(BrowserDslContext dsl) throws Exception {
        return semanticAction(dsl, "focus");
    }

    Map<String, Object> findCheck(BrowserDslContext dsl) throws Exception {
        return semanticAction(dsl, "check");
    }

    Map<String, Object> findUncheck(BrowserDslContext dsl) throws Exception {
        return semanticAction(dsl, "uncheck");
    }

    Map<String, Object> findText(BrowserDslContext dsl) throws Exception {
        return find(dsl);
    }

    private Map<String, Object> semanticAction(BrowserDslContext dsl, String op) throws Exception {
        Map<String, Object> target = targets.fromFind(dsl.args());
        switch (op) {
            case "click" -> {
                return finish(dsl, op, service.execute(dsl.context(), executeCall(dsl, "click", target, Map.of(), Map.of())));
            }
            case "fill" -> {
                return finish(dsl, op, service.execute(dsl.context(), executeCall(dsl, "fill", target,
                        Map.of("value", Args.requiredString(dsl.args(), "text")), Map.of())));
            }
            case "type" -> {
                return finish(dsl, op, service.execute(dsl.context(), executeCall(dsl, "type", target,
                        Map.of("text", Args.requiredString(dsl.args(), "text")), Map.of())));
            }
            case "hover" -> {
                return finish(dsl, op, service.execute(dsl.context(), executeCall(dsl, "hover", target, Map.of(), Map.of())));
            }
            case "focus" -> {
                return finish(dsl, op, service.execute(dsl.context(), executeCall(dsl, "focus", target, Map.of(), Map.of())));
            }
            case "check" -> {
                return finish(dsl, op, service.execute(dsl.context(), executeCall(dsl, "check", target, Map.of(), Map.of())));
            }
            case "uncheck" -> {
                return finish(dsl, op, service.execute(dsl.context(), executeCall(dsl, "uncheck", target, Map.of(), Map.of())));
            }
            default -> throw new IllegalArgumentException("Unsupported find op: " + op);
        }
    }

    private Map<String, Object> finish(BrowserDslContext dsl, String op, Map<String, Object> result) {
        result.put("session", dsl.session());
        result.remove("op");
        result.put("action", "find" + Character.toUpperCase(op.charAt(0)) + op.substring(1));
        return tabs.transformResult(dsl.context(), dsl.session(), result);
    }

    @SuppressWarnings("unchecked")
    private static void rewriteRefs(Map<String, Object> result) {
        Object elements = result.get("elements");
        if (elements instanceof java.util.List<?> list) {
            for (Object item : list) {
                if (item instanceof Map<?, ?> map) {
                    Object ref = map.get("ref");
                    if (ref instanceof String text && !text.startsWith("@")) {
                        ((Map<String, Object>) map).put("ref", "@" + text);
                    }
                }
            }
        }
    }

    private static void rewriteSuggestedActions(Map<String, Object> result) {
        Object suggestions = result.remove("suggestedActions");
        if (suggestions != null) {
            result.put("suggestions", suggestions);
        }
    }

    private Map<String, Object> targetFromValue(Map<String, Object> args, String key) {
        String value = Args.requiredString(args, key);
        return targets.fromTarget(Map.of("target", value));
    }

    private static Map<String, Object> executeCall(BrowserDslContext dsl,
                                                   String op,
                                                   Map<String, Object> target,
                                                   Map<String, Object> values,
                                                   Map<String, Object> options) {
        Map<String, Object> call = dsl.callArgs();
        call.put("op", op);
        if (target != null && !target.isEmpty()) {
            call.put("target", target);
        }
        call.put("args", values == null ? Map.of() : values);
        call.put("options", options == null ? Map.of() : options);
        return call;
    }

    private static String internalOp(String op) {
        return switch (op) {
            case "doubleClick" -> "dblclick";
            case "select" -> "selectOption";
            case "upload" -> "setInputFiles";
            case "scrollinto" -> "scrollIntoView";
            case "back" -> "goBack";
            case "forward" -> "goForward";
            case "addScript" -> "addScriptTag";
            case "addStyle" -> "addStyleTag";
            default -> op;
        };
    }

    private static String actionName(String op) {
        return switch (op) {
            case "doubleClick" -> "dblclick";
            case "scrollinto" -> "scrollIntoView";
            default -> op;
        };
    }
}
