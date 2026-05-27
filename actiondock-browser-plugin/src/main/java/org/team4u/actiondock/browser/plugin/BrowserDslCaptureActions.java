package org.team4u.actiondock.browser.plugin;

import java.util.Map;

final class BrowserDslCaptureActions {
    private final BrowserGatewayService service;
    private final BrowserDslTargets targets;
    private final BrowserDslTabs tabs;

    BrowserDslCaptureActions(BrowserGatewayService service, BrowserDslTargets targets, BrowserDslTabs tabs) {
        this.service = service;
        this.targets = targets;
        this.tabs = tabs;
    }

    Map<String, Object> screenshot(BrowserDslContext dsl) throws Exception {
        return capture(dsl, "screenshot");
    }

    Map<String, Object> pdf(BrowserDslContext dsl) throws Exception {
        return capture(dsl, "pdf");
    }

    private Map<String, Object> capture(BrowserDslContext dsl, String op) throws Exception {
        Map<String, Object> call = dsl.callArgs();
        BrowserDslSupport.copyIfPresent(dsl.args(), call, "name", "path", "fullPage", "annotate", "quality", "format", "printBackground",
                "landscape", "scale", "pageRanges", "width", "height", "displayHeaderFooter", "headerTemplate",
                "footerTemplate", "preferCSSPageSize", "outline", "tagged");
        Map<String, Object> result = switch (op) {
            case "screenshot" -> {
                Map<String, Object> target = targets.fromTarget(dsl.args());
                Map<String, Object> values = new java.util.LinkedHashMap<>(call);
                values.remove("sessionId");
                values.remove("pageId");
                if (target.isEmpty()) {
                    yield service.execute(dsl.context(), executeCall(dsl, "screenshot", Map.of(), values));
                }
                yield service.execute(dsl.context(), executeCall(dsl, "locatorScreenshot", target, values));
            }
            case "pdf" -> {
                Map<String, Object> values = new java.util.LinkedHashMap<>(call);
                values.remove("sessionId");
                values.remove("pageId");
                yield service.execute(dsl.context(), executeCall(dsl, "pdf", Map.of(), values));
            }
            default -> throw new IllegalArgumentException("Unsupported capture op: " + op);
        };
        result.put("session", dsl.session());
        result.remove("op");
        result.put("action", op);
        return tabs.transformResult(dsl.context(), dsl.session(), result);
    }

    private static Map<String, Object> executeCall(BrowserDslContext dsl, String op, Map<String, Object> target, Map<String, Object> values) {
        Map<String, Object> call = dsl.callArgs();
        call.put("op", op);
        if (target != null && !target.isEmpty()) {
            call.put("target", target);
        }
        call.put("args", values == null ? Map.of() : values);
        call.put("options", Map.of());
        return call;
    }
}
