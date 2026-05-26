package org.team4u.actiondock.browser.plugin;

import java.util.Map;

final class BrowserDslWaitActions {
    private final BrowserGatewayService service;
    private final BrowserDslTargets targets;
    private final BrowserDslTabs tabs;

    BrowserDslWaitActions(BrowserGatewayService service, BrowserDslTargets targets, BrowserDslTabs tabs) {
        this.service = service;
        this.targets = targets;
        this.tabs = tabs;
    }

    Map<String, Object> waitForElement(BrowserDslContext dsl) throws Exception {
        return waitFor(dsl, "selector");
    }

    Map<String, Object> waitForText(BrowserDslContext dsl) throws Exception {
        Map<String, Object> args = new java.util.LinkedHashMap<>(dsl.args());
        args.put("target", "body");
        args.put("value", "() => document.body && document.body.innerText.includes(" + jsString(Args.requiredString(dsl.args(), "text")) + ")");
        return waitFor(new BrowserDslContext(dsl.context(), args, dsl.session(), dsl.sessionId(), dsl.pageId()), "function");
    }

    Map<String, Object> waitForUrl(BrowserDslContext dsl) throws Exception {
        return waitFor(dsl, "url");
    }

    Map<String, Object> waitForLoad(BrowserDslContext dsl) throws Exception {
        return waitFor(dsl, "load");
    }

    Map<String, Object> waitForFunction(BrowserDslContext dsl) throws Exception {
        return waitFor(dsl, "function");
    }

    Map<String, Object> waitForRequest(BrowserDslContext dsl) throws Exception {
        return waitFor(dsl, "request");
    }

    Map<String, Object> waitForResponse(BrowserDslContext dsl) throws Exception {
        return waitFor(dsl, "response");
    }

    Map<String, Object> waitForConsole(BrowserDslContext dsl) throws Exception {
        return waitFor(dsl, "console");
    }

    Map<String, Object> waitForPopup(BrowserDslContext dsl) throws Exception {
        return waitFor(dsl, "popup");
    }

    Map<String, Object> waitForDownload(BrowserDslContext dsl) throws Exception {
        return waitFor(dsl, "download");
    }

    Map<String, Object> waitForTimeout(BrowserDslContext dsl) throws Exception {
        return waitFor(dsl, "timeout");
    }

    private Map<String, Object> waitFor(BrowserDslContext dsl, String kind) throws Exception {
        Map<String, Object> call = dsl.callArgs();
        call.put("for", internalKind(kind));
        BrowserDslSupport.copyIfPresent(dsl.args(), call, "timeoutMs", "state");
        Map<String, Object> result = switch (kind) {
            case "load", "loadState" -> {
                if (!call.containsKey("state")) {
                    call.put("state", Args.optionalString(dsl.args(), "value", "load"));
                }
                yield service.wait(dsl.context(), call);
            }
            case "selector", "target", "element" -> {
                call.put("target", targets.requireTarget(dsl.args()));
                yield service.wait(dsl.context(), call);
            }
            case "url" -> {
                call.put("url", Args.requiredString(dsl.args(), "value"));
                yield service.wait(dsl.context(), call);
            }
            case "function", "fn" -> {
                call.put("expression", Args.requiredString(dsl.args(), "value"));
                Object arg = BrowserDslJson.value(dsl.args(), "argJson");
                if (arg != null) {
                    call.put("arg", arg);
                }
                yield service.wait(dsl.context(), call);
            }
            case "request" -> {
                call.put("url", Args.requiredString(dsl.args(), "value"));
                yield service.wait(dsl.context(), call);
            }
            case "response" -> {
                call.put("url", Args.requiredString(dsl.args(), "value"));
                yield service.wait(dsl.context(), call);
            }
            case "console", "popup", "download" -> service.wait(dsl.context(), call);
            case "timeout", "time" -> {
                if (!call.containsKey("timeoutMs")) {
                    call.put("timeoutMs", Args.optionalInt(dsl.args(), "value", 1000));
                }
                yield service.wait(dsl.context(), call);
            }
            default -> throw new IllegalArgumentException("Unsupported wait for: " + kind);
        };
        result.put("session", dsl.session());
        return tabs.transformResult(dsl.context(), dsl.session(), result);
    }

    private static String internalKind(String kind) {
        return switch (kind) {
            case "load" -> "loadState";
            case "target", "element" -> "selector";
            case "fn" -> "function";
            case "time" -> "timeout";
            default -> kind;
        };
    }

    private static String jsString(String value) {
        return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'";
    }
}
