package org.team4u.actiondock.browser.plugin;

import java.util.Map;

final class BrowserDslDialogActions {
    private final BrowserGatewayService service;
    private final BrowserDslTabs tabs;

    BrowserDslDialogActions(BrowserGatewayService service, BrowserDslTabs tabs) {
        this.service = service;
        this.tabs = tabs;
    }

    Map<String, Object> dialogList(BrowserDslContext dsl) throws Exception {
        return dialog(dsl, "list");
    }

    Map<String, Object> dialogAccept(BrowserDslContext dsl) throws Exception {
        return dialog(dsl, "accept");
    }

    Map<String, Object> dialogDismiss(BrowserDslContext dsl) throws Exception {
        return dialog(dsl, "dismiss");
    }

    private Map<String, Object> dialog(BrowserDslContext dsl, String op) throws Exception {
        Map<String, Object> call = dsl.callArgs();
        Map<String, Object> result = switch (op) {
            case "accept" -> {
                Map<String, Object> values = new java.util.LinkedHashMap<>();
                values.put("dialogId", Args.requiredString(dsl.args(), "id"));
                if (Args.has(dsl.args(), "text")) {
                    values.put("promptText", dsl.args().get("text"));
                }
                yield service.execute(dsl.context(), executeCall(dsl, "dialogAccept", values));
            }
            case "dismiss" -> {
                yield service.execute(dsl.context(), executeCall(dsl, "dialogDismiss", Map.of("dialogId", Args.requiredString(dsl.args(), "id"))));
            }
            case "status", "list" -> service.events(dsl.context(), BrowserDslSupport.merge(call, "types", java.util.List.of("dialog")));
            default -> throw new IllegalArgumentException("Unsupported dialog op: " + op);
        };
        result.put("session", dsl.session());
        result.put("op", op);
        return tabs.transformResult(dsl.context(), dsl.session(), result);
    }

    private static Map<String, Object> executeCall(BrowserDslContext dsl, String op, Map<String, Object> values) {
        Map<String, Object> call = dsl.callArgs();
        call.put("op", op);
        call.put("args", values);
        call.put("options", Map.of());
        return call;
    }
}
