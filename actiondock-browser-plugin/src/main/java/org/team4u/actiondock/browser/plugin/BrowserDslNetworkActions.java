package org.team4u.actiondock.browser.plugin;

import java.util.Map;

final class BrowserDslNetworkActions {
    private final BrowserGatewayService service;
    private final BrowserDslTabs tabs;

    BrowserDslNetworkActions(BrowserGatewayService service, BrowserDslTabs tabs) {
        this.service = service;
        this.tabs = tabs;
    }

    Map<String, Object> networkRequest(BrowserDslContext dsl) throws Exception {
        return network(dsl, "request");
    }

    Map<String, Object> networkRoute(BrowserDslContext dsl) throws Exception {
        return network(dsl, "route");
    }

    Map<String, Object> networkUnroute(BrowserDslContext dsl) throws Exception {
        return network(dsl, "unroute");
    }

    Map<String, Object> networkOffline(BrowserDslContext dsl) throws Exception {
        return network(dsl, "offline");
    }

    Map<String, Object> networkHeaders(BrowserDslContext dsl) throws Exception {
        return network(dsl, "headers");
    }

    Map<String, Object> networkEvents(BrowserDslContext dsl) throws Exception {
        return network(dsl, "events");
    }

    private Map<String, Object> network(BrowserDslContext dsl, String op) throws Exception {
        Map<String, Object> call = dsl.callArgs();
        Map<String, Object> result = switch (op) {
            case "request" -> {
                BrowserDslSupport.copyIfPresent(dsl.args(), call, "url", "method", "timeoutMs", "maxBodyLength", "failOnStatusCode");
                putJson(call, dsl.args(), "headers", "headersJson");
                putJson(call, dsl.args(), "query", "queryJson");
                Object data = BrowserDslJson.value(dsl.args(), "bodyJson");
                if (data != null) {
                    call.put("data", data);
                } else if (Args.has(dsl.args(), "body")) {
                    call.put("data", dsl.args().get("body"));
                }
                yield service.httpRequest(dsl.context(), call);
            }
            case "route" -> {
                call.put("url", Args.requiredString(dsl.args(), "url"));
                call.put("routeAction", Args.optionalString(dsl.args(), "routeAction", Args.optionalString(dsl.args(), "action", "abort")));
                BrowserDslSupport.copyIfPresent(dsl.args(), call, "status", "body", "contentType", "errorCode", "method", "replacementUrl", "postData");
                putJson(call, dsl.args(), "headers", "headersJson");
                yield service.networkRoute(dsl.context(), call);
            }
            case "unroute" -> {
                BrowserDslSupport.copyIfPresent(dsl.args(), call, "routeId", "url");
                yield service.networkUnroute(dsl.context(), call);
            }
            case "offline" -> {
                call.put("offline", Args.optionalBoolean(dsl.args(), "value", true));
                yield service.networkSetOffline(dsl.context(), call);
            }
            case "headers" -> {
                putJson(call, dsl.args(), "headers", "headersJson");
                yield service.networkSetExtraHTTPHeaders(dsl.context(), call);
            }
            case "events" -> {
                BrowserDslSupport.copyIfPresent(dsl.args(), call, "sinceId", "clear");
                String types = Args.optionalString(dsl.args(), "types", null);
                if (!Args.isBlank(types)) {
                    call.put("types", BrowserDslSupport.csv(types));
                }
                yield service.events(dsl.context(), call);
            }
            default -> throw new IllegalArgumentException("Unsupported network op: " + op);
        };
        result.put("session", dsl.session());
        result.remove("op");
        result.put("action", "network" + Character.toUpperCase(op.charAt(0)) + op.substring(1));
        return tabs.transformResult(dsl.context(), dsl.session(), result);
    }

    private static void putJson(Map<String, Object> call, Map<String, Object> args, String targetKey, String sourceKey) {
        Map<String, Object> value = BrowserDslJson.object(args, sourceKey);
        if (!value.isEmpty()) {
            call.put(targetKey, value);
        }
    }
}
